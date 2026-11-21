// Pure helpers for opening score files (main process dialog, renderer naming).

/** Score file types the Score tab can open directly. */
export const MUSICXML_EXTENSIONS = ['musicxml', 'xml', 'mxl'] as const;

/** True when the score text is a MusicXML score (the same check the tutor API makes). */
export function isScoreXml(text: string): boolean {
  return text.includes('<score-partwise') || text.includes('<score-timewise');
}

/** Title for a piece opened from disk: the file name without its folder or extension. */
export function titleFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const stem = base.replace(/\.[^.]+$/, '');
  return stem.trim() || 'Untitled';
}

/** The score's own title (work-title, then movement-title), or null when it has none. */
export function scoreTitle(xml: string): string | null {
  const m = /<work-title>([^<]*)<\/work-title>/.exec(xml) ?? /<movement-title>([^<]*)<\/movement-title>/.exec(xml);
  const raw = m?.[1]?.trim();
  if (!raw) return null;
  return raw
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const titleWords = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * #6368: the title to list a score under. Its own title, unless that is only the first word(s)
 * of a spoken file name ("Spin" in "Spin the Wheel (intermediate).musicxml", a MIDI track name):
 * then the file name is the fuller title. Library slugs (no spaces: "fur-elise-easy") never
 * override the score's title. No title: the file name.
 */
export function pieceTitle(xml: string, filePath: string): string {
  const own = scoreTitle(xml);
  const fromFile = titleFromPath(filePath);
  if (!own) return fromFile;
  const a = titleWords(own);
  const b = titleWords(fromFile);
  return /\s/.test(fromFile) && a.length > 0 && a.length < b.length && a.every((w, i) => w === b[i]) ? fromFile : own;
}

/**
 * A hand-fix or annotate backup (`<slug>.pre-<fix>.musicxml`), never a piece. sync_pieces.sh
 * skips the same names; #6654: one listed beside the real file was practised and fingered by mistake.
 */
export function isBackupFileName(name: string): boolean {
  return /\.pre-[^.]*\.[^.]+$/i.test(name);
}

/** True for a file name the Pieces folder lists (dot files, backups and other types are skipped). */
export function isPieceFileName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return !name.startsWith('.') && !isBackupFileName(name) && (MUSICXML_EXTENSIONS as readonly string[]).includes(ext);
}

/** Safe file name for a pushed piece saved into the Pieces folder. */
export function pieceFileName(title: string): string {
  const stem = title
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return `${stem.slice(0, 100) || 'Untitled'}.musicxml`;
}
