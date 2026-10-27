// Scan review on the desk (#9664): reads the OMR library directly
// (Q:/Personal/piano/library), keeps his marks as an append-only event log per
// piece, and writes "Verified by you" into trust.json. Enabled only when the
// app is started with --review-library=<dir> (or MIDITUTOR_REVIEW_LIBRARY);
// Pinocchio never has it. This process is the only writer of the event logs.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Layout, MarkCheck, Proposal, ReviewEvent, ReviewState, foldReview, markCheck } from '../shared/review';
import { scoreTitle, titleFromPath } from '../shared/pieceFiles';

export interface ReviewConfig {
  library: string;
  python: string;
  scripts: string;
  /** Folder inside a private git repo that backup_review.py mirrors his work into; none -> no backup. */
  backup?: string;
}

/** --name=value from argv, else the env var, else undefined. */
const option = (argv: string[], name: string, env: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || process.env[env] || undefined;

export function reviewConfig(argv: string[], appPath: string): ReviewConfig | null {
  const library = option(argv, 'review-library', 'MIDITUTOR_REVIEW_LIBRARY');
  if (!library) return null;
  return {
    library,
    python: option(argv, 'review-python', 'MIDITUTOR_REVIEW_PYTHON') ?? path.join(appPath, '.venv', 'Scripts', 'python.exe'),
    scripts: option(argv, 'review-scripts', 'MIDITUTOR_REVIEW_SCRIPTS') ?? path.join(appPath, 'scripts'),
    backup: option(argv, 'review-backup', 'MIDITUTOR_REVIEW_BACKUP'),
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
// review_queue.py exit codes that mean "not now": another check holds the lock, or Solace is short of memory.
const QUEUE_BUSY = 3;
const QUEUE_DEFERRED = 4;
const QUEUE_STALE = 5;
const RETRY_MS = 60_000;
const BACKUP_DELAY_MS = 60_000;
const EVENT_KINDS = new Set(['mark', 'confirm_system', 'accept', 'reject', 'withdraw']);
const TRUST_SOURCE = 'todd-review';

export interface ReviewPieceSummary {
  slug: string;
  file: string;
  title: string;
  trust: { status?: string; note?: string; source?: string } | null;
  match: Layout['match'] | null;
  systems: number;
  confirmed: number;
  openMarks: number;
  verified: boolean;
}

export interface ReviewPiece {
  slug: string;
  title: string;
  musicxml: string;
  sha: string;
  layout: Layout | null;
  events: ReviewEvent[];
  state: ReviewState;
  /** Open mark id -> its vision re-check. */
  checks: Record<string, MarkCheck>;
}

export class Review {
  // One queue for every piece: appends and applies share trust.json.
  private tail: Promise<unknown> = Promise.resolve();
  // Vision re-checks run one at a time, only for marks he made (never over unmarked bars).
  private checkQueue: { slug: string; mark: string }[] = [];
  private checking: string | null = null;
  /** `slug/mark` -> why its check is held back: busy or low memory (cleared on retry), or an error (until "Try again"). */
  private held = new Map<string, string>();
  private retry: NodeJS.Timeout | null = null;
  private backupTimer: NodeJS.Timeout | null = null;
  private backingUp = false;

  constructor(private readonly cfg: ReviewConfig) {
    // Catches whatever the last session wrote after its final backup.
    this.backup();
  }

  get library() {
    return this.cfg.library;
  }

  private scorePath = (slug: string) => path.join(this.cfg.library, `${slug}.musicxml`);
  private reviewDir = () => path.join(this.cfg.library, 'review');
  private eventsPath = (slug: string) => path.join(this.reviewDir(), `${slug}.events.jsonl`);
  private layoutPath = (slug: string) => path.join(this.reviewDir(), `${slug}.layout.json`);

  private check(slug: string) {
    if (!SLUG.test(slug)) throw new Error(`bad piece name: ${slug}`);
  }

  /** One task at a time (appends, applies, trust writes). */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.catch(() => undefined).then(task);
    this.tail = run;
    return run;
  }

  /** Every score in the library that has scan pages. */
  async list(): Promise<ReviewPieceSummary[]> {
    const lib = this.cfg.library;
    const pages = new Set(await fs.readdir(path.join(lib, 'pages')).catch(() => [] as string[]));
    const trust = await this.readTrust();
    const out: ReviewPieceSummary[] = [];
    for (const name of (await fs.readdir(lib)).sort()) {
      const m = /^([a-z0-9][a-z0-9-]*)\.musicxml$/.exec(name);
      if (!m || !pages.has(m[1])) continue;
      const slug = m[1];
      try {
        const piece = await this.piece(slug);
        out.push({
          slug,
          file: name,
          title: piece.title,
          trust: (trust[name] as ReviewPieceSummary['trust']) ?? null,
          match: piece.layout?.match ?? null,
          systems: piece.layout?.systems.length ?? 0,
          confirmed: Object.keys(piece.state.confirmed).length,
          openMarks: piece.state.marks.filter((mk) => mk.status === 'open').length,
          verified: piece.state.verified,
        });
      } catch (err) {
        console.warn(`[review] ${slug}: ${(err as Error).message}`);
      }
    }
    return out;
  }

  async piece(slug: string): Promise<ReviewPiece> {
    this.check(slug);
    const bytes = await fs.readFile(this.scorePath(slug));
    const musicxml = bytes.toString('utf8');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const layout = await this.readJson<Layout>(this.layoutPath(slug));
    const events = await this.readEvents(slug);
    const state = foldReview(events, layout, sha);
    const latest = await this.latestProposals(slug);
    const checks: Record<string, MarkCheck> = {};
    for (const mark of state.marks) {
      if (mark.status !== 'open') continue;
      const key = `${slug}/${mark.id}`;
      const held = this.held.get(key);
      const proposal = latest.get(mark.id);
      if (mark.measure === null) checks[mark.id] = { state: 'waiting', reason: 'No bar was picked: withdraw it and circle the bar.' };
      else if (held !== undefined) checks[mark.id] = { state: 'waiting', reason: held };
      else if (this.isQueued(slug, mark.id)) checks[mark.id] = { state: 'checking' };
      else if (proposal && markCheck(mark, proposal, sha) === 'done') checks[mark.id] = { state: 'done', proposal };
      else checks[mark.id] = { state: 'needed' };
    }
    return { slug, title: scoreTitle(musicxml) ?? titleFromPath(slug), musicxml, sha, layout, events, state, checks };
  }

  /** (Re)build the piece's layout when it is missing or made from another version of the score. */
  async ensureLayout(slug: string): Promise<ReviewPiece> {
    let piece = await this.piece(slug);
    if (!(piece.layout?.version === 1 && piece.layout.score_sha256 === piece.sha &&
          await this.cropsExist(piece.layout))) {
      await this.python('review_layout.py', ['--library', this.cfg.library, slug]);
      piece = await this.piece(slug);
    }
    return this.queueChecks(piece);
  }

  private proposalsDir = (slug: string) => path.join(this.reviewDir(), `${slug}.proposals`);

  /** Each mark's newest proposal. */
  private async latestProposals(slug: string): Promise<Map<string, Proposal>> {
    const dir = this.proposalsDir(slug);
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const latest = new Map<string, Proposal>();
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const p = await this.readJson<Proposal>(path.join(dir, name));
      if (!p || typeof p.mark !== 'string') continue;
      const prev = latest.get(p.mark);
      if (!prev || p.created > prev.created) latest.set(p.mark, p);
    }
    return latest;
  }

  /** Queue a check for every open mark whose latest proposal no longer answers it. */
  private queueChecks(piece: ReviewPiece): ReviewPiece {
    for (const [mark, check] of Object.entries(piece.checks)) {
      if (check.state !== 'needed') continue;
      this.checkQueue.push({ slug: piece.slug, mark });
      piece.checks[mark] = { state: 'checking' };
    }
    this.pump();
    return piece;
  }

  /** "Try again" on a mark whose check failed, was held, or found nothing to change. */
  async recheck(slug: string, mark: string): Promise<ReviewPiece> {
    this.check(slug);
    if (!ID.test(mark)) throw new Error(`bad mark id: ${mark}`);
    const key = `${slug}/${mark}`;
    this.held.delete(key);
    if (!this.isQueued(slug, mark)) this.checkQueue.push({ slug, mark });
    this.pump();
    return this.piece(slug);
  }

  private isQueued(slug: string, mark: string) {
    return this.checking === `${slug}/${mark}` || this.checkQueue.some((q) => q.slug === slug && q.mark === mark);
  }

  private pump() {
    if (this.checking || this.retry) return;
    const next = this.checkQueue.shift();
    if (!next) return;
    const key = `${next.slug}/${next.mark}`;
    this.checking = key;
    this.held.delete(key);
    void this.queueScript(['propose', '--library', this.cfg.library, next.slug, next.mark])
      .then(({ code, result }) => {
        if (code === QUEUE_BUSY || code === QUEUE_DEFERRED) {
          // Not now: hold the whole queue and try again in a minute.
          this.held.set(key, String(result.error ?? 'Waiting to check.'));
          this.checkQueue.unshift(next);
          this.retry = setTimeout(() => {
            this.retry = null;
            this.held.delete(key);
            this.pump();
          }, RETRY_MS);
          this.retry.unref();
        } else if (code !== 0) {
          this.held.set(key, String(result.error ?? 'The check failed.'));
        }
      })
      .finally(() => {
        this.checking = null;
        this.pump();
      });
  }

  /** Apply a proposal he accepted, then log it as an accept event. Never automatic. */
  async accept(slug: string, proposal: string): Promise<ReviewPiece> {
    this.check(slug);
    if (!ID.test(proposal)) throw new Error(`bad proposal id: ${proposal}`);
    return this.serial(async () => {
      const record = await this.readJson<Proposal>(path.join(this.proposalsDir(slug), `${proposal}.json`));
      const piece = await this.piece(slug);
      if (!record || !piece.state.marks.some((m) => m.id === record.mark && m.status === 'open')) {
        throw new Error('That mark is no longer open.');
      }
      const { code, result } = await this.queueScript(['apply', '--library', this.cfg.library, slug, proposal]);
      if (code === QUEUE_STALE) {
        void this.ensureLayout(slug).catch((err) => console.warn(`[review] ${slug}: ${(err as Error).message}`));
        throw new Error(`${String(result.error)} Checking it again.`);
      }
      if (code !== 0) throw new Error(String(result.error ?? 'The fix could not be applied.'));
      const event = {
        kind: 'accept', mark: result.mark, before: result.before, after: result.after, proposal,
        id: randomUUID(), origin: 'solace', ts: Date.now(),
      } as ReviewEvent;
      await this.writeEvents(slug, [event]);
      const next = await this.ensureLayout(slug);
      await this.updateTrust(slug, next);
      return next;
    });
  }

  /** A proposal's scan crop (data URL) and proposed score, for showing beside the current bar. */
  async proposalView(slug: string, proposal: string): Promise<{ crop: string; musicxml: string | null }> {
    this.check(slug);
    if (!ID.test(proposal)) throw new Error(`bad proposal id: ${proposal}`);
    const base = path.join(this.proposalsDir(slug), proposal);
    const png = await fs.readFile(`${base}.png`);
    const musicxml = await fs.readFile(`${base}.musicxml`, 'utf8').catch(() => null);
    return { crop: `data:image/png;base64,${png.toString('base64')}`, musicxml };
  }

  /** review_queue.py: exit code and its last stdout line (one JSON object). */
  private queueScript(args: string[]): Promise<{ code: number; result: Record<string, unknown> }> {
    return new Promise((resolve) => {
      execFile(this.cfg.python, ['-I', path.join(this.cfg.scripts, 'review_queue.py'), ...args],
        { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 },
        (err, stdout, stderr) => {
          let result: Record<string, unknown>;
          try {
            result = JSON.parse(stdout.trim().split('\n').pop() ?? '');
          } catch {
            result = { ok: false, error: stderr.trim().split('\n').pop() || err?.message || 'review_queue.py gave no answer' };
          }
          resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, result });
        });
    });
  }

  private async cropsExist(layout: Layout) {
    const present = await Promise.all(layout.systems.map((s) =>
      fs.access(path.join(this.cfg.library, s.crop)).then(() => true, () => false)));
    return present.every(Boolean);
  }

  /** A system's scan crop as a data URL; only files under review-pages/<slug>/. */
  async crop(slug: string, rel: string): Promise<string> {
    this.check(slug);
    const base = path.resolve(this.cfg.library, 'review-pages', slug);
    const file = path.resolve(this.cfg.library, rel);
    if (path.dirname(file) !== base || !file.endsWith('.jpg')) throw new Error(`bad crop path: ${rel}`);
    return `data:image/jpeg;base64,${(await fs.readFile(file)).toString('base64')}`;
  }

  /** Append one of his actions to the log, then refresh the badge. */
  async append(slug: string, input: Record<string, unknown>): Promise<ReviewPiece> {
    this.check(slug);
    if (typeof input.kind !== 'string' || !EVENT_KINDS.has(input.kind) || input.kind === 'accept') {
      throw new Error(`not an event he can add: ${String(input.kind)}`);
    }
    return this.serial(async () => {
      const piece = await this.piece(slug);
      const event = { ...input, id: randomUUID(), origin: 'solace', ts: Date.now() } as ReviewEvent;
      if (event.kind === 'confirm_system') {
        if (!piece.layout?.systems.some((s) => s.index === event.system && s.measures)) {
          throw new Error(`line ${event.system} can't be confirmed: the scan and the score don't line up there`);
        }
        event.sha = piece.sha;
      }
      await this.writeEvents(slug, [event]);
      const next = await this.piece(slug);
      await this.updateTrust(slug, next);
      return this.queueChecks(next);
    });
  }

  private async readEvents(slug: string): Promise<ReviewEvent[]> {
    let text: string;
    try {
      text = await fs.readFile(this.eventsPath(slug), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const events: ReviewEvent[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e.id === 'string' && EVENT_KINDS.has(e.kind)) events.push(e);
      } catch {
        console.warn(`[review] ${slug}: skipped a damaged log line`);
      }
    }
    return events;
  }

  private async writeEvents(slug: string, events: ReviewEvent[]) {
    await fs.mkdir(this.reviewDir(), { recursive: true });
    await fs.appendFile(this.eventsPath(slug), events.map((e) => JSON.stringify(e) + '\n').join(''), 'utf8');
    this.scheduleBackup();
  }

  /** Back up a minute after his last change, so a run of marks is one commit. */
  private scheduleBackup() {
    if (!this.cfg.backup) return;
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null;
      this.backup();
    }, BACKUP_DELAY_MS);
  }

  private backup() {
    if (!this.cfg.backup) return;
    if (this.backingUp) return this.scheduleBackup();
    this.backingUp = true;
    this.python('backup_review.py', ['--library', this.cfg.library, '--dest', this.cfg.backup])
      .catch((err) => console.warn(`[review] backup: ${(err as Error).message}`))
      .finally(() => {
        this.backingUp = false;
      });
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[review] ${file}: ${(err as Error).message}`);
      return null;
    }
  }

  private async readTrust(): Promise<Record<string, unknown>> {
    return (await this.readJson<Record<string, unknown>>(path.join(this.cfg.library, 'trust.json'))) ?? {};
  }

  /**
   * Verified -> trust.json gets his entry (date, lines, the score's hash), keeping
   * the audit's entry under `previous`. No longer verified -> the previous entry
   * comes back. omr_audit's merge_trust never overwrites a todd-review entry.
   */
  private async updateTrust(slug: string, piece: ReviewPiece) {
    const file = `${slug}.musicxml`;
    const trust = await this.readTrust();
    const current = trust[file] as Record<string, unknown> | undefined;
    const mine = current?.source === TRUST_SOURCE;
    // The entry his review replaced (the audit's), restored when the piece is no longer verified.
    const previous = mine ? current.previous : current;
    if (piece.state.verified) {
      const systems = Object.keys(piece.state.confirmed).map(Number).sort((a, b) => a - b);
      const last = Math.max(...Object.values(piece.state.confirmed));
      const day = new Date(last).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const entry = {
        status: 'verified',
        source: TRUST_SOURCE,
        note: `${day}, all ${systems.length} lines`,
        date: new Date(last).toISOString(),
        systems,
        score_sha256: piece.sha,
        ...(previous ? { previous } : {}),
      };
      if (mine && current.score_sha256 === entry.score_sha256 && current.date === entry.date) return;
      trust[file] = entry;
    } else if (mine) {
      if (current.previous) trust[file] = current.previous;
      else delete trust[file];
    } else {
      return;
    }
    await writeJsonAtomic(path.join(this.cfg.library, 'trust.json'), sortKeys(trust));
  }

  python(script: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.cfg.python, ['-I', path.join(this.cfg.scripts, script), ...args],
        { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => (err ? reject(new Error(`${script}: ${stderr.trim() || err.message}`)) : resolve(stdout)));
    });
  }
}

/** Keys sorted at every level, like Python's json.dumps(sort_keys=True). */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** Same bytes omr_audit.write_trust writes: indent 2, ASCII only, trailing newline. */
async function writeJsonAtomic(file: string, data: unknown) {
  const text = JSON.stringify(data, null, 2).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) + '\n';
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}
