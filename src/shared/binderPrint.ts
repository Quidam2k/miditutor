export interface LayoutSystemLite {
  index: number;
  page: string;
  measures: [number, number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function layoutSystems(layout: unknown): LayoutSystemLite[] | null {
  if (!isRecord(layout) || !Array.isArray(layout.systems)) return null;
  const systems: LayoutSystemLite[] = [];
  const indices = new Set<number>();
  for (const system of layout.systems) {
    if (!isRecord(system) ||
        !isPositiveInteger(system.index) || indices.has(system.index) ||
        typeof system.page !== 'string' || system.page.trim() === '' ||
        !Array.isArray(system.measures) || system.measures.length !== 2 ||
        !isPositiveInteger(system.measures[0]) ||
        !isPositiveInteger(system.measures[1]) ||
        system.measures[1] < system.measures[0]) return null;
    indices.add(system.index);
    systems.push({
      index: system.index,
      page: system.page,
      measures: [system.measures[0], system.measures[1]],
    });
  }
  return systems;
}

/** Print each page on both sides of its sheet. */
export function binderSides(pages: number): number[] {
  if (!isPositiveInteger(pages)) return [];
  const sides: number[] = [];
  for (let page = 1; page <= pages; page++) sides.push(page, page);
  return sides;
}

/** List the overlapping spreads seen in the binder. */
export function binderSpreads(pages: number): [number, number][] {
  if (!isPositiveInteger(pages)) return [];
  const spreads: [number, number][] = [];
  for (let page = 1; page < pages; page++) spreads.push([page, page + 1]);
  return spreads;
}

/** Read the first measure of each paper page in system order. */
export function paperPageStarts(layout: unknown): number[] {
  const systems = layoutSystems(layout);
  if (!systems) return [];
  const pages = new Set<string>();
  const starts: number[] = [];
  for (const system of systems) {
    if (pages.has(system.page)) continue;
    pages.add(system.page);
    starts.push(system.measures[0]);
  }
  return starts;
}

/** Lines he has confirmed in Review against this layout's score (each line once). */
export function confirmedLines(layout: unknown, eventsJsonl: string): { confirmed: number; total: number } {
  const systems = layoutSystems(layout);
  if (!systems || !isRecord(layout)) return { confirmed: 0, total: 0 };
  const total = systems.length;
  const indices = new Set(systems.map((system) => system.index));
  const events: Record<string, unknown>[] = [];
  for (const line of eventsJsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event: unknown = JSON.parse(line);
      if (isRecord(event)) events.push(event);
    } catch {
      // Ignore incomplete or invalid lines.
    }
  }
  const confirmed = new Set<number>();
  for (const event of events) {
    if (event.kind !== 'confirm_system' || typeof event.system !== 'number' || !indices.has(event.system)) continue;
    if (typeof event.sha === 'string' && typeof layout.score_sha256 === 'string' &&
        event.sha !== layout.score_sha256) continue;
    confirmed.add(event.system);
  }
  return { confirmed: Math.min(confirmed.size, total), total };
}

/** #6083: the amber line above the print preview; '' for a verified score (no banner). */
export function binderWarning(verified: boolean, confirmed: number, total: number): string {
  if (verified) return '';
  const lines = total > 0 && confirmed > 0 ? ` (${confirmed} of ${total} lines confirmed)` : '';
  return `Not verified yet${lines}. You can still print it, but check it against your paper first.`;
}
