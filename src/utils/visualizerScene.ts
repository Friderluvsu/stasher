import { Midi } from '@tonejs/midi';
import type { NoteEvent, PatternItem, VisualizerFlpResponse, VisualizerSong, VisualizerSongClip } from '../services/api';

export type VisualizerSourceKind = 'flp' | 'midi' | 'vault';

export interface VisualizerSource {
  id: string;
  kind: VisualizerSourceKind;
  name: string;
  // The file the parts came from. Identity of an import: names are display text and can repeat (Save-as keeps the FLP title).
  fileName: string;
  tempo: number;
  ppq: number;
  song: VisualizerSong | null;
  partIds: number[];
}

export interface VisualizerScene {
  kind: 'loop' | 'song';
  scene: PatternItem;
  tracks: PatternItem[];
  durationSeconds: number;
  bars: number;
  tempo: number;
  ppq: number;
  markers: number[];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURAL_PITCHES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const BEATS_PER_BAR = 4;
const FL_PITCH_OFFSET = 12;

let partIdCounter = -1000;
let sourceCounter = 0;
// Part id -> source id, so merging stays per source even after the UI copies part objects.
const partSources = new Map<number, string>();
// All parts of an imported FLP: song scenes need the parts the user did not select (duplicates, pattern lengths).
const sourceParts = new Map<string, PatternItem[]>();
const notesSignatures = new WeakMap<NoteEvent[], string>();

export function nextVisualizerPartId(): number {
  return partIdCounter--;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const positive = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
const tempoOf = (item: { tempo?: number } | null | undefined, fallback = 120) => positive(item?.tempo, fallback);
const ppqOf = (item: { ppq?: number } | null | undefined, fallback = 96) => Math.round(positive(item?.ppq, fallback));
const byTime = (a: NoteEvent, b: NoteEvent) => a.pos - b.pos || a.pitch - b.pitch;
const barsFor = (ticks: number, barTicks: number) => Math.max(1, Math.ceil(ticks / barTicks - 1e-6));
const secondsFor = (ticks: number, tempo: number, ppq: number) => Math.max(.25, ticks * 60 / (tempo * ppq));
const nextSourceId = (kind: VisualizerSourceKind) => `${kind}-${++sourceCounter}`;

function cleanNotes(notes: NoteEvent[] | null | undefined): NoteEvent[] {
  const result: NoteEvent[] = [];
  for (const note of notes || []) {
    if (!note || !Number.isFinite(note.pitch) || !Number.isFinite(note.pos) || !Number.isFinite(note.duration) || !Number.isFinite(note.velocity) || note.velocity <= 0) continue;
    result.push({
      pitch: clamp(Math.round(note.pitch), 0, 127),
      pos: Math.max(0, Math.round(note.pos)),
      duration: Math.max(1, Math.round(note.duration)),
      velocity: clamp(Math.round(note.velocity), 1, 127),
    });
  }
  return result.sort(byTime);
}

function notesEnd(notes: NoteEvent[] | null | undefined): number {
  let end = 0;
  for (const note of notes || []) {
    const noteEnd = note.pos + Math.max(1, note.duration);
    if (Number.isFinite(noteEnd)) end = Math.max(end, noteEnd);
  }
  return end;
}

const partTicks = (part: PatternItem) => Math.max(1, notesEnd(part.notes), positive(part.loop_ticks, 0));

function keyFromNotes(notes: NoteEvent[]): string {
  if (!notes.length) return '—';
  const lowest = notes.reduce((min, note) => Math.min(min, note.pitch), 127);
  return NOTE_NAMES[((lowest % 12) + 12) % 12];
}

// @tonejs/midi names a key signature by its major key even when the scale is minor (4 sharps + minor -> "E").
function keySignatureLabel(signature: { key?: string; scale?: string } | undefined): string {
  const match = signature?.key?.match(/^([A-G])([#b]?)$/);
  if (!match) return '';
  if (signature.scale !== 'minor') return signature.key;
  const pitchClass = (NATURAL_PITCHES[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0) + 21) % 12;
  return `${(match[2] === 'b' ? FLAT_NAMES : NOTE_NAMES)[pitchClass]}m`;
}

function sourceKeyOf(part: PatternItem): string {
  return partSources.get(part.id) ?? (part.project_id >= 0 ? `vault-${part.project_id}` : `file-${part.project_file_name}|${part.project_title}`);
}

function partSignature(part: PatternItem): string {
  const notes = part.notes || [];
  let signature = notesSignatures.get(notes);
  if (signature === undefined) {
    signature = [...notes].sort((a, b) => byTime(a, b) || a.duration - b.duration || a.velocity - b.velocity)
      .map(note => `${note.pos}:${note.pitch}:${note.duration}:${note.velocity}`).join(',');
    notesSignatures.set(notes, signature);
  }
  return `${part.channel_index}|${part.channel_name}|${tempoOf(part)}|${ppqOf(part)}|${signature}`;
}

function registerSource(source: VisualizerSource, parts: PatternItem[], keepParts: boolean) {
  for (const part of parts) partSources.set(part.id, source.id);
  if (keepParts) sourceParts.set(source.id, parts);
}

// Bar-aligned length of every pattern of one source (FL pads patterns to whole bars).
function patternLengths(parts: PatternItem[], ppq: number): Map<number, number> {
  const barTicks = ppq * BEATS_PER_BAR;
  const lengths = new Map<number, number>();
  for (const part of parts) {
    if (!part.notes?.length) continue;
    const ticks = Math.max(partTicks(part) * ppq / ppqOf(part, ppq), lengths.get(part.pattern_index) || 0);
    lengths.set(part.pattern_index, ticks);
  }
  for (const [index, ticks] of lengths) lengths.set(index, barsFor(ticks, barTicks) * barTicks);
  return lengths;
}

function scaleNotes(part: PatternItem, tempo: number, ppq: number): { notes: NoteEvent[]; ticks: number } {
  const ratio = (tempo / tempoOf(part, tempo)) * (ppq / ppqOf(part, ppq));
  const notes = cleanNotes(part.notes);
  if (Math.abs(ratio - 1) < 1e-9) return { notes, ticks: Math.max(partTicks(part), notesEnd(notes)) };
  const scaled = notes.map(note => ({ ...note, pos: Math.round(note.pos * ratio), duration: Math.max(1, Math.round(note.duration * ratio)) }));
  return { notes: scaled, ticks: Math.max(partTicks(part) * ratio, notesEnd(scaled)) };
}

interface TrackDraft { source: string; first: PatternItem; patterns: Set<number>; notes: NoteEvent[] }

function draftFor(drafts: Map<string, TrackDraft>, part: PatternItem, source: string): TrackDraft {
  const key = `${source}|${part.channel_index}`;
  let draft = drafts.get(key);
  if (!draft) {
    draft = { source, first: part, patterns: new Set(), notes: [] };
    drafts.set(key, draft);
  }
  draft.patterns.add(part.pattern_index);
  return draft;
}

// One track per instrument: sources keep their first-seen order, channels follow the channel rack order.
function finishTracks(drafts: Map<string, TrackDraft>, tempo: number, ppq: number, loopTicks: number): PatternItem[] {
  const sourceOrder = new Map<string, number>();
  for (const draft of drafts.values()) if (!sourceOrder.has(draft.source)) sourceOrder.set(draft.source, sourceOrder.size);
  return [...drafts.values()]
    .filter(draft => draft.notes.length)
    .sort((a, b) => sourceOrder.get(a.source)! - sourceOrder.get(b.source)! || a.first.channel_index - b.first.channel_index)
    .map(({ first, patterns, notes }) => {
      notes.sort(byTime);
      return {
        ...first,
        pattern_name: patterns.size > 1 ? first.channel_name || first.pattern_name : first.pattern_name,
        notes,
        note_count: notes.length,
        tempo,
        ppq,
        bars: loopTicks / (ppq * BEATS_PER_BAR),
        loop_ticks: loopTicks,
      };
    });
}

function sceneFrom(kind: VisualizerScene['kind'], base: PatternItem, name: string, tracks: PatternItem[], tempo: number, ppq: number, loopTicks: number, markers: number[]): VisualizerScene {
  const notes = tracks.length === 1 ? tracks[0].notes : tracks.flatMap(track => track.notes).sort(byTime);
  const bars = loopTicks / (ppq * BEATS_PER_BAR);
  const single = tracks.length === 1 && kind === 'loop';
  return {
    kind,
    scene: {
      ...(single ? tracks[0] : base),
      id: nextVisualizerPartId(),
      pattern_name: single ? tracks[0].pattern_name : name,
      channel_name: single ? tracks[0].channel_name : 'Multi MIDI',
      tag: single ? tracks[0].tag : 'Melody',
      sample_path: null,
      notes,
      note_count: notes.length,
      tempo,
      ppq,
      bars,
      loop_ticks: loopTicks,
    },
    tracks,
    durationSeconds: secondsFor(loopTicks, tempo, ppq),
    bars,
    tempo,
    ppq,
    markers,
  };
}

function normalizeSong(song: VisualizerSong | null | undefined): VisualizerSong | null {
  if (!song || !Array.isArray(song.clips)) return null;
  const clips: VisualizerSongClip[] = [];
  for (const clip of song.clips) {
    if (!clip || !Number.isFinite(clip.pattern_index) || !Number.isFinite(clip.position) || !(clip.length > 0) || !Number.isFinite(clip.length)) continue;
    clips.push({
      pattern_index: clip.pattern_index,
      position: Math.max(0, clip.position),
      length: clip.length,
      offset: Number.isFinite(clip.offset) && clip.offset > 0 ? clip.offset : 0,
      track: Number.isFinite(clip.track) ? clip.track : 0,
    });
  }
  if (!clips.length) return null;
  clips.sort((a, b) => a.position - b.position || a.track - b.track);
  const end = clips.reduce((max, clip) => Math.max(max, clip.position + clip.length), 0);
  return { ticks: Math.max(end, positive(song.ticks, 0)), clips };
}

export function partsFromFlp(project: VisualizerFlpResponse): { source: VisualizerSource; parts: PatternItem[] } {
  const tempo = tempoOf(project);
  const ppq = ppqOf(project);
  const fileStem = (project.file_name || '').replace(/\.flp$/i, '');
  const title = project.title || fileStem || 'FL Studio';
  // "Save as" keeps the project Title, so several versions can share it: show the file too when the two differ.
  const label = project.title && fileStem && project.title.trim().toLowerCase() !== fileStem.trim().toLowerCase() ? `${project.title} (${fileStem})` : title;
  const raw = (project.patterns || []).map(pattern => ({ pattern, notes: cleanNotes(pattern.notes) })).filter(item => item.notes.length);
  const lengths = patternLengths(raw.map(({ pattern, notes }) => ({ ...pattern, notes } as PatternItem)), ppq);
  const parts: PatternItem[] = raw.map(({ pattern, notes }) => {
    const partPpq = ppqOf(pattern, ppq);
    const loopTicks = Math.round((lengths.get(pattern.pattern_index) || notesEnd(notes)) * partPpq / ppq);
    return {
      id: nextVisualizerPartId(),
      project_id: -1,
      pattern_index: pattern.pattern_index,
      pattern_name: pattern.pattern_name || `Pattern ${pattern.pattern_index}`,
      channel_index: pattern.channel_index,
      channel_name: pattern.channel_name || pattern.pattern_name || 'Channel',
      sample_path: null,
      tag: pattern.tag || 'Other',
      bars: Math.max(1, Math.round(loopTicks / (partPpq * BEATS_PER_BAR))),
      key_root: pattern.key_root || keyFromNotes(notes),
      note_count: notes.length,
      tempo: tempoOf(pattern, tempo),
      ppq: partPpq,
      notes,
      project_title: title,
      project_file_name: project.file_name || '',
      project_file_path: '',
      loop_ticks: loopTicks,
    };
  });
  const source: VisualizerSource = { id: nextSourceId('flp'), kind: 'flp', name: label, fileName: project.file_name || title, tempo, ppq, song: normalizeSong(project.song), partIds: parts.map(part => part.id) };
  registerSource(source, parts, true);
  return { source, parts };
}

export async function partsFromMidiFile(file: File, trackLabel: string): Promise<{ source: VisualizerSource; parts: PatternItem[] }> {
  const midi = new Midi(await file.arrayBuffer());
  const ppq = ppqOf(midi.header, 480);
  // Keep fractional tempos (87.5 BPM must not become 88); the grid tempo only drives the bar/beat overlay and BPM display.
  const tempo = Math.max(1, Math.round(positive(midi.header.tempos[0]?.bpm, 120) * 1000) / 1000);
  // The scene is a constant-tempo grid. Note.time/duration already go through the file's tempo map, so converting them back to
  // ticks at the grid tempo keeps the notes in sync with attached audio even when the MIDI changes tempo mid-song.
  const toTick = (seconds: number) => Math.round(seconds * tempo * ppq / 60);
  const name = file.name.replace(/\.(midi?|kar)$/i, '') || file.name;
  const key = keySignatureLabel(midi.header.keySignatures[0]);
  const tracks = midi.tracks
    .map(track => ({
      track,
      // FLP and vault notes carry FL's octave naming (standard MIDI + 12, see parser.py); matching it keeps mixed scenes aligned.
      notes: cleanNotes(track.notes.map(note => {
        const pos = toTick(note.time);
        return { pitch: note.midi + FL_PITCH_OFFSET, pos, duration: Math.max(1, toTick(note.time + note.duration) - pos), velocity: note.velocity * 127 };
      })),
    }))
    .filter(item => item.notes.length);
  const barTicks = ppq * BEATS_PER_BAR;
  // Every track shares the file timeline, so all parts get the file's bar-aligned length.
  const loopTicks = barsFor(tracks.reduce((max, item) => Math.max(max, notesEnd(item.notes)), 1), barTicks) * barTicks;
  const parts: PatternItem[] = tracks.map(({ track, notes }, index) => {
    const trackName = track.name?.trim() || `${trackLabel} ${index + 1}`;
    return {
      id: nextVisualizerPartId(),
      project_id: -1,
      pattern_index: 0,
      pattern_name: trackName,
      channel_index: index,
      channel_name: trackName,
      sample_path: null,
      tag: track.instrument?.percussion ? 'Perc' : 'Melody',
      bars: loopTicks / barTicks,
      key_root: key || keyFromNotes(notes),
      note_count: notes.length,
      tempo,
      ppq,
      notes,
      project_title: name,
      project_file_name: file.name,
      project_file_path: '',
      loop_ticks: loopTicks,
    };
  });
  const source: VisualizerSource = { id: nextSourceId('midi'), kind: 'midi', name, fileName: file.name, tempo, ppq, song: null, partIds: parts.map(part => part.id) };
  registerSource(source, parts, false);
  return { source, parts };
}

export function vaultSources(patterns: PatternItem[]): { source: VisualizerSource; parts: PatternItem[] }[] {
  const groups = new Map<number, PatternItem[]>();
  for (const pattern of patterns || []) {
    const group = groups.get(pattern.project_id);
    if (group) group.push(pattern);
    else groups.set(pattern.project_id, [pattern]);
  }
  return [...groups.entries()].map(([projectId, group]) => {
    const first = group[0];
    const ppq = ppqOf(first);
    const lengths = patternLengths(group, ppq);
    const parts = group.map(pattern => {
      const length = lengths.get(pattern.pattern_index);
      return pattern.notes?.length && length && !(pattern.loop_ticks > 0) ? { ...pattern, loop_ticks: Math.round(length * ppqOf(pattern, ppq) / ppq) } : pattern;
    });
    const source: VisualizerSource = {
      id: `vault-${projectId}`,
      kind: 'vault',
      name: first.project_title || (first.project_file_name || '').replace(/\.flp$/i, '') || 'Vault',
      fileName: first.project_file_name || '',
      tempo: tempoOf(first),
      ppq,
      song: null,
      partIds: parts.map(part => part.id),
    };
    registerSource(source, parts, false);
    return { source, parts };
  });
}

export function findDuplicateParts(parts: PatternItem[]): Set<number> {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  for (const part of parts || []) {
    if (!part?.notes?.length) continue;
    const signature = partSignature(part);
    if (seen.has(signature)) duplicates.add(part.id);
    else seen.add(signature);
  }
  return duplicates;
}

export function buildLoopScene(parts: PatternItem[]): VisualizerScene | null {
  const usable = (parts || []).filter(part => part?.notes?.length);
  if (!usable.length) return null;
  const duplicates = findDuplicateParts(usable);
  const tempo = tempoOf(usable[0]);
  const ppq = ppqOf(usable[0]);
  const barTicks = ppq * BEATS_PER_BAR;
  const items = usable
    .filter(part => !duplicates.has(part.id))
    .map(part => ({ part, source: sourceKeyOf(part), ...scaleNotes(part, tempo, ppq) }))
    .filter(item => item.notes.length);
  if (!items.length) return null;
  const groupBars = new Map<string, number>();
  const groupOf = (item: typeof items[number]) => `${item.source}|${item.part.pattern_index}`;
  for (const item of items) groupBars.set(groupOf(item), Math.max(groupBars.get(groupOf(item)) || 1, barsFor(item.ticks, barTicks)));
  const bars = Math.max(...groupBars.values());
  const loopTicks = bars * barTicks;
  const drafts = new Map<string, TrackDraft>();
  for (const item of items) {
    const ownBars = groupBars.get(groupOf(item))!;
    // A shorter pattern that fits a whole number of times repeats, like a loop placed under a longer one.
    const repeats = bars % ownBars === 0 ? bars / ownBars : 1;
    const draft = draftFor(drafts, item.part, item.source);
    for (let repeat = 0; repeat < repeats; repeat++) {
      const shift = repeat * ownBars * barTicks;
      for (const note of item.notes) {
        const pos = note.pos + shift;
        if (pos < loopTicks) draft.notes.push({ ...note, pos, duration: Math.max(1, Math.min(note.duration, loopTicks - pos)) });
      }
    }
  }
  const tracks = finishTracks(drafts, tempo, ppq, loopTicks);
  if (!tracks.length) return null;
  const names = new Set(items.map(item => item.part.project_title).filter(Boolean));
  const name = names.size === 1 ? [...names][0] : `${tracks.length} tracks`;
  return sceneFrom('loop', items[0].part, name, tracks, tempo, ppq, loopTicks, []);
}

export function buildSongScene(source: VisualizerSource, parts: PatternItem[]): VisualizerScene | null {
  const song = normalizeSong(source?.song);
  if (!song) return null;
  const tempo = tempoOf(source);
  const ppq = ppqOf(source);
  const barTicks = ppq * BEATS_PER_BAR;
  const ownIds = new Set(source.partIds || []);
  const selected = (parts || []).filter(part => part?.notes?.length && (!ownIds.size || ownIds.has(part.id)));
  if (!selected.length) return null;
  const all = sourceParts.get(source.id) || selected;
  const selectedIds = new Set(selected.map(part => part.id));
  const selectedSignatures = new Set(selected.map(partSignature));
  // FL often repeats a channel with identical notes in several patterns; selecting it once shows it wherever it plays.
  const active = [...selected, ...all.filter(part => !selectedIds.has(part.id) && part.notes?.length && selectedSignatures.has(partSignature(part)))];
  const periods = patternLengths([...all, ...active], ppq);
  const sourceKey = source.id;
  const byPattern = new Map<number, { draft: TrackDraft; notes: NoteEvent[] }[]>();
  const drafts = new Map<string, TrackDraft>();
  for (const part of active) {
    const { notes } = scaleNotes(part, tempo, ppq);
    if (!notes.length) continue;
    const list = byPattern.get(part.pattern_index) || [];
    list.push({ draft: draftFor(drafts, part, sourceKey), notes });
    byPattern.set(part.pattern_index, list);
  }
  let used = false;
  for (const clip of song.clips) {
    const entries = byPattern.get(clip.pattern_index);
    if (!entries) continue;
    const period = Math.max(1, periods.get(clip.pattern_index) || barTicks);
    const start = clip.offset;
    const end = start + clip.length;
    for (const { draft, notes } of entries) {
      for (let repeat = Math.floor(start / period); repeat * period < end; repeat++) {
        for (const note of notes) {
          const tick = note.pos + repeat * period;
          if (tick < start || tick >= end) continue;
          draft.notes.push({ ...note, pos: Math.round(clip.position + tick - start), duration: Math.max(1, Math.round(Math.min(note.duration, end - tick))) });
          used = true;
        }
      }
    }
  }
  if (!used) return null;
  const loopTicks = barsFor(Math.max(song.ticks, ...[...drafts.values()].map(draft => notesEnd(draft.notes))), barTicks) * barTicks;
  const tracks = finishTracks(drafts, tempo, ppq, loopTicks);
  const markers = [...new Set(song.clips.map(clip => clip.position))].filter(position => position < loopTicks).sort((a, b) => a - b).map(position => position / loopTicks);
  return sceneFrom('song', selected[0], source.name, tracks, tempo, ppq, loopTicks, markers);
}

export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds + 1e-6) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function positionLabel(scene: VisualizerScene, progress: number): { clock: string; total: string; bar: number; beat: number } {
  const ppq = ppqOf(scene, 96);
  const barTicks = ppq * BEATS_PER_BAR;
  const totalTicks = positive(scene.scene?.loop_ticks, positive(scene.bars, 1) * barTicks);
  const amount = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
  const tick = Math.min(amount * totalTicks, Math.max(0, totalTicks - 1e-3));
  return {
    clock: formatClock(amount * scene.durationSeconds),
    total: formatClock(scene.durationSeconds),
    bar: Math.floor(tick / barTicks) + 1,
    beat: Math.floor((tick % barTicks) / ppq) + 1,
  };
}
