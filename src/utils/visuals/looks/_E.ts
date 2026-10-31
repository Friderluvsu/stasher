import type { Frame, TrackView } from '../frame';
import { clamp } from '../frame';
import { partLabel, roleLabel, trackColorAt, trackRole } from '../kit';

// Helpers shared by agent E's looks (oracle, weather, orrery, stars, filament, eclipse).

// Muted part colours of the reference for the first three parts, kit defaults after that.
const REF_COLORS = ['#7a5fd4', '#2fa79a', '#d74a38'];
export const partColor = (track: TrackView) => (track.slot < 3 ? REF_COLORS[track.slot] : trackColorAt(track.slot));

const DRUM_REGISTERS: [RegExp, number][] = [
  [/\b(open[\s-]?hat|oh)\b/i, .93], [/\b(kick|kck|bd|bassdrum)\b|бочк|кик/i, .04], [/\btoms?\b/i, .3], [/\b(snare|snr|sd)\b|снейр/i, .5],
  [/\b(clap|snap)\b|клэп|клап/i, .56], [/\b(rim|rimshot)\b/i, .6], [/\b(perc|shaker|conga|bongo|tamb\w*|cowbell)\b|перк/i, .68],
  [/hi[\s-]?hat|\bhh\b|\bhats?\b|хэт/i, .86], [/\b(crash|cymbal|ride|splash)\b/i, 1],
];

export interface PitchMap {
  low: number;
  high: number;
  /** 0..1 position of a note of `track` inside the shared pitch range. */
  norm(track: TrackView, pitch: number): number;
}

/** One shared pitch range over the melodic parts; drum parts sit at a register by name (kick low, hats high). */
export function pitchMap(F: Frame): PitchMap {
  let low = Infinity, high = -Infinity;
  for (const track of F.tracks) {
    if (trackRole(track) === 'drums') continue;
    low = Math.min(low, track.index.minPitch);
    high = Math.max(high, track.index.maxPitch);
  }
  if (!(high >= low)) {
    low = F.notes.n ? F.notes.minPitch : 48;
    high = F.notes.n ? F.notes.maxPitch : 72;
  }
  if (high - low < 12) { const mid = (low + high) / 2; low = mid - 6; high = mid + 6; }
  low = Math.floor(low); high = Math.ceil(high);
  const registers = new Map<TrackView, number>();
  return {
    low, high,
    norm(track, pitch) {
      if (trackRole(track) !== 'drums') return clamp((pitch - low) / (high - low));
      let register = registers.get(track);
      if (register === undefined) {
        const label = `${track.tag} ${track.name}`;
        register = .5;
        for (const [pattern, value] of DRUM_REGISTERS) if (pattern.test(label)) { register = value; break; }
        registers.set(track, register);
      }
      return clamp(register + (pitch - track.index.minPitch) * .012);
    },
  };
}

/** Legend labels: role names when unique ("BASS"), part names otherwise. */
export function legendLabels(F: Frame, tracks: TrackView[] = F.tracks): string[] {
  const roles = tracks.map(roleLabel);
  return tracks.map((track, i) => (roles.filter(role => role === roles[i]).length > 1 ? partLabel(track, 9) : roles[i]));
}
