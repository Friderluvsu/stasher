export type RGB = [number, number, number];

export const DEFAULT_ACCENT = '#a99aff';

const clamp01 = (value: number) => (value > 0 ? (value < 1 ? value : 1) : 0);
const ALPHA_HEX = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, '0'));

export const withAlpha = (hex: string, alpha: number) => hex + ALPHA_HEX[Math.round(clamp01(alpha) * 255)];

export function normalizeHex(input: unknown, fallback = DEFAULT_ACCENT): string {
  if (typeof input !== 'string') return fallback;
  const value = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) return `#${value.slice(0, 6).toLowerCase()}`;
  if (/^[0-9a-f]{3,4}$/i.test(value)) return `#${value.slice(0, 3).split('').map(char => char + char).join('').toLowerCase()}`;
  return fallback;
}

export function hexToRgb(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1, 7), 16) || 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))) | 0;
export const rgbToHex = (r: number, g: number, b: number) => `#${((1 << 24) | (channel(r) << 16) | (channel(g) << 8) | channel(b)).toString(16).slice(1)}`;

const mixCache = new Map<string, string>();

// Quantised so per-frame colour animation reuses a small set of strings (and glow sprites).
export function mix(a: string, b: string, amount: number): string {
  const step = Math.round(clamp01(amount) * 32);
  if (step === 0) return a;
  if (step === 32) return b;
  const key = `${a}${b}${step}`;
  const known = mixCache.get(key);
  if (known) return known;
  const from = hexToRgb(a), to = hexToRgb(b), t = step / 32;
  const value = rgbToHex(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t);
  if (mixCache.size > 4096) mixCache.clear();
  mixCache.set(key, value);
  return value;
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const red = r / 255, green = g / 255, blue = b / 255;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  const lightness = (max + min) / 2, delta = max - min;
  if (!delta) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return [(hue * 60 + 360) % 360, saturation, lightness];
}

export function hsl(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360, s = clamp01(saturation), l = clamp01(lightness);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export interface Palette {
  accent: string;
  hue: number;
  sat: number;
  base: string;
  light: string;
  glow: string;
  secondary: string;
  tertiary: string;
  warm: string;
  ink: string;
  inkSoft: string;
  deep: [string, string, string];
  pitch: string[];
  track: string[];
  ramp: string[];
}

const paletteCache = new Map<string, Palette>();

// Every colour is derived from the accent: pitch classes follow the circle of fifths, so
// consonant notes get neighbouring hues and chords stay harmonious instead of rainbow-noisy.
export function paletteFor(accentInput: unknown): Palette {
  const accent = normalizeHex(accentInput);
  const known = paletteCache.get(accent);
  if (known) return known;
  const rgb = hexToRgb(accent);
  const [hue, , lightness] = rgbToHsl(rgb);
  const chroma = (Math.max(...rgb) - Math.min(...rgb)) / 255;
  const mono = chroma < .1;
  const sat = mono ? chroma * 2.4 : Math.min(.94, .4 + chroma * 1.2);
  const L = Math.min(.72, Math.max(.58, lightness * .92));
  const pitch = Array.from({ length: 12 }, (_, pc) => {
    const angle = ((pc * 7) % 12) / 12 * Math.PI * 2;
    return hsl(hue + Math.sin(angle) * 66, sat, L + Math.cos(angle) * .06);
  });
  const offsets = [0, 42, -40, 84, -86, 150, 118, -128];
  const shifts = [0, .04, -.03, .06, -.02, .03, -.05, .05];
  const track = offsets.map((offset, index) => hsl(hue + offset, mono ? sat : Math.max(sat, .45), mono ? .86 - index * .045 : L + shifts[index]));
  const base = hsl(hue, sat, L);
  const secondary = hsl(hue + 45, sat, L);
  const tertiary = hsl(hue - 45, sat, L - .02);
  const light = hsl(hue, sat * .8, .87);
  const palette: Palette = {
    accent,
    hue,
    sat,
    base,
    light,
    glow: hsl(hue, sat, .76),
    secondary,
    tertiary,
    warm: hsl(hue - 75, mono ? sat : Math.max(sat, .65), .64),
    ink: hsl(hue, sat * .35, .045),
    inkSoft: hsl(hue, sat * .3, .12),
    deep: [hsl(hue, sat * .55, .085), hsl(hue + 28, sat * .5, .055), hsl(hue - 22, sat * .45, .025)],
    pitch,
    track,
    ramp: [tertiary, base, secondary, light],
  };
  if (paletteCache.size > 48) paletteCache.clear();
  paletteCache.set(accent, palette);
  return palette;
}

export function rampColor(palette: Palette, t: number): string {
  const position = clamp01(t) * (palette.ramp.length - 1);
  const index = Math.min(palette.ramp.length - 2, Math.floor(position));
  return mix(palette.ramp[index], palette.ramp[index + 1], position - index);
}
