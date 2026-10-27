// Versions of one piece (#9627): versions.json beside trust.json groups the files that
// are the same song (an easy book arrangement, a harder one, his own mix), so the
// picker lists the song once with a switch between them.

import type { MixSection } from './mix';

export interface PieceVersion {
  file: string;
  /** What the switch shows: "Easy", "Harder", "My mix". */
  label: string;
  /** False keeps a version out of My mix (an unrepaired scan). Default true. */
  mixable?: boolean;
}

/** How a Harder file's bars line up with the Easy one (align_versions.py): the My mix sections. */
export interface VersionAlign {
  /** Semitones from the Harder key to the Easy key. */
  semis: number;
  /** [easy bar, harder bar] pairs along the alignment. */
  bars: [number, number][];
  sections: MixSection[];
}

export interface VersionGroup {
  title: string;
  versions: PieceVersion[];
  /** Keyed by the Harder file name. */
  align?: Record<string, VersionAlign>;
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

const isPair = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n));

function parseAlign(value: unknown): VersionAlign | undefined {
  if (!isPlainObject(value) || typeof value.semis !== 'number' || !Number.isFinite(value.semis)) return undefined;
  if (!Array.isArray(value.bars) || !value.bars.every(isPair)) return undefined;
  if (!Array.isArray(value.sections)) return undefined;
  const sections: MixSection[] = [];
  for (const s of value.sections) {
    if (!isPlainObject(s) || !isPair(s.easy) || !isPair(s.harder)) return undefined;
    sections.push(typeof s.cost === 'number' ? { easy: s.easy, harder: s.harder, cost: s.cost } : { easy: s.easy, harder: s.harder });
  }
  return { semis: value.semis, bars: value.bars, sections };
}

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
    if (versions.length < 2) continue;
    const group: VersionGroup = { title: value.title, versions };
    if (isPlainObject(value.align)) {
      const align: Record<string, VersionAlign> = {};
      for (const [file, entry] of Object.entries(value.align)) {
        const parsed = versions.some((v) => v.file === file) ? parseAlign(entry) : undefined;
        if (parsed) align[file] = parsed;
      }
      if (Object.keys(align).length) group.align = align;
    }
    groups.push([slug, group]);
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
