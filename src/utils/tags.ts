// One list of categories for the sidebar, tag picker, edit dialog and kit builder.
// Keep in sync with CANONICAL_TAGS in backend/core/database.py.
export const TAGS = [
  '808', 'Kick', 'Snare', 'Clap', 'Hi-Hat', 'Open Hat',
  'Rim', 'Perc', 'Tom', 'Crash', 'Bass', 'Chords',
  'Melody', 'Lead', 'Pluck', 'Vox', 'FX', 'Other',
] as const;

const TAG_ICONS: Record<string, string> = {
  All: 'ti-category',
  '808': 'ti-flame',
  Kick: 'ti-circle-dot',
  Snare: 'ti-circle-dashed',
  Clap: 'ti-hand-stop',
  'Hi-Hat': 'ti-sparkles',
  'Open Hat': 'ti-ripple',
  Rim: 'ti-crosshair',
  Perc: 'ti-grain',
  Tom: 'ti-circles',
  Crash: 'ti-sun',
  Bass: 'ti-wave-sine',
  Chords: 'ti-piano',
  Melody: 'ti-music',
  Lead: 'ti-wand',
  Pluck: 'ti-guitar-pick',
  Vox: 'ti-microphone',
  FX: 'ti-bolt',
  Other: 'ti-dots',
};

export function tagIcon(tag: string): string {
  return TAG_ICONS[canonicalTag(tag)] || 'ti-tag';
}

/** Mirrors the engine's normalize_tag so the UI compares tags the way the vault stores them. */
export function canonicalTag(tag: string | null | undefined): string {
  const t = (tag || '').trim();
  if (!t) return 'Other';
  const lower = t.toLowerCase().replace(/\s+/g, ' ');
  const alias = lower === 'hihat' ? 'hi-hat' : lower === 'openhat' ? 'open hat' : lower;
  return TAGS.find((x) => x.toLowerCase() === alias) || t;
}

/** Prefix matches first, then substring matches, so "h" offers Hi-Hat before Chords. */
export function filterTags(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...TAGS];
  const starts = TAGS.filter((t) => t.toLowerCase().startsWith(q));
  const contains = TAGS.filter((t) => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q));
  return [...starts, ...contains];
}
