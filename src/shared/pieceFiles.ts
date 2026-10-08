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
