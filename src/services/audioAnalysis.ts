export const SPECTRUM_BANDS = 32;

export interface AudioFrame {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  transient: number;
  durationSeconds: number;
  spectrum: Float32Array;
  /** The analysis this frame was sampled from and the time it was sampled at; lets looks read history and raw PCM. */
  analysis?: AudioAnalysis | null;
  seconds?: number;
}

export interface AudioAnalysis {
  durationSeconds: number;
  frameRate: number;
  /** CHANNELS values per frame: level, bass, mid, treble, transient (0..1) */
  frames: Float32Array;
  /** SPECTRUM_BANDS values per frame, 0..1 */
  spectrum: Float32Array;
  /** Peak sample amplitude per frame (0..1, not normalised), used for waveform overviews */
  peaks: Float32Array;
  sampleRate: number;
  /** Low-rate stereo PCM (-1..1 scaled to int16) at pcmRate, for oscilloscopes and stereo scopes. Mono files repeat left in right. */
  pcmRate: number;
  left: Int16Array;
  right: Int16Array;
}

export const SILENT_AUDIO_FRAME: AudioFrame = {
  level: 0, bass: 0, mid: 0, treble: 0, transient: 0, durationSeconds: 0, spectrum: new Float32Array(SPECTRUM_BANDS),
};

const CHANNELS = 5;
const FFT_SIZE = 2048;
const HALF = FFT_SIZE / 2;
const ANALYSIS_RATE = 44100;
const MIN_HZ = 40, MAX_HZ = 16000;
const MAX_FRAMES = 15000;
const SILENCE_DB = -110;
const clamp = (value: number) => value > 1 ? 1 : value > 0 ? value : 0;

const abortError = () => new DOMException('Audio analysis cancelled', 'AbortError');

function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(0);
  });
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  let context: BaseAudioContext | null = null, realtime: AudioContext | null = null;
  try { context = new OfflineAudioContext(1, 1, ANALYSIS_RATE); } catch {}
  if (!context) {
    try { context = realtime = new AudioContext(); } catch { throw new Error('Audio decoding is not available'); }
  }
  try {
    return await context.decodeAudioData(data);
  } catch (error) {
    throw new Error('Unsupported or damaged audio file', { cause: error });
  } finally {
    realtime?.close().catch(() => {});
  }
}

interface FftTables { reverse: Uint16Array; cos: Float64Array; sin: Float64Array; realCos: Float64Array; realSin: Float64Array; window: Float32Array }
let tables: FftTables | null = null;

function fftTables(): FftTables {
  if (tables) return tables;
  const bits = Math.log2(HALF);
  const reverse = new Uint16Array(HALF);
  for (let i = 0; i < HALF; i++) {
    let value = 0;
    for (let bit = 0; bit < bits; bit++) value |= ((i >> bit) & 1) << (bits - 1 - bit);
    reverse[i] = value;
  }
  const cos = new Float64Array(HALF / 2), sin = new Float64Array(HALF / 2);
  for (let k = 0; k < HALF / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / HALF); sin[k] = Math.sin(2 * Math.PI * k / HALF); }
  const realCos = new Float64Array(HALF + 1), realSin = new Float64Array(HALF + 1);
  for (let k = 0; k <= HALF; k++) { realCos[k] = Math.cos(2 * Math.PI * k / FFT_SIZE); realSin[k] = Math.sin(2 * Math.PI * k / FFT_SIZE); }
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = .5 - .5 * Math.cos(2 * Math.PI * i / FFT_SIZE);
  return tables = { reverse, cos, sin, realCos, realSin, window };
}

function complexFft(real: Float64Array, imaginary: Float64Array, { reverse, cos, sin }: FftTables) {
  for (let i = 0; i < HALF; i++) {
    const j = reverse[i];
    if (i < j) {
      let swap = real[i]; real[i] = real[j]; real[j] = swap;
      swap = imaginary[i]; imaginary[i] = imaginary[j]; imaginary[j] = swap;
    }
  }
  for (let size = 2; size <= HALF; size <<= 1) {
    const half = size >> 1, step = HALF / size;
    for (let start = 0; start < HALF; start += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = start + j, b = a + half;
        const wr = cos[k], wi = -sin[k];
        const tr = real[b] * wr - imaginary[b] * wi, ti = real[b] * wi + imaginary[b] * wr;
        real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti;
        real[a] += tr; imaginary[a] += ti;
      }
    }
  }
}

/** Power spectrum (bins 0..HALF) of FFT_SIZE real samples, computed with one HALF-sized complex FFT. */
function realPowerSpectrum(samples: Float32Array, real: Float64Array, imaginary: Float64Array, power: Float64Array, fft: FftTables) {
  for (let n = 0; n < HALF; n++) { real[n] = samples[2 * n]; imaginary[n] = samples[2 * n + 1]; }
  complexFft(real, imaginary, fft);
  const scale = (4 / FFT_SIZE) ** 2;
  for (let k = 0; k <= HALF; k++) {
    const index = k % HALF, mirror = (HALF - k) % HALF;
    const ar = real[index], ai = imaginary[index], br = real[mirror], bi = -imaginary[mirror];
    const er = (ar + br) / 2, ei = (ai + bi) / 2, or = (ai - bi) / 2, oi = -(ar - br) / 2;
    const c = fft.realCos[k], s = fft.realSin[k];
    const xr = er + c * or + s * oi, xi = ei + c * oi - s * or;
    power[k] = (xr * xr + xi * xi) * scale;
  }
}

interface BandLayout { start: Int32Array; end: Int32Array; center: Float64Array; coarse: [number, number][] }

function bandLayout(sampleRate: number): BandLayout {
  const binHz = sampleRate / FFT_SIZE;
  const maxHz = Math.min(MAX_HZ, sampleRate / 2 - binHz);
  const start = new Int32Array(SPECTRUM_BANDS), end = new Int32Array(SPECTRUM_BANDS), center = new Float64Array(SPECTRUM_BANDS);
  const edge = (band: number) => MIN_HZ * (maxHz / MIN_HZ) ** (band / SPECTRUM_BANDS);
  for (let band = 0; band < SPECTRUM_BANDS; band++) {
    const low = edge(band), high = edge(band + 1);
    start[band] = Math.ceil(low / binHz);
    end[band] = Math.min(HALF, Math.ceil(high / binHz));
    center[band] = Math.min(HALF - 1, Math.sqrt(low * high) / binHz);
  }
  const bin = (hz: number) => Math.max(1, Math.min(HALF, Math.ceil(hz / binHz)));
  const coarse: [number, number][] = [[bin(20), bin(180)], [bin(180), bin(2000)], [bin(2000), bin(10000)]];
  return { start, end, center, coarse };
}

function sortedValues(source: Float32Array, stride: number, offset: number, skipBelow = -Infinity): Float32Array {
  const count = Math.floor(source.length / stride);
  const values = new Float32Array(count);
  let used = 0;
  for (let i = 0; i < count; i++) {
    const value = source[i * stride + offset];
    if (value > skipBelow) values[used++] = value;
  }
  return values.subarray(0, used).sort();
}

const quantile = (sorted: Float32Array, q: number, fallback: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] : fallback;

/** Exponential attack/release follower: coefficients for a given frame interval. */
const follower = (seconds: number, interval: number) => 1 - Math.exp(-interval / seconds);

export async function analyzeAudioFile(file: File, signal?: AbortSignal): Promise<AudioAnalysis> {
  if (signal?.aborted) throw abortError();
  const data = await abortable(file.arrayBuffer(), signal);
  if (!data.byteLength) throw new Error('The audio file is empty');
  const buffer = await abortable(decodeAudio(data), signal);
  if (!Number.isFinite(buffer.duration) || buffer.length < 2 || buffer.duration < .05) throw new Error('The audio file is empty');
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  return analyzeChannels(channels, buffer.sampleRate, signal);
}

/** The analysis behind analyzeAudioFile, for already decoded channels (all the same length). */
export async function analyzeChannels(channels: Float32Array[], sampleRate: number, signal?: AbortSignal): Promise<AudioAnalysis> {
  const bufferLength = channels[0]?.length || 0;
  const durationSeconds = bufferLength / sampleRate;
  if (!channels.length || !(sampleRate > 0) || bufferLength < 2 || durationSeconds < .05) throw new Error('The audio file is empty');
  const buffer = { length: bufferLength };
  const frameRate = Math.min(60, Math.max(8, MAX_FRAMES / durationSeconds));
  const count = Math.max(1, Math.ceil(durationSeconds * frameRate));
  const interval = 1 / frameRate;
  const frames = new Float32Array(count * CHANNELS);
  const spectrum = new Float32Array(count * SPECTRUM_BANDS);
  const peaks = new Float32Array(count);
  const fft = fftTables();
  const layout = bandLayout(sampleRate);
  const windowed = new Float32Array(FFT_SIZE), mono = new Float32Array(FFT_SIZE);
  const real = new Float64Array(HALF), imaginary = new Float64Array(HALF), power = new Float64Array(HALF + 1);
  const gain = 1 / Math.max(1, channels.length);
  const hop = Math.max(1, Math.round(sampleRate / frameRate));
  let sliceStart = performance.now();

  for (let frame = 0; frame < count; frame++) {
    const center = Math.round(frame * interval * sampleRate);
    const first = center - HALF;
    mono.fill(0);
    const from = Math.max(0, first), to = Math.min(buffer.length, first + FFT_SIZE);
    for (const channel of channels) for (let position = from; position < to; position++) mono[position - first] += channel[position] * gain;
    let rms = 0, peak = 0;
    for (let i = HALF / 2; i < HALF + HALF / 2; i++) rms += mono[i] * mono[i];
    for (let i = Math.max(0, HALF - (hop >> 1)), end = Math.min(FFT_SIZE, HALF + (hop >> 1) + 1); i < end; i++) {
      const value = Math.abs(mono[i]);
      if (value > peak) peak = value;
    }
    for (let i = 0; i < FFT_SIZE; i++) windowed[i] = mono[i] * fft.window[i];
    realPowerSpectrum(windowed, real, imaginary, power, fft);

    const offset = frame * CHANNELS;
    frames[offset] = Math.sqrt(rms / HALF);
    for (let band = 0; band < 3; band++) {
      const [low, high] = layout.coarse[band];
      let sum = 0;
      for (let bin = low; bin < high; bin++) sum += power[bin];
      frames[offset + 1 + band] = Math.sqrt(sum / Math.max(1, high - low));
    }
    const spectrumOffset = frame * SPECTRUM_BANDS;
    for (let band = 0; band < SPECTRUM_BANDS; band++) {
      const start = layout.start[band], end = layout.end[band];
      let value = 0;
      if (end > start) {
        for (let bin = start; bin < end; bin++) value += power[bin];
        value /= end - start;
      } else {
        const position = layout.center[band], low = Math.floor(position), blend = position - low;
        value = power[low] * (1 - blend) + power[low + 1] * blend;
      }
      spectrum[spectrumOffset + band] = 10 * Math.log10(value + 1e-14);
    }
    peaks[frame] = Math.min(1, peak);

    if ((frame & 15) === 15 && performance.now() - sliceStart > 12) {
      await yieldToEventLoop();
      if (signal?.aborted) throw abortError();
      sliceStart = performance.now();
    }
  }
  if (signal?.aborted) throw abortError();

  // Coarse bands: linear magnitude scaled so the 90th percentile sits at .8 (renderers are tuned to this range).
  const coarseReference = [0, 1, 2, 3].map(channel => Math.max(1e-4, quantile(sortedValues(frames, CHANNELS, channel, 1e-6), .9, 1e-4)));
  // Spectrum: per-band dB window between a robust floor and the 97th percentile, tilt-limited against the loudest band.
  const bandHigh = new Float64Array(SPECTRUM_BANDS), bandLow = new Float64Array(SPECTRUM_BANDS);
  for (let band = 0; band < SPECTRUM_BANDS; band++) {
    const sorted = sortedValues(spectrum, SPECTRUM_BANDS, band, SILENCE_DB);
    bandHigh[band] = quantile(sorted, .97, SILENCE_DB) + 1;
    bandLow[band] = quantile(sorted, .25, SILENCE_DB);
  }
  const loudest = Math.max(...bandHigh);
  for (let band = 0; band < SPECTRUM_BANDS; band++) {
    const high = Math.max(bandHigh[band], loudest - 40, SILENCE_DB + 20);
    bandHigh[band] = high;
    bandLow[band] = Math.max(high - 48, Math.min(bandLow[band], high - 18));
  }
  await yieldToEventLoop();
  if (signal?.aborted) throw abortError();

  const coarseAttack = follower(.038, interval), coarseRelease = follower(.15, interval);
  const bandAttack = follower(.016, interval), bandRelease = follower(.11, interval);
  const smoothed = new Float64Array(4), smoothedBands = new Float64Array(SPECTRUM_BANDS), previousBands = new Float64Array(SPECTRUM_BANDS);
  const flux = new Float32Array(count);
  let previousLevel = 0;
  for (let frame = 0; frame < count; frame++) {
    const offset = frame * CHANNELS, spectrumOffset = frame * SPECTRUM_BANDS;
    for (let channel = 0; channel < 4; channel++) {
      const normalized = clamp(frames[offset + channel] / coarseReference[channel] * .8);
      smoothed[channel] += (normalized - smoothed[channel]) * (normalized > smoothed[channel] ? coarseAttack : coarseRelease);
      frames[offset + channel] = smoothed[channel];
    }
    let onset = 0;
    for (let band = 0; band < SPECTRUM_BANDS; band++) {
      const normalized = clamp((spectrum[spectrumOffset + band] - bandLow[band]) / (bandHigh[band] - bandLow[band]));
      const rise = normalized - previousBands[band];
      if (rise > 0) onset += rise * (band < 8 ? 1.6 : 1);
      previousBands[band] = normalized;
      smoothedBands[band] += (normalized - smoothedBands[band]) * (normalized > smoothedBands[band] ? bandAttack : bandRelease);
      spectrum[spectrumOffset + band] = smoothedBands[band];
    }
    const level = frames[offset];
    flux[frame] = onset + Math.max(0, level - previousLevel) * 6;
    previousLevel = level;
  }
  const fluxReference = Math.max(1e-3, quantile(sortedValues(flux, 1, 0, 1e-4), .96, 1e-3));
  const transientDecay = Math.exp(-interval / .09);
  let transient = 0;
  for (let frame = 0; frame < count; frame++) {
    const onset = clamp((flux[frame] / fluxReference - .25) / .75);
    transient = Math.max(onset, transient * transientDecay);
    frames[frame * CHANNELS + 4] = transient;
  }
  const pcm = downsamplePcm(channels, sampleRate);
  return { durationSeconds, frameRate, frames, spectrum, peaks, sampleRate, ...pcm };
}

const PCM_RATE = 11025;

// Box-filtered decimation to ~11 kHz: plenty for a 150 Hz scope trace and a goniometer, ~44 KB per second of stereo.
function downsamplePcm(channels: Float32Array[], sampleRate: number): { pcmRate: number; left: Int16Array; right: Int16Array } {
  const step = Math.max(1, Math.floor(sampleRate / PCM_RATE));
  const pcmRate = sampleRate / step;
  const length = Math.floor((channels[0]?.length || 0) / step);
  const convert = (source: Float32Array | undefined) => {
    const out = new Int16Array(length);
    if (!source) return out;
    for (let i = 0, at = 0; i < length; i++, at += step) {
      let sum = 0;
      for (let k = 0; k < step; k++) sum += source[at + k];
      const value = sum / step;
      out[i] = (value > 1 ? 1 : value < -1 ? -1 : value) * 32767;
    }
    return out;
  };
  const left = convert(channels[0]);
  const right = channels.length > 1 ? convert(channels[1]) : left;
  return { pcmRate, left, right };
}

/** `count` PCM samples (-1..1) of one channel starting at `seconds`, wrapping around the clip like playback does. */
export function readPcm(analysis: AudioAnalysis | null | undefined, channel: 'left' | 'right' | 'mid' | 'side', seconds: number, count: number, out = new Float32Array(Math.max(0, count))): Float32Array {
  const left = analysis?.left, right = analysis?.right;
  const length = left?.length || 0;
  if (!analysis || !left || !right || !length || !(analysis.pcmRate > 0)) return out.fill(0);
  let index = Math.floor((Number.isFinite(seconds) ? seconds : 0) * analysis.pcmRate);
  index = ((index % length) + length) % length;
  const scale = 1 / 32768;
  for (let i = 0; i < out.length; i++, index = index + 1 === length ? 0 : index + 1) {
    const l = left[index] * scale, r = right[index] * scale;
    out[i] = channel === 'left' ? l : channel === 'right' ? r : channel === 'mid' ? (l + r) / 2 : (l - r) / 2;
  }
  return out;
}

export function sampleAudioFrame(analysis: AudioAnalysis | null, seconds: number): AudioFrame {
  const duration = analysis?.durationSeconds;
  const count = analysis?.frames ? Math.floor(analysis.frames.length / CHANNELS) : 0;
  if (!analysis || !count || !(duration > 0) || !(analysis.frameRate > 0)) return SILENT_AUDIO_FRAME;
  const time = Number.isFinite(seconds) ? ((seconds % duration) + duration) % duration : 0;
  const position = time * analysis.frameRate;
  const first = Math.min(count - 1, Math.floor(position));
  let next = first + 1, blend = position - first;
  if (next >= count) {
    // Loop seam: blend the last analysed frame into the first one across the remaining time to the loop point.
    const lastTime = (count - 1) / analysis.frameRate;
    next = 0;
    blend = duration > lastTime ? clamp((time - lastTime) / (duration - lastTime)) : 0;
  }
  const { frames } = analysis;
  const channel = (offset: number) => frames[first * CHANNELS + offset] * (1 - blend) + frames[next * CHANNELS + offset] * blend;
  const spectrum = new Float32Array(SPECTRUM_BANDS);
  const source = analysis.spectrum;
  if (source && source.length >= count * SPECTRUM_BANDS) {
    const a = first * SPECTRUM_BANDS, b = next * SPECTRUM_BANDS;
    for (let band = 0; band < SPECTRUM_BANDS; band++) spectrum[band] = source[a + band] * (1 - blend) + source[b + band] * blend;
  }
  return {
    level: channel(0), bass: channel(1), mid: channel(2), treble: channel(3), transient: channel(4),
    durationSeconds: duration, spectrum, analysis, seconds: time,
  };
}

export function getAudioOverview(analysis: AudioAnalysis, points: number): Float32Array {
  const size = Math.max(1, Math.floor(Number.isFinite(points) ? points : 1));
  const overview = new Float32Array(size);
  const count = analysis?.frames ? Math.floor(analysis.frames.length / CHANNELS) : 0;
  if (!count) return overview;
  const usePeaks = !!analysis.peaks && analysis.peaks.length >= count;
  const value = (frame: number) => usePeaks ? analysis.peaks[frame] : analysis.frames[frame * CHANNELS];
  let max = 0;
  for (let point = 0; point < size; point++) {
    const start = Math.min(count - 1, Math.floor(point * count / size));
    const end = Math.max(start + 1, Math.min(count, Math.floor((point + 1) * count / size)));
    let peak = 0;
    for (let frame = start; frame < end; frame++) peak = Math.max(peak, value(frame));
    overview[point] = peak;
    max = Math.max(max, peak);
  }
  if (max > 0) for (let point = 0; point < size; point++) overview[point] /= max;
  return overview;
}
