import type { NoteEvent } from '../services/api';

function toVLQ(n: number): number[] {
  let buffer = [n & 0x7f];
  while ((n >>= 7) > 0) {
    buffer.unshift((n & 0x7f) | 0x80);
  }
  return buffer;
}

export function createMidiUint8Array(
  notes: NoteEvent[],
  tempo: number = 140,
  ppq: number = 96,
  trackName: string = 'Pattern'
): Uint8Array {
  const events: { pos: number; type: number; pitch: number; vel: number }[] = [];
  notes.forEach((n) => {
    // FL Studio numbers octaves 1 higher than MIDI standard (Middle C = C5 in FL, C4 in MIDI).
    // Subtract 12 so notes land on the correct octave after import.
    const pitch = Math.max(0, Math.min(127, Math.round(n.pitch) - 12));
    const pos = Math.max(0, Math.round(n.pos));
    const dur = Math.max(1, Math.round(n.duration));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity || 100)));

    events.push({ pos, type: 0x90, pitch, vel });
    events.push({ pos: pos + dur, type: 0x80, pitch, vel: 0 });
  });

  // Sort events chronologically. For same pos, note_off (0x80) comes before note_on (0x90)
  events.sort((a, b) => a.pos - b.pos || (a.type === 0x80 ? -1 : 1));

  const trackBytes: number[] = [];

  // Track name event: 00 FF 03 len name
  const safeName = (trackName || 'Pattern').replace(/[^\x00-\x7F]/g, '');
  const nameBytes = Array.from(new TextEncoder().encode(safeName));
  trackBytes.push(0x00, 0xff, 0x03, ...toVLQ(nameBytes.length), ...nameBytes);

  // Set Tempo event: 00 FF 51 03 t1 t2 t3 (microseconds per beat)
  const mpqn = Math.round(60000000 / (tempo > 0 ? tempo : 140));
  trackBytes.push(0x00, 0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff);

  let lastPos = 0;
  for (const ev of events) {
    const delta = ev.pos - lastPos;
    lastPos = ev.pos;
    trackBytes.push(...toVLQ(delta));
    trackBytes.push(ev.type, ev.pitch, ev.vel);
  }

  // End of Track event: 00 FF 2F 00
  trackBytes.push(0x00, 0xff, 0x2f, 0x00);

  // Header chunk: MThd, length 6, format 0, 1 track, ppq division
  const header = [
    0x4d, 0x54, 0x68, 0x64, // 'MThd'
    0x00, 0x00, 0x00, 0x06, // Chunk length 6
    0x00, 0x00,             // Format 0 (single track)
    0x00, 0x01,             // 1 track
    (ppq >> 8) & 0xff, ppq & 0xff // Division (PPQ)
  ];

  // Track chunk: MTrk, length, trackBytes
  const tLen = trackBytes.length;
  const trackChunkHeader = [
    0x4d, 0x54, 0x72, 0x6b, // 'MTrk'
    (tLen >> 24) & 0xff, (tLen >> 16) & 0xff, (tLen >> 8) & 0xff, tLen & 0xff
  ];

  return new Uint8Array([...header, ...trackChunkHeader, ...trackBytes]);
}

export function generateMidiBase64(
  notes: NoteEvent[],
  tempo: number = 140,
  ppq: number = 96,
  trackName: string = 'Pattern'
): string {
  const bytes = createMidiUint8Array(notes, tempo, ppq, trackName);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}
