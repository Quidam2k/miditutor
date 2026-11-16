/** #5799: the three miss sounds he can choose between (the voices themselves live in AudioEngine). */
export type MissKind = 'click' | 'buzz' | 'knock';
export const MISS_KINDS: readonly MissKind[] = ['click', 'buzz', 'knock'];
export const MISS_KIND_DEFAULT: MissKind = 'click';
export const MISS_KIND_LABEL: Record<MissKind, string> = { click: 'Click', buzz: 'Buzz', knock: 'Knock' };
