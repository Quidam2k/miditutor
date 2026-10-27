// Scan review on the desk (#9664): reads the OMR library directly
// (Q:/Personal/piano/library), keeps his marks as an append-only event log per
// piece, and writes "Verified by you" into trust.json. Enabled only when the
// app is started with --review-library=<dir> (or MIDITUTOR_REVIEW_LIBRARY);
// Pinocchio never has it. This process is the only writer of the event logs.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Layout, ReviewEvent, ReviewState, foldReview } from '../shared/review';
import { scoreTitle, titleFromPath } from '../shared/pieceFiles';

export interface ReviewConfig {
  library: string;
  python: string;
  scripts: string;
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
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
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
}

export class Review {
  // One queue for every piece: appends and applies share trust.json.
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly cfg: ReviewConfig) {}

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
    return {
      slug,
      title: scoreTitle(musicxml) ?? titleFromPath(slug),
      musicxml,
      sha,
      layout,
      events,
      state: foldReview(events, layout, sha),
    };
  }

  /** (Re)build the piece's layout when it is missing or made from another version of the score. */
  async ensureLayout(slug: string): Promise<ReviewPiece> {
    const piece = await this.piece(slug);
    if (piece.layout?.version === 1 && piece.layout.score_sha256 === piece.sha &&
        await this.cropsExist(piece.layout)) return piece;
    await this.python('review_layout.py', ['--library', this.cfg.library, slug]);
    return this.piece(slug);
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
      return next;
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
