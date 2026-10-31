import type { Frame } from '../frame';

export type LookGroup = 'midi' | 'audio';

export interface Look {
  id: string;
  /** 'midi' looks draw the real notes; 'audio' looks only need sound (MIDI is turned into a signal when there is no audio). */
  group: LookGroup;
  nameRu: string;
  nameEn: string;
  descriptionRu: string;
  descriptionEn: string;
  /** Paints the whole 540 x 960 frame, background included. Must be deterministic in F (no Math.random, no state between frames). */
  draw(F: Frame): void;
}
