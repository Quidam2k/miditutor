// 'verified' is his own review (#9664, source todd-review): written by the desk
// app's Review tab with the score's sha256, so a re-ingested score loses it.
export type TrustStatus = 'checked' | 'issues' | 'unverified' | 'verified';

export interface PieceTrust {
  status: TrustStatus;
  note: string;
  /** sha256 of the score he verified ('verified' only). */
  sha?: string;
  /** trust.json "hide": true: leave this version out of its song's switch (#9794). */
  hide?: true;
  /** trust.json "no_mix": why My mix is off while this is the Harder source (#9794). */
  noMix?: string;
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
    const { status, note, score_sha256: sha, hide, no_mix: noMix } = value as Record<string, unknown>;
    if (status !== 'checked' && status !== 'issues' && status !== 'unverified' && status !== 'verified') continue;
    // A verified entry without the score's hash can't be checked against the file: not trusted.
    if (status === 'verified' && typeof sha !== 'string') continue;
    const text = typeof note === 'string' ? note : '';
    if (status === 'verified') {
      // His own review wins: a verified file is never hidden or kept out of a mix.
      entries.push([file, { status, note: text, sha: sha as string }]);
      continue;
    }
    entries.push([file, {
      status,
      note: text,
      ...(hide === true ? { hide: true as const } : {}),
      ...(typeof noMix === 'string' && noMix.trim() ? { noMix: noMix.trim() } : {}),
    }]);
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
    case 'verified': return '\u2714';
    case 'checked': return '\u2713';
    case 'issues': return '\u26A0';
    default: return '?';
  }
}

/** Return the label for a piece's trust status. */
export function trustBadge(trust: PieceTrust | undefined): string {
  switch (trust?.status) {
    case 'verified': return trust.note.trim() ? 'Verified by you: ' + trust.note : 'Verified by you';
    case 'checked': return 'Checked against the page';
    case 'issues': return trust.note.trim() ? 'Known issues: ' + trust.note : 'Known issues';
    default: return 'Not yet checked';
  }
}
