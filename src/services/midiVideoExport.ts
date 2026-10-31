import type { PatternItem } from './api';
import { sampleAudioFrame, type AudioAnalysis } from './audioAnalysis';
import { getPatternTicks, renderMidiVisual, type MidiVisualMode, type VisualOptions } from '../utils/midiVisuals';

export type VideoResolution = '1080x1920' | '720x1280';

export interface MidiVideoExportOptions {
  scene: PatternItem;
  tracks: PatternItem[];
  mode: MidiVisualMode;
  accent: string;
  durationSeconds: number;
  audioFile: File | null;
  audioAnalysis: AudioAnalysis | null;
  signal: AbortSignal;
  onProgress: (progress: number, etaSeconds: number | null) => void;
  visualOptions?: VisualOptions;
  startSeconds?: number;
  resolution?: VideoResolution;
  fps?: 30 | 60;
}

export interface MidiVideoResult { blob: Blob; extension: 'mp4' | 'webm'; mimeType: string }

interface VideoFormat { mimeType: string; extension: 'mp4' | 'webm' }

const RESOLUTIONS: Record<VideoResolution, [number, number]> = { '1080x1920': [1080, 1920], '720x1280': [720, 1280] };
const VIDEO_BITRATES: Record<VideoResolution, Record<30 | 60, number>> = {
  '1080x1920': { 60: 12_000_000, 30: 8_000_000 },
  '720x1280': { 60: 6_000_000, 30: 4_000_000 },
};
const AUDIO_BITRATE = 192_000;
const MAX_DURATION_SECONDS = 20 * 60;
const PREROLL_SECONDS = .1;
const H264 = ['avc1.640033', 'avc1.64002A', 'avc1', 'avc1.42E01E'];

const abortError = () => new DOMException('Video export cancelled', 'AbortError');

function videoFormats(withAudio: boolean): VideoFormat[] {
  const mp4 = (audio: string) => H264.map(video => ({ mimeType: `video/mp4;codecs=${withAudio ? `${video},${audio}` : video}`, extension: 'mp4' as const }));
  const webm = (video: string) => ({ mimeType: `video/webm;codecs=${withAudio ? `${video},opus` : video}`, extension: 'webm' as const });
  return [
    ...mp4('mp4a.40.2'),
    ...(withAudio ? mp4('opus') : []),
    webm('vp9'), webm('vp8'),
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
}

function pickVideoFormat(withAudio: boolean): VideoFormat | null {
  for (const format of videoFormats(withAudio)) {
    try { if (MediaRecorder.isTypeSupported(format.mimeType)) return format; } catch {}
  }
  return null;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

const sleep = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

/**
 * In Chromium the first H.264 encoder session of a process starts late and the frames captured meanwhile are lost,
 * which put the picture ~100 ms ahead of the audio in the first export after launch (measured in Electron 33).
 * A short throwaway video-only recording brings the encoder up first, so the real recording starts aligned.
 */
async function warmUpEncoder(canvas: HTMLCanvasElement, redraw: () => void, fps: number, signal: AbortSignal) {
  const format = pickVideoFormat(false);
  if (!format) return;
  const stream = canvas.captureStream(fps);
  try {
    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
    let received = false;
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.onerror = () => resolve(); });
    recorder.ondataavailable = event => { if (event.data?.size) received = true; };
    recorder.start(100);
    const deadline = performance.now() + 1500;
    while (!received && !signal.aborted && performance.now() < deadline && recorder.state === 'recording') {
      redraw();
      await sleep(1000 / fps);
    }
    if (recorder.state !== 'inactive') recorder.stop();
    await Promise.race([stopped, sleep(500)]);
  } catch {
  } finally {
    stream.getTracks().forEach(track => track.stop());
  }
}

/**
 * Wakes a callback at a wall-clock time. Uses timers normally; while the page is hidden and timers are being
 * throttled (browsers clamp them to ~1 Hz), it falls back to MessageChannel polling, which is never throttled.
 */
function createWaker() {
  const isElectron = /\bElectron\//.test(navigator.userAgent);
  const channel = new MessageChannel();
  let timer = 0, target = 0, callback: (() => void) | null = null, throttled = false, disposed = false;
  const visibility = () => { if (!document.hidden) throttled = false; };
  document.addEventListener('visibilitychange', visibility);
  const fire = () => {
    if (disposed || !callback) return;
    const now = performance.now();
    if (now >= target - 1) {
      const run = callback;
      callback = null;
      run();
    } else arm();
  };
  channel.port1.onmessage = fire;
  const arm = () => {
    clearTimeout(timer);
    if (document.hidden && (throttled || !isElectron)) {
      channel.port2.postMessage(0);
      return;
    }
    const expected = target;
    timer = window.setTimeout(() => {
      if (document.hidden && performance.now() - expected > 250) throttled = true;
      fire();
    }, Math.max(0, target - performance.now() - 1));
  };
  return {
    at(time: number, next: () => void) {
      if (disposed) return;
      target = time;
      callback = next;
      arm();
    },
    dispose() {
      disposed = true;
      callback = null;
      clearTimeout(timer);
      channel.port1.onmessage = null;
      channel.port1.close();
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}

export function getSceneDuration(scene: PatternItem): number {
  return Math.max(.25, getPatternTicks(scene) * 60 / (Math.max(1, scene.tempo || 120) * Math.max(1, scene.ppq || 96)));
}

export async function recordMidiVideo(options: MidiVideoExportOptions): Promise<MidiVideoResult> {
  const { signal } = options;
  if (signal.aborted) throw abortError();
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error('Video recording is not supported in this browser');
  }
  const duration = Number.isFinite(options.durationSeconds) ? Math.min(MAX_DURATION_SECONDS, Math.max(1, options.durationSeconds)) : 1;
  const resolution: VideoResolution = options.resolution && RESOLUTIONS[options.resolution] ? options.resolution : '1080x1920';
  const fps: 30 | 60 = options.fps === 30 ? 30 : 60;
  const startSeconds = Number.isFinite(options.startSeconds) ? Math.max(0, options.startSeconds) : 0;
  const format = pickVideoFormat(!!options.audioFile);
  if (!format) throw new Error('No supported video format');

  const [width, height] = RESOLUTIONS[resolution];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context2d = canvas.getContext('2d');
  if (!context2d) throw new Error('Canvas is unavailable');

  const analysisSeconds = options.audioAnalysis?.durationSeconds;
  const hasNotes = !!options.scene.notes?.length;
  const visualSeconds = hasNotes ? getSceneDuration(options.scene)
    : analysisSeconds > 0 ? analysisSeconds : getSceneDuration(options.scene);
  // The preview wraps picture and audio together at the longer of the two (MidiVisualizer's timeline); the picture has to
  // restart at the same moments here, or it drifts out of phase with a looping audio track after the first wrap.
  const timelineSeconds = hasNotes && analysisSeconds > visualSeconds ? analysisSeconds : visualSeconds;
  const draw = (elapsed: number) => {
    const time = startSeconds + elapsed;
    const wrapped = ((time % timelineSeconds) + timelineSeconds) % timelineSeconds;
    const progress = (wrapped % visualSeconds) / visualSeconds;
    renderMidiVisual(context2d, options.scene, options.mode, progress, options.accent, options.tracks, sampleAudioFrame(options.audioAnalysis, time), options.visualOptions);
  };

  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;
  let recorder: MediaRecorder | null = null;
  let waker: ReturnType<typeof createWaker> | null = null;
  let detachAbort = () => {};

  try {
    draw(0);
    stream = canvas.captureStream(0);
    const videoTrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
    let requestFrame: () => void = () => {};
    if (videoTrack && typeof videoTrack.requestFrame === 'function') {
      requestFrame = () => videoTrack.requestFrame();
    } else {
      stream.getTracks().forEach(track => track.stop());
      stream = canvas.captureStream(fps);
    }

    let audioOffset = 0;
    if (options.audioFile) {
      try { audioContext = new AudioContext(); } catch { throw new Error('Audio output is not available'); }
      const data = await abortable(options.audioFile.arrayBuffer(), signal);
      let buffer: AudioBuffer;
      try { buffer = await abortable(audioContext.decodeAudioData(data), signal); } catch (error) {
        if (signal.aborted) throw abortError();
        throw new Error('Unsupported or damaged audio file', { cause: error });
      }
      if (!(buffer.duration > 0)) throw new Error('The audio file has no audio');
      const destination = audioContext.createMediaStreamDestination();
      audioSource = audioContext.createBufferSource();
      audioSource.buffer = buffer;
      audioSource.loop = true;
      audioSource.connect(destination);
      destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      audioOffset = startSeconds % buffer.duration;
      await abortable(withTimeout(audioContext.resume(), 5000, 'Audio engine did not start'), signal);
      if (audioContext.state !== 'running') throw new Error('Audio engine did not start');
    }
    if (signal.aborted) throw abortError();
    await warmUpEncoder(canvas, () => draw(0), fps, signal);
    if (signal.aborted) throw abortError();

    const activeRecorder = recorder = new MediaRecorder(stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: VIDEO_BITRATES[resolution][fps],
      ...(options.audioFile ? { audioBitsPerSecond: AUDIO_BITRATE } : {}),
    });
    const chunks: Blob[] = [];
    let failure: Error | null = null;
    const fail = (error: Error) => {
      failure ??= error;
      waker?.dispose();
      if (activeRecorder.state !== 'inactive') try { activeRecorder.stop(); } catch {}
    };
    const completed = new Promise<MidiVideoResult>((resolve, reject) => {
      activeRecorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      activeRecorder.onerror = event => {
        const detail = (event as Event & { error?: DOMException }).error?.message;
        fail(new Error(detail ? `Video encoding failed: ${detail}` : 'Video encoding failed'));
        reject(failure);
      };
      activeRecorder.onstop = () => {
        if (signal.aborted) return reject(abortError());
        if (failure) return reject(failure);
        const mimeType = activeRecorder.mimeType || format.mimeType;
        const blob = new Blob(chunks, { type: mimeType });
        if (!blob.size) return reject(new Error('Empty video file'));
        resolve({ blob, mimeType, extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' });
      };
    });
    completed.catch(() => {});
    const activeWaker = waker = createWaker();
    const onAbort = () => {
      activeWaker.dispose();
      if (activeRecorder.state !== 'inactive') try { activeRecorder.stop(); } catch {}
    };
    signal.addEventListener('abort', onAbort, { once: true });
    detachAbort = () => signal.removeEventListener('abort', onAbort);

    activeRecorder.start(1000);
    let clock: () => number;
    if (audioContext && audioSource) {
      const context = audioContext;
      const startAt = context.currentTime + PREROLL_SECONDS;
      audioSource.start(startAt, audioOffset);
      // The recorded audio lines up with the output clock (getOutputTimestamp), not with currentTime, which runs
      // ahead by the output latency (~40 ms on macOS); following currentTime put the picture early.
      let latest = 0;
      const outputTime = () => {
        const stamp = context.getOutputTimestamp?.();
        if (stamp?.performanceTime > 0 && Number.isFinite(stamp.contextTime)) return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
        return context.currentTime - (context.baseLatency || 0) - ((context as AudioContext & { outputLatency?: number }).outputLatency || 0);
      };
      clock = () => latest = Math.max(latest, outputTime() - startAt);
    } else {
      const startAt = performance.now() + PREROLL_SECONDS * 1000;
      clock = () => Math.max(0, (performance.now() - startAt) / 1000);
    }

    const frameMs = 1000 / fps;
    let nextFrameAt = performance.now(), lastProgressAt = -Infinity;
    const report = (progress: number, eta: number) => { try { options.onProgress(progress, eta); } catch (error) { console.error(error); } };
    report(0, duration);
    const renderFrame = () => {
      if (activeRecorder.state !== 'recording') return;
      const elapsed = Math.min(duration, clock());
      try { draw(elapsed); } catch (error) {
        console.error('Video frame render failed:', error);
        return fail(new Error('Video frame render failed', { cause: error }));
      }
      requestFrame();
      const now = performance.now();
      if (now - lastProgressAt >= 100 || elapsed >= duration) {
        lastProgressAt = now;
        report(elapsed / duration, Math.max(0, duration - elapsed));
      }
      if (elapsed >= duration) {
        activeWaker.at(now + frameMs * 2, () => { if (activeRecorder.state === 'recording') activeRecorder.stop(); });
        return;
      }
      nextFrameAt = Math.max(nextFrameAt + frameMs, now + 1);
      activeWaker.at(nextFrameAt, renderFrame);
    };
    renderFrame();

    const result = await completed;
    report(1, 0);
    return result;
  } finally {
    detachAbort();
    waker?.dispose();
    if (recorder && recorder.state !== 'inactive') try { recorder.stop(); } catch {}
    if (audioSource) try { audioSource.stop(); } catch {}
    stream?.getTracks().forEach(track => track.stop());
    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
  }
}
