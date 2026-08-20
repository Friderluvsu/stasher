import type { NoteEvent } from './api';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private isPlaying = false;
  private loopInterval: number | null = null;
  private currentPatternId: number | null = null;
  private scheduledNodes: { stop: () => void }[] = [];
  private currentAudioElement: HTMLAudioElement | null = null;
  private onPlaybackStateChange?: (isPlaying: boolean, patternId: number | null) => void;

  private sampleBuffers: Map<string, AudioBuffer> = new Map();
  private isSamplesLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  // Local API server endpoints
  private sampleEndpoints: Record<string, string> = {
    '808': 'http://127.0.0.1:8765/api/preview-samples/808.wav',
    'bass': 'http://127.0.0.1:8765/api/preview-samples/808.wav',
    'kick': 'http://127.0.0.1:8765/api/preview-samples/kick.wav',
    'snare': 'http://127.0.0.1:8765/api/preview-samples/snare.wav',
    'clap': 'http://127.0.0.1:8765/api/preview-samples/clap.wav',
    'hi-hat': 'http://127.0.0.1:8765/api/preview-samples/hihat.wav',
    'open hat': 'http://127.0.0.1:8765/api/preview-samples/openhat.wav',
    'perc': 'http://127.0.0.1:8765/api/preview-samples/perc.wav',
    'rim': 'http://127.0.0.1:8765/api/preview-samples/rim.wav',
    'vox': 'http://127.0.0.1:8765/api/preview-samples/vox.wav',
    'fx': 'http://127.0.0.1:8765/api/preview-samples/fx.wav',
    'piano': 'http://127.0.0.1:8765/api/preview-samples/piano.wav',
    'epiano': 'http://127.0.0.1:8765/api/preview-samples/epiano.wav',
  };

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.preloadSamples();
  }

  public async preloadSamples() {
    if (this.isSamplesLoaded && this.sampleBuffers.size > 0) return;
    if (this.loadingPromise) return this.loadingPromise;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }

    this.loadingPromise = (async () => {
      const timestamp = Date.now();
      const entries = Object.entries(this.sampleEndpoints);
      await Promise.all(
        entries.map(async ([key, url]) => {
          try {
            const res = await fetch(`${url}?v=${timestamp}`, { cache: 'no-store' });
            if (!res.ok) {
              console.warn(`[AudioEngine] HTTP ${res.status} loading sample: ${key}`);
              return;
            }
            const arrayBuffer = await res.arrayBuffer();
            if (this.ctx) {
              const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
              this.sampleBuffers.set(key, audioBuffer);
            }
          } catch (e) {
            console.warn(`[AudioEngine] Failed to load sample ${key} from ${url}:`, e);
          }
        })
      );
      this.isSamplesLoaded = true;
      console.log(`[AudioEngine] Preloaded ${this.sampleBuffers.size} audio samples (including fresh Piano).`);
    })();

    return this.loadingPromise;
  }

  public setListener(cb: (isPlaying: boolean, patternId: number | null) => void) {
    this.onPlaybackStateChange = cb;
  }

  public stop() {
    if (this.loopInterval) {
      window.clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement = null;
    }
    this.scheduledNodes.forEach((node) => {
      try {
        node.stop();
      } catch {}
    });
    this.scheduledNodes = [];
    this.isPlaying = false;
    this.currentPatternId = null;
    this.onPlaybackStateChange?.(false, null);
  }

  public playSoundSample(soundId: number, tag: string) {
    this.initContext();
    this.stop();

    this.isPlaying = true;
    this.currentPatternId = soundId;
    this.onPlaybackStateChange?.(true, soundId);

    const audioUrl = `http://127.0.0.1:8765/api/sounds/${soundId}/audio`;
    const audio = new Audio(audioUrl);
    this.currentAudioElement = audio;

    audio.onended = () => {
      if (this.currentPatternId === soundId) {
        this.stop();
      }
    };

    audio.onerror = () => {
      if (!this.ctx) return;
      const startTime = this.ctx.currentTime;
      this.synthesizeNote(60, startTime, 0.6, 1.0, tag);
      setTimeout(() => {
        if (this.currentPatternId === soundId) {
          this.stop();
        }
      }, 700);
    };

    audio.play().catch(() => {
      if (!this.ctx) return;
      const startTime = this.ctx.currentTime;
      this.synthesizeNote(60, startTime, 0.6, 1.0, tag);
      setTimeout(() => {
        if (this.currentPatternId === soundId) {
          this.stop();
        }
      }, 700);
    });
  }

  public async playPattern(
    patternId: number,
    notes: NoteEvent[],
    tempo: number = 140,
    ppq: number = 96,
    tag: string = 'Other',
    loop: boolean = true
  ) {
    this.initContext();
    if (!this.ctx || !notes || notes.length === 0) return;

    if (this.isPlaying && this.currentPatternId === patternId) {
      this.stop();
      return;
    }

    this.stop();
    this.isPlaying = true;
    this.currentPatternId = patternId;
    this.onPlaybackStateChange?.(true, patternId);

    if (!this.isSamplesLoaded || this.sampleBuffers.size === 0) {
      await this.preloadSamples();
    }

    if (!this.isPlaying || this.currentPatternId !== patternId) return;

    const secondsPerTick = (60 / tempo) / ppq;
    const maxTick = Math.max(...notes.map((n) => n.pos + n.duration));
    const patternDuration = Math.max(1, maxTick * secondsPerTick);

    const scheduleNotes = () => {
      if (!this.ctx || !this.isPlaying) return;
      const startTime = this.ctx.currentTime + 0.05;

      notes.forEach((n) => {
        const noteStart = startTime + n.pos * secondsPerTick;
        const noteDuration = Math.max(0.04, n.duration * secondsPerTick);
        const velocity = (n.velocity || 100) / 127;
        this.synthesizeNote(n.pitch, noteStart, noteDuration, velocity, tag);
      });
    };

    scheduleNotes();

    if (loop) {
      this.loopInterval = window.setInterval(() => {
        if (this.isPlaying) {
          scheduleNotes();
        }
      }, patternDuration * 1000);
    }
  }

  public async playStack(
    stackItems: { id: number; notes: NoteEvent[]; tag: string }[],
    tempo: number = 140,
    ppq: number = 96
  ) {
    this.initContext();
    if (!this.ctx || stackItems.length === 0) return;

    this.stop();
    this.isPlaying = true;
    this.currentPatternId = -999;
    this.onPlaybackStateChange?.(true, -999);

    if (!this.isSamplesLoaded || this.sampleBuffers.size === 0) {
      await this.preloadSamples();
    }

    if (!this.isPlaying) return;

    const secondsPerTick = (60 / tempo) / ppq;
    let maxTick = 0;
    stackItems.forEach((item) => {
      item.notes.forEach((n) => {
        if (n.pos + n.duration > maxTick) maxTick = n.pos + n.duration;
      });
    });

    const stackDuration = Math.max(2, maxTick * secondsPerTick);

    const scheduleStack = () => {
      if (!this.ctx || !this.isPlaying) return;
      const startTime = this.ctx.currentTime + 0.05;

      stackItems.forEach((item) => {
        item.notes.forEach((n) => {
          const noteStart = startTime + n.pos * secondsPerTick;
          const noteDuration = Math.max(0.04, n.duration * secondsPerTick);
          const velocity = (n.velocity || 100) / 127;
          this.synthesizeNote(n.pitch, noteStart, noteDuration, velocity, item.tag);
        });
      });
    };

    scheduleStack();

    this.loopInterval = window.setInterval(() => {
      if (this.isPlaying) {
        scheduleStack();
      }
    }, stackDuration * 1000);
  }

  private midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  private playSampleBuffer(
    buffer: AudioBuffer,
    time: number,
    duration: number,
    velocity: number,
    pitchRate: number = 1.0,
    applyEnvelope: boolean = false,
    releaseTail: number = 0.3
  ) {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(pitchRate, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(1.2, 0.9 * velocity), time);

    if (applyEnvelope) {
      gain.gain.setValueAtTime(0.9 * velocity, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration + releaseTail);
    }

    source.connect(gain);
    gain.connect(ctx.destination);

    source.start(time);
    if (applyEnvelope) {
      source.stop(time + duration + releaseTail + 0.1);
    }

    this.scheduledNodes.push({
      stop: () => {
        try {
          source.stop();
        } catch {}
      },
    });
  }

  private synthesizeNote(pitch: number, time: number, duration: number, velocity: number, tag: string) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const tagLower = tag.toLowerCase();

    // 1. 808 / Sub Bass (Spinz 808 tuned to C5 = MIDI 60)
    if (tagLower.includes('808') || tagLower.includes('bass')) {
      const buffer = this.sampleBuffers.get('808') || this.sampleBuffers.get('bass');
      if (buffer) {
        const pitchRate = Math.pow(2, (pitch - 60) / 12);
        this.playSampleBuffer(buffer, time, duration, velocity, pitchRate, true, 0.15);
        return;
      }
    }

    // 2. Kick Drum (Rack Kick)
    if (tagLower.includes('kick')) {
      const buffer = this.sampleBuffers.get('kick');
      if (buffer) {
        this.playSampleBuffer(buffer, time, 0.4, velocity * 1.1, 1.0, false);
        return;
      }
    }

    // 3. Clap (Wheezy Clap)
    if (tagLower.includes('clap')) {
      const buffer = this.sampleBuffers.get('clap');
      if (buffer) {
        this.playSampleBuffer(buffer, time, 0.5, velocity, 1.0, false);
        return;
      }
    }

    // 4. Snare (Sinister Snare)
    if (tagLower.includes('snare')) {
      const buffer = this.sampleBuffers.get('snare');
      if (buffer) {
        this.playSampleBuffer(buffer, time, 0.5, velocity, 1.0, false);
        return;
      }
    }

    // 5. Rim / Rimshot
    if (tagLower.includes('rim')) {
      const buffer = this.sampleBuffers.get('rim') || this.sampleBuffers.get('perc') || this.sampleBuffers.get('snare');
      if (buffer) {
        this.playSampleBuffer(buffer, time, 0.3, velocity, 1.0, false);
        return;
      }
    }

    // 6. Hi-Hat / Open Hat (22 Hat & 1st Open Hat)
    if (tagLower.includes('hat') || tagLower.includes('crash')) {
      const isOpen = tagLower.includes('open');
      const buffer = isOpen ? this.sampleBuffers.get('open hat') : this.sampleBuffers.get('hi-hat');
      if (buffer) {
        const pitchRate = Math.pow(2, (pitch - 60) / 12);
        this.playSampleBuffer(buffer, time, isOpen ? 0.6 : 0.15, velocity, Math.max(0.6, Math.min(1.6, pitchRate)), false);
        return;
      }
    }

    // 7. Percussion (Jdot Perc)
    if (tagLower.includes('perc')) {
      const buffer = this.sampleBuffers.get('perc');
      if (buffer) {
        this.playSampleBuffer(buffer, time, 0.4, velocity, 1.0, false);
        return;
      }
    }

    // 8. Vox / Chant (Chant Vox)
    if (tagLower.includes('vox') || tagLower.includes('chant') || tagLower.includes('vocal')) {
      const buffer = this.sampleBuffers.get('vox');
      if (buffer) {
        const pitchRate = Math.pow(2, (pitch - 60) / 12);
        this.playSampleBuffer(buffer, time, 0.8, velocity, pitchRate, false);
        return;
      }
    }

    // 9. FX (Breezy FX)
    if (tagLower.includes('fx')) {
      const buffer = this.sampleBuffers.get('fx');
      if (buffer) {
        this.playSampleBuffer(buffer, time, 1.5, velocity, 1.0, false);
        return;
      }
    }

    // 10. NEW ACOUSTIC GRAND PIANO for Melodies, Chords, Pluck, Lead, Other, Keys!
    const pianoBuffer = this.sampleBuffers.get('piano') || this.sampleBuffers.get('epiano');
    if (pianoBuffer) {
      // (c) keys - piano (pbj & t9c).wav is tuned to C5 (MIDI 60)
      const pitchRate = Math.pow(2, (pitch - 60) / 12);
      this.playSampleBuffer(pianoBuffer, time, duration, velocity * 0.95, pitchRate, true, 0.7);
      return;
    }

    // Synthesized piano fallback
    const freq = this.midiToFreq(pitch);
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc2.type = 'sine';

    osc.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 1.001, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, time);
    filter.frequency.exponentialRampToValueAtTime(500, time + 0.35);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.5 * velocity, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration + 0.6);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + duration + 0.6);
    osc2.start(time);
    osc2.stop(time + duration + 0.6);

    this.scheduledNodes.push({
      stop: () => {
        try {
          osc.stop();
          osc2.stop();
        } catch {}
      },
    });
  }
}

export const audioEngine = new AudioEngine();
