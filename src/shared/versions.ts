// Versions of one piece (#9627): versions.json beside trust.json groups the files that
// are the same song (an easy book arrangement, a harder one, his own mix), so the
// picker lists the song once with a switch between them.

import type { MixChoice, MixSection } from './mix';
import { PieceTrust, parseTrust } from './trust';

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
  /** His saved My mix (mixes.json), merged in by withMixes. */
  saved?: SavedMix;
}

/** One saved My mix (mixes.json, local to each machine: never synced). */
export interface SavedMix {
  file: string;
  harder: string;
  choice: MixChoice[];
  trust: PieceTrust;
}

/** What the My mix builder needs: the two files, their sections, his last choice. */
export interface MixPlan {
  easy: string;
  harder: string;
  /** Semitones from the Harder key to the Easy key. */
  semis: number;
  sections: MixSection[];
  choice?: MixChoice[];
}

export type VersionMap = Record<string, VersionGroup>;

/** Where one file sits among its piece's versions. */
export interface PieceGroupRef {
  slug: string;
  title: string;
  label: string;
  /** Position in the group's list: the switch shows versions in this order. */
  index: number;
  /** Present when the song can be mixed (an aligned, mixable Harder version). */
  mix?: MixPlan;
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

/** Easy plus the first aligned, mixable Harder version, with his saved choice when it still fits. */
export function mixPlanOf(group: VersionGroup): MixPlan | undefined {
  const easy = group.versions.find((v) => v.label === 'Easy');
  const harder = group.versions.find(
    (v) => v.label !== 'Easy' && v.label !== 'My mix' && v.mixable !== false && group.align?.[v.file],
  );
  if (!easy || !harder) return undefined;
  const { sections, semis } = group.align![harder.file];
  const saved = group.saved;
  const fits = saved && saved.harder === harder.file && saved.choice.length === sections.length;
  return { easy: easy.file, harder: harder.file, semis, sections, ...(fits ? { choice: saved.choice } : {}) };
}

/** The group a file belongs to; the first group listing it wins. */
export function groupOf(map: VersionMap, file: string): PieceGroupRef | undefined {
  for (const [slug, group] of Object.entries(map)) {
    const index = group.versions.findIndex((v) => v.file === file);
    if (index < 0) continue;
    const mix = mixPlanOf(group);
    return { slug, title: group.title, label: group.versions[index].label, index, ...(mix ? { mix } : {}) };
  }
  return undefined;
}

/** Valid entries of mixes.json: {slug: {file, harder, choice, trust}}. */
export function parseMixes(json: unknown): Record<string, SavedMix> {
  if (!isPlainObject(json)) return {};
  const out: Record<string, SavedMix> = {};
  for (const [slug, v] of Object.entries(json)) {
    if (!isPlainObject(v) || typeof v.file !== 'string' || typeof v.harder !== 'string' || !Array.isArray(v.choice)) continue;
    if (!v.choice.every((c) => c === 'easy' || c === 'harder')) continue;
    const trust = parseTrust({ [v.file]: v.trust })[v.file];
    // A mix is never "verified by you": it is a new file nobody has reviewed.
    if (!trust || trust.status === 'verified') continue;
    out[slug] = { file: v.file, harder: v.harder, choice: v.choice as MixChoice[], trust };
  }
  return out;
}

/** Add each saved mix to its group as a "My mix" version (not mixable itself). */
export function withMixes(map: VersionMap, mixes: Record<string, SavedMix>): VersionMap {
  const out: VersionMap = { ...map };
  for (const [slug, saved] of Object.entries(mixes)) {
    const group = map[slug];
    if (!group || !group.versions.some((v) => v.file === saved.harder) || group.versions.some((v) => v.file === saved.file)) continue;
    out[slug] = { ...group, versions: [...group.versions, { file: saved.file, label: 'My mix', mixable: false }], saved };
  }
  return out;
}
