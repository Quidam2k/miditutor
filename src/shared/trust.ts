export type TrustStatus = 'checked' | 'issues' | 'unverified';

export interface PieceTrust {
  status: TrustStatus;
  note: string;
}

export type TrustMap = Record<string, PieceTrust>;

/** Parse valid entries from a flat trust map. */
export function parseTrust(json: unknown): TrustMap {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return {};
  const entries: [string, PieceTrust][] = [];
  for (const [file, value] of Object.entries(json)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) continue;
    const { status, note } = value as Record<string, unknown>;
    if (status !== 'checked' && status !== 'issues' && status !== 'unverified') continue;
    entries.push([file, { status, note: typeof note === 'string' ? note : '' }]);
  }
  return Object.fromEntries(entries);
}

/** Return the trust entry owned by the map for a file. */
export function trustFor(map: TrustMap | undefined, file: string): PieceTrust | undefined {
  return map !== undefined && Object.prototype.hasOwnProperty.call(map, file)
    ? map[file]
    : undefined;
}

/** Return the symbol for a piece's trust status. */
export function trustMark(trust: PieceTrust | undefined): string {
  switch (trust?.status) {
    case 'checked': return '\u2713';
    case 'issues': return '\u26A0';
    default: return '?';
  }
}

/** Return the label for a piece's trust status. */
export function trustBadge(trust: PieceTrust | undefined): string {
  switch (trust?.status) {
    case 'checked': return 'Checked against the page';
    case 'issues': return trust.note.trim() ? 'Known issues: ' + trust.note : 'Known issues';
    default: return 'Not yet checked';
  }
}
