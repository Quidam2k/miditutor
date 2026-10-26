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

/** True for a file name the Pieces folder lists (dot files and other types are skipped). */
export function isPieceFileName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return !name.startsWith('.') && (MUSICXML_EXTENSIONS as readonly string[]).includes(ext);
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
