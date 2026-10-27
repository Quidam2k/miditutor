// Versions of one piece (#9627): versions.json beside trust.json groups the files that
// are the same song (an easy book arrangement, a harder one, his own mix), so the
// picker lists the song once with a switch between them.

export interface PieceVersion {
  file: string;
  /** What the switch shows: "Easy", "Harder", "My mix". */
  label: string;
  /** False keeps a version out of My mix (an unrepaired scan). Default true. */
  mixable?: boolean;
}

export interface VersionGroup {
  title: string;
  versions: PieceVersion[];
}

export type VersionMap = Record<string, VersionGroup>;

/** Where one file sits among its piece's versions. */
export interface PieceGroupRef {
  slug: string;
  title: string;
  label: string;
  /** Position in the group's list: the switch shows versions in this order. */
  index: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** Parse valid groups from versions.json; a group needs a title and two or more versions. */
export function parseVersions(json: unknown): VersionMap {
  if (!isPlainObject(json)) return {};
  const groups: [string, VersionGroup][] = [];
  for (const [slug, value] of Object.entries(json)) {
    if (!isPlainObject(value) || typeof value.title !== 'string' || !Array.isArray(value.versions)) continue;
    const versions: PieceVersion[] = [];
    for (const v of value.versions) {
      if (!isPlainObject(v) || typeof v.file !== 'string' || typeof v.label !== 'string') continue;
      if (versions.some((seen) => seen.file === v.file)) continue;
      versions.push(v.mixable === false ? { file: v.file, label: v.label, mixable: false } : { file: v.file, label: v.label });
    }
    if (versions.length >= 2) groups.push([slug, { title: value.title, versions }]);
  }
  return Object.fromEntries(groups);
}

/** The group a file belongs to; the first group listing it wins. */
export function groupOf(map: VersionMap, file: string): PieceGroupRef | undefined {
  for (const [slug, group] of Object.entries(map)) {
    const index = group.versions.findIndex((v) => v.file === file);
    if (index >= 0) return { slug, title: group.title, label: group.versions[index].label, index };
  }
  return undefined;
}
