import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type PatternItem } from '../services/api';
import { analyzeAudioFile, sampleAudioFrame, SILENT_AUDIO_FRAME, type AudioAnalysis } from '../services/audioAnalysis';
import { getSceneDuration } from '../services/midiVideoExport';
import { useInterfaceStore } from '../state/interfaceStore';
import { notify } from '../state/toastStore';
import { MIDI_VISUAL_MODES, renderMidiVisual, type MidiVisualMode, type VisualOptions } from '../utils/midiVisuals';
import { buildLoopScene, buildSongScene, findDuplicateParts, formatClock, partsFromFlp, partsFromMidiFile, vaultSources, type VisualizerScene } from '../utils/visualizerScene';
import { AudioPanel } from './visualizer/AudioPanel';
import { DropOverlay } from './visualizer/DropOverlay';
import { ExportPanel, type ExportJob } from './visualizer/ExportPanel';
import { LookPanel, type ThumbSource } from './visualizer/LookPanel';
import { SourcePanel } from './visualizer/SourcePanel';
import { StylePanel } from './visualizer/StylePanel';
import { useStageFit } from './visualizer/useStageFit';
import { VisualizerStage, type StageStatus } from './visualizer/VisualizerStage';
import {
  AUDIO_ACCEPT, AUDIO_ONLY_PATTERN, beatTitle, buildDemoScene, describeAudioError, describeImportError, EmptyImportError, fileStem, isAbortError, isAudioFile, isPartFile, isTypingTarget,
  loadPrefs, PART_ACCEPT, partsWord, PlaybackClock, savePrefs, slugify, timelineOverview, trackColor, useReducedMotion, wantsNativeSpace,
  type Arrangement, type PlaybackTicker, type ReadableError, type SourceGroup, type VisualizerPrefs,
} from './visualizer/shared';
import '../styles/midi-visualizer.css';

const ATTRACT_FRAME_MS = 32;

interface MidiVisualizerProps {
  /** False while another tab is open: the page stays mounted (keeping files, audio and a running export) but hidden. */
  active?: boolean;
}

export const MidiVisualizer: React.FC<MidiVisualizerProps> = ({ active = true }) => {
  const isRu = useInterfaceStore(state => state.language === 'ru');
  const toastTitle = isRu ? 'Визуализатор' : 'Visualizer';
  const reducedMotion = useReducedMotion();
  const [prefs, setPrefs] = useState<VisualizerPrefs>(loadPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const updatePrefs = useCallback((patch: Partial<VisualizerPrefs>) => setPrefs(previous => ({ ...previous, ...patch })), []);

  const [library, setLibrary] = useState<PatternItem[]>([]);
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const [imports, setImports] = useState<SourceGroup[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState<string[]>([]);
  const [importError, setImportError] = useState<ReadableError | null>(null);
  const [arrangement, setArrangement] = useState<Arrangement>('song');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioAnalysis, setAudioAnalysis] = useState<AudioAnalysis | null>(null);
  // The file being analysed. The previous audio stays loaded until this one decodes, so a bad drop cannot destroy it.
  const [pendingAudio, setPendingAudio] = useState<File | null>(null);
  const [analysingAudio, setAnalysingAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const clock = useMemo(() => new PlaybackClock(), []);
  const pageRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  useStageFit(pageRef, !fullscreen && active);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const lifetimeRef = useRef<AbortController | null>(null);
  const frameRef = useRef(0);
  const lastAttractRef = useRef(0);
  const attentiveRef = useRef(true);
  const renderFailedRef = useRef(false);
  const exportingRef = useRef(false);
  exportingRef.current = exporting;
  const activeRef = useRef(active);
  activeRef.current = active;
  const listenersRef = useRef(new Set<(seconds: number) => void>());

  useEffect(() => {
    const timer = window.setTimeout(() => savePrefs(prefs), 200);
    return () => clearTimeout(timer);
  }, [prefs]);

  useEffect(() => {
    const lifetime = new AbortController();
    lifetimeRef.current = lifetime;
    return () => {
      lifetime.abort();
      savePrefs(prefsRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // A refresh on returning to the tab keeps the current list on screen instead of flashing a loader.
    setLibraryState(state => state === 'ready' ? state : 'loading');
    (async () => {
      try {
        const all: PatternItem[] = [];
        for (let total = Infinity; all.length < total;) {
          const page = await api.fetchPatterns({ limit: 200, offset: all.length });
          if (cancelled) return;
          all.push(...page.items);
          total = page.total;
          if (!page.items.length) break;
        }
        setLibrary(all.filter(pattern => pattern.notes?.length));
        setLibraryState('ready');
      } catch (error) {
        if (cancelled) return;
        console.error('Visualizer vault load failed:', error);
        setLibraryState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [libraryAttempt]);

  const vaultGroups = useMemo<SourceGroup[]>(() => vaultSources(library), [library]);
  const groups = useMemo(() => [...imports, ...vaultGroups], [imports, vaultGroups]);
  const groupOfPart = useMemo(() => {
    const result = new Map<number, SourceGroup>();
    for (const group of groups) for (const part of group.parts) result.set(part.id, group);
    return result;
  }, [groups]);
  const duplicates = useMemo(() => {
    const result = new Set<number>();
    for (const group of groups) findDuplicateParts(group.parts).forEach(id => result.add(id));
    return result;
  }, [groups]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedParts = useMemo(() => groups.flatMap(group => group.parts.filter(part => selectedSet.has(part.id))), [groups, selectedSet]);
  const selectedGroups = useMemo(() => groups.filter(group => group.parts.some(part => selectedSet.has(part.id))), [groups, selectedSet]);
  const activeGroup = selectedGroups.length === 1 ? selectedGroups[0] : null;
  const songAvailable = !!activeGroup?.source.song;
  const songBlocked = !songAvailable && selectedGroups.length > 1 && selectedGroups.some(group => group.source.song);
  const effectiveArrangement: Arrangement = songAvailable && arrangement === 'song' ? 'song' : 'loop';

  const scene = useMemo<VisualizerScene | null>(() => {
    if (!selectedParts.length) return null;
    try {
      if (effectiveArrangement === 'song' && activeGroup) {
        const song = buildSongScene(activeGroup.source, selectedParts);
        if (song) return song;
      }
      return buildLoopScene(selectedParts);
    } catch (error) {
      console.error('Visualizer scene failed:', error);
      return null;
    }
  }, [selectedParts, effectiveArrangement, activeGroup]);

  const demo = useMemo(() => buildDemoScene(), []);
  const demoSeconds = useMemo(() => demo ? getSceneDuration(demo.scene) : 4, [demo]);
  const hasNotes = !!scene && scene.scene.notes.length > 0;
  const audioSeconds = audioAnalysis?.durationSeconds || 0;
  const visualSeconds = hasNotes ? getSceneDuration(scene!.scene) : audioSeconds;
  const timelineSeconds = hasNotes ? Math.max(visualSeconds, audioSeconds) : audioSeconds;
  const status: StageStatus = hasNotes ? 'scene' : audioAnalysis ? 'audio' : 'demo';
  const canPlay = status !== 'demo' && !analysingAudio && !exporting;
  const pattern = hasNotes ? scene!.scene : AUDIO_ONLY_PATTERN;
  const tracks = useMemo(() => hasNotes ? scene!.tracks : [], [hasNotes, scene]);
  const overview = useMemo(() => status === 'demo' ? null : timelineOverview(hasNotes ? scene!.scene : null, visualSeconds, timelineSeconds, audioAnalysis), [status, hasNotes, scene, visualSeconds, timelineSeconds, audioAnalysis]);
  const autoTitle = audioFile ? beatTitle(audioFile.name) : activeGroup ? beatTitle(activeGroup.source.name) : hasNotes ? (scene!.scene.project_title || scene!.scene.pattern_name || 'untitled') : 'stasher';
  const title = prefs.title.trim() || autoTitle;
  const visualOptions = useMemo<VisualOptions>(() => ({ intensity: prefs.intensity, title }), [prefs.intensity, title]);
  const modeInfo = MIDI_VISUAL_MODES.find(item => item.id === prefs.mode) || MIDI_VISUAL_MODES[0];
  const modeName = isRu ? modeInfo.nameRu : modeInfo.nameEn;
  const hiDpi = useMemo(() => (window.devicePixelRatio || 1) >= 2, []);
  const canvasSize = useMemo<[number, number]>(() => fullscreen || hiDpi ? [720, 1280] : [540, 960], [fullscreen, hiDpi]);

  const renderRef = useRef({ status, pattern, tracks, visualSeconds, mode: prefs.mode, accent: prefs.accent, options: visualOptions, analysis: audioAnalysis, demo, demoSeconds, reducedMotion });
  renderRef.current = { status, pattern, tracks, visualSeconds, mode: prefs.mode, accent: prefs.accent, options: visualOptions, analysis: audioAnalysis, demo, demoSeconds, reducedMotion };

  const paint = useCallback(() => {
    frameRef.current = 0;
    const input = renderRef.current;
    const seconds = clock.now();
    const ctx = canvasRef.current?.getContext('2d');
    const now = performance.now();
    let animate = clock.playing;
    if (input.status === 'demo') {
      animate ||= !input.reducedMotion && attentiveRef.current;
      if (animate && now - lastAttractRef.current < ATTRACT_FRAME_MS) {
        frameRef.current = requestAnimationFrame(paint);
        return;
      }
      lastAttractRef.current = now;
    }
    if (ctx) {
      try {
        if (input.status === 'demo') {
          if (input.demo) {
            const at = input.reducedMotion ? input.demoSeconds * .4 : now / 1000;
            renderMidiVisual(ctx, input.demo.scene, input.mode, (at % input.demoSeconds) / input.demoSeconds, input.accent, input.demo.tracks, SILENT_AUDIO_FRAME, input.options);
          }
        } else {
          const progress = input.visualSeconds > 0 ? (seconds % input.visualSeconds) / input.visualSeconds : 0;
          renderMidiVisual(ctx, input.pattern, input.mode, progress, input.accent, input.tracks, sampleAudioFrame(input.analysis, seconds), input.options);
        }
        renderFailedRef.current = false;
      } catch (error) {
        if (!renderFailedRef.current) console.error('Visualizer render failed:', error);
        renderFailedRef.current = true;
      }
    }
    listenersRef.current.forEach(listener => listener(seconds));
    if (animate) frameRef.current = requestAnimationFrame(paint);
  }, [clock]);

  const requestPaint = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(paint);
  }, [paint]);

  const ticker = useMemo<PlaybackTicker>(() => ({
    subscribe(listener) {
      listenersRef.current.add(listener);
      listener(clock.now());
      return () => { listenersRef.current.delete(listener); };
    },
    now: () => clock.now(),
  }), [clock]);

  useEffect(() => { clock.setLength(timelineSeconds > 0 ? timelineSeconds : 1); }, [clock, timelineSeconds]);
  useEffect(() => { requestPaint(); });

  // The attract loop only animates while someone can see it (Electron keeps rAF running when minimised).
  useEffect(() => {
    const update = () => {
      const attentive = activeRef.current && !document.hidden && document.hasFocus();
      if (attentive === attentiveRef.current) return;
      attentiveRef.current = attentive;
      requestPaint();
    };
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [requestPaint, active]);

  const pause = useCallback(() => {
    if (!clock.playing) return;
    clock.pause();
    setPlaying(false);
    requestPaint();
  }, [clock, requestPaint]);

  const play = useCallback(() => {
    if (clock.playing) return;
    clock.play().catch(error => {
      if (isAbortError(error)) return;
      console.error('Visualizer audio playback failed:', error);
      clock.pause();
      setPlaying(false);
      notify.error(isRu ? 'Не удалось воспроизвести аудио' : 'Could not play the audio', toastTitle);
    });
    setPlaying(true);
    requestPaint();
  }, [clock, requestPaint, isRu, toastTitle]);

  const togglePlay = useCallback(() => {
    if (clock.playing) pause();
    else if (canPlay) play();
  }, [clock, pause, play, canPlay]);

  const seek = useCallback((seconds: number) => {
    clock.seek(seconds);
    requestPaint();
  }, [clock, requestPaint]);

  useEffect(() => {
    if (status === 'demo' || exporting) pause();
  }, [status, exporting, pause]);

  // Hidden playback would keep drawing frames nobody sees. A running export is not touched: it has its own loop.
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (!active) pause();
    // Parts may have been scanned or deleted in the library meanwhile.
    else if (!wasActiveRef.current) setLibraryAttempt(attempt => attempt + 1);
    wasActiveRef.current = active;
  }, [active, pause]);

  const seekBars = (direction: 1 | -1) => {
    if (!canPlay || timelineSeconds <= 0) return;
    const bar = 240 / Math.max(1, scene?.tempo || 120);
    const now = clock.now();
    const index = Math.floor(now / bar + 1e-6);
    const target = (direction > 0 ? index + 1 : now - index * bar < .35 ? index - 1 : index) * bar;
    seek(target >= timelineSeconds - 1e-3 ? 0 : Math.max(0, target));
  };

  const cycleLook = (direction: 1 | -1) => {
    const { mode, lookFilter } = prefsRef.current;
    const filtered = lookFilter === 'all' ? MIDI_VISUAL_MODES : MIDI_VISUAL_MODES.filter(item => item.group === lookFilter);
    const pool = filtered.length ? filtered : MIDI_VISUAL_MODES;
    const index = pool.findIndex(item => item.id === mode);
    const next = index < 0 ? pool[direction > 0 ? 0 : pool.length - 1] : pool[(index + direction + pool.length) % pool.length];
    updatePrefs({ mode: next.id });
  };

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    stageRef.current?.requestFullscreen?.().catch(error => {
      console.error('Fullscreen failed:', error);
      notify.error(isRu ? 'Полноэкранный режим недоступен' : 'Fullscreen is not available', toastTitle);
    });
  }, [isRu, toastTitle]);

  useEffect(() => {
    const stage = stageRef.current;
    const onChange = () => setFullscreen(!!stage && document.fullscreenElement === stage);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (stage && document.fullscreenElement === stage) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const abortAnalysis = useCallback(() => {
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
  }, []);

  const disposeAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    audioRef.current = null;
    clock.setAudio(null, 0);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }, [clock]);

  // A recording runs on the same thread and follows the audio it was started with, so changing inputs mid-export only hurts it.
  const refuseWhileExporting = useCallback(() => {
    if (!exportingRef.current) return false;
    notify.info(isRu ? 'Дождитесь конца экспорта' : 'Wait for the export to finish', toastTitle);
    return true;
  }, [isRu, toastTitle]);

  const attachAudio = useCallback(async (file: File) => {
    if (refuseWhileExporting()) return;
    pause();
    abortAnalysis();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setPendingAudio(file);
    setAnalysingAudio(true);
    try {
      const analysis = await analyzeAudioFile(file, controller.signal);
      if (controller.signal.aborted) return;
      disposeAudio();
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.preload = 'auto';
      audio.loop = true;
      audio.src = url;
      // Keyboard media keys and the OS can pause/play the element directly: keep the transport in step.
      audio.addEventListener('pause', () => {
        if (audioRef.current === audio && clock.playing && !audio.seeking) handlersRef.current.pause();
      });
      audio.addEventListener('play', () => {
        if (audioRef.current !== audio || clock.playing) return;
        if (handlersRef.current.canPlay) handlersRef.current.play();
        else audio.pause();
      });
      audio.addEventListener('error', () => {
        if (audioRef.current !== audio) return;
        console.error('Visualizer preview audio failed:', audio.error);
        clock.setAudio(null, 0);
        notify.error(isRu ? 'Превью играет без звука: этот файл не воспроизводится. Видео всё равно получит звук.' : 'The preview plays silently: this file cannot be played back. The video will still get the sound.', toastTitle);
      });
      audioRef.current = audio;
      audioUrlRef.current = url;
      clock.setAudio(audio, analysis.durationSeconds);
      clock.seek(0);
      setAudioFile(file);
      setAudioAnalysis(analysis);
      setPendingAudio(null);
      notify.success(`${file.name} · ${formatClock(analysis.durationSeconds)}`, isRu ? 'Аудио готово' : 'Audio ready');
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      console.error('Audio analysis failed:', error);
      // Whatever audio was loaded before stays untouched.
      setPendingAudio(null);
      notify.error(describeAudioError(error, file.name, isRu), toastTitle);
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
        setAnalysingAudio(false);
      }
    }
  }, [clock, pause, abortAnalysis, disposeAudio, refuseWhileExporting, isRu, toastTitle]);

  const removeAudio = useCallback(() => {
    abortAnalysis();
    disposeAudio();
    setAudioFile(null);
    setPendingAudio(null);
    setAudioAnalysis(null);
    setAnalysingAudio(false);
    requestPaint();
  }, [abortAnalysis, disposeAudio, requestPaint]);

  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    clock.pause();
    analysisAbortRef.current?.abort();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }, [clock]);

  const importFiles = useCallback(async (files: File[]) => {
    if (refuseWhileExporting()) return;
    const partFiles = files.filter(isPartFile);
    const audioFiles = files.filter(isAudioFile);
    const rejected = files.filter(file => !isPartFile(file) && !isAudioFile(file));
    if (rejected.length) notify.error(isRu ? `Пропущено: ${rejected.map(file => file.name).join(', ')}. Нужны FLP, MIDI или аудио.` : `Skipped ${rejected.map(file => file.name).join(', ')}. Use FLP, MIDI or audio files.`, toastTitle);
    if (audioFiles.length) {
      if (audioFiles.length > 1) notify.info(isRu ? `Берём первый аудиофайл: ${audioFiles[0].name}` : `Using the first audio file: ${audioFiles[0].name}`, toastTitle);
      void attachAudio(audioFiles[0]);
    }
    if (!partFiles.length) return;
    const signal = lifetimeRef.current?.signal;
    setImportError(null);
    const added: SourceGroup[] = [];
    for (const file of partFiles) {
      setImporting(previous => [...previous, file.name]);
      try {
        const group = /\.flp$/i.test(file.name)
          ? partsFromFlp(await api.parseFlpForVisualizer(file, signal))
          : await partsFromMidiFile(file, isRu ? 'Дорожка' : 'Track');
        if (signal?.aborted) return;
        if (!group.parts.length) throw new EmptyImportError();
        added.push(group);
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) return;
        console.error(`Visualizer import failed (${file.name}):`, error);
        const readable = describeImportError(error, file.name, isRu);
        setImportError(previous => readable.offline ? { ...readable, retry: [...(previous?.offline && previous.retry || []), file] } : readable);
        notify.error(readable.detail ? `${readable.title}. ${readable.detail}` : readable.title, toastTitle);
      } finally {
        if (!signal?.aborted) setImporting(previous => {
          const index = previous.indexOf(file.name);
          return index < 0 ? previous : [...previous.slice(0, index), ...previous.slice(index + 1)];
        });
      }
    }
    if (!added.length) return;
    // Re-dropping a file refreshes its group; the key is the file, not the (possibly shared) project title.
    const sourceKey = (group: SourceGroup) => `${group.source.kind}:${group.source.fileName.toLowerCase()}`;
    const replaced = new Set(added.map(sourceKey));
    let duplicateCount = 0;
    const ids = added.flatMap(group => {
      const groupDuplicates = findDuplicateParts(group.parts);
      duplicateCount += groupDuplicates.size;
      return group.parts.filter(part => !groupDuplicates.has(part.id)).map(part => part.id);
    });
    setImports(previous => [...added, ...previous.filter(group => !replaced.has(sourceKey(group)))]);
    setSelectedIds(ids);
    setExpanded(previous => new Set([...previous, ...added.map(group => group.source.id)]));
    if (added.some(group => group.source.song)) setArrangement('song');
    setQuery('');
    clock.seek(0);
    requestPaint();
    const totalParts = ids.length + duplicateCount;
    const inScene = duplicateCount ? (isRu ? `, в сцене ${ids.length}` : `, ${ids.length} in the scene`) : '';
    const extras = [
      duplicateCount ? (isRu ? `дубли сняты: ${duplicateCount}` : `${duplicateCount} ${duplicateCount === 1 ? 'duplicate' : 'duplicates'} skipped`) : '',
      added.length === 1 && added[0].source.song ? (isRu ? 'найден плейлист — режим «Песня»' : 'playlist found — Song mode') : '',
    ].filter(Boolean).join(' · ');
    const countLabel = `${totalParts} ${partsWord(totalParts, isRu)}${inScene}`;
    const head = added.length === 1 ? `${added[0].source.name}: ${countLabel}` : (isRu ? `Файлов: ${added.length} · ${countLabel}` : `${added.length} files · ${countLabel}`);
    notify.success(extras ? `${head} · ${extras}` : head, toastTitle);
  }, [attachAudio, refuseWhileExporting, clock, requestPaint, isRu, toastTitle]);

  const handlersRef = useRef({ togglePlay, play, pause, canPlay, seekBars, cycleLook, toggleFullscreen, importFiles });
  handlersRef.current = { togglePlay, play, pause, canPlay, seekBars, cycleLook, toggleFullscreen, importFiles };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const handlers = handlersRef.current;
      // Native arrow stepping stays on the other sliders; on the seek bar a step of 1/10000 is useless, so arrows jump a bar there too.
      const onRange = event.target instanceof HTMLInputElement && event.target.type === 'range' && !event.target.closest('.vz-seek');
      if (event.code === 'Space') {
        if (wantsNativeSpace(event.target)) return;
        event.preventDefault();
        if (!event.repeat) handlers.togglePlay();
      } else if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && !onRange) {
        event.preventDefault();
        handlers.seekBars(event.code === 'ArrowRight' ? 1 : -1);
      } else if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        event.preventDefault();
        handlers.cycleLook(event.code === 'BracketRight' ? 1 : -1);
      } else if (event.code === 'KeyF' && !event.repeat) {
        event.preventDefault();
        handlers.toggleFullscreen();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (activeRef.current && event.code === 'Space' && !isTypingTarget(event.target) && !wantsNativeSpace(event.target)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Capture-phase listeners on window keep visualizer drops away from the app-wide FLP scanner.
  useEffect(() => {
    let depth = 0;
    let watchdog = 0;
    const hide = () => {
      depth = 0;
      window.clearTimeout(watchdog);
      setDragActive(false);
    };
    const arm = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(hide, 1200);
    };
    const external = (event: DragEvent) => {
      // On other tabs drops belong to the library scanner.
      if (!activeRef.current) return false;
      const types = Array.from(event.dataTransfer?.types || []);
      return types.includes('Files') && !types.includes('application/x-stasher-internal') && !(window as unknown as { __stasher_is_internal_drag?: boolean }).__stasher_is_internal_drag;
    };
    const onEnter = (event: DragEvent) => {
      if (!external(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth++;
      if (!exportingRef.current) setDragActive(true);
      arm();
    };
    const onOver = (event: DragEvent) => {
      if (!external(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      if (!exportingRef.current) setDragActive(true);
      arm();
    };
    const onLeave = (event: DragEvent) => {
      if (!external(event)) return;
      event.stopPropagation();
      depth = Math.max(0, depth - 1);
      if (!depth) hide();
    };
    const onDrop = (event: DragEvent) => {
      if (!external(event)) return;
      event.preventDefault();
      event.stopPropagation();
      hide();
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) void handlersRef.current.importFiles(files);
    };
    window.addEventListener('dragenter', onEnter, true);
    window.addEventListener('dragover', onOver, true);
    window.addEventListener('dragleave', onLeave, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('dragend', hide, true);
    return () => {
      window.clearTimeout(watchdog);
      window.removeEventListener('dragenter', onEnter, true);
      window.removeEventListener('dragover', onOver, true);
      window.removeEventListener('dragleave', onLeave, true);
      window.removeEventListener('drop', onDrop, true);
      window.removeEventListener('dragend', hide, true);
    };
  }, []);

  const toggleExpanded = useCallback((id: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);
  const togglePart = useCallback((id: number) => setSelectedIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]), []);
  const selectGroup = useCallback((group: SourceGroup, all: boolean) => {
    const ids = new Set(group.parts.map(part => part.id));
    setSelectedIds(previous => {
      const rest = previous.filter(id => !ids.has(id));
      if (!all) return rest;
      const groupDuplicates = findDuplicateParts(group.parts);
      return [...rest, ...group.parts.filter(part => !groupDuplicates.has(part.id)).map(part => part.id)];
    });
    if (all) setExpanded(previous => previous.has(group.source.id) ? previous : new Set(previous).add(group.source.id));
  }, []);
  const removeGroup = useCallback((group: SourceGroup) => {
    const ids = new Set(group.parts.map(part => part.id));
    setImports(previous => previous.filter(item => item.source.id !== group.source.id));
    setSelectedIds(previous => previous.filter(id => !ids.has(id)));
  }, []);
  const clearSelection = useCallback(() => setSelectedIds([]), []);
  const retryLibrary = useCallback(() => setLibraryAttempt(value => value + 1), []);
  const dismissError = useCallback(() => setImportError(null), []);
  const retryImport = useCallback((files: File[]) => {
    setImportError(null);
    void handlersRef.current.importFiles(files);
  }, []);
  const openFiles = useCallback(() => { if (!refuseWhileExporting()) fileInputRef.current?.click(); }, [refuseWhileExporting]);
  const openAudio = useCallback(() => { if (!refuseWhileExporting()) audioInputRef.current?.click(); }, [refuseWhileExporting]);
  const selectMode = useCallback((mode: MidiVisualMode) => updatePrefs({ mode }), [updatePrefs]);

  const partColors = useMemo(() => {
    const colors = new Map<number, string>();
    const trackIndex = new Map<string, number>();
    scene?.tracks.forEach((track, index) => trackIndex.set(`${groupOfPart.get(track.id)?.source.id ?? ''}|${track.channel_index}`, index));
    for (const group of groups) {
      const channels = [...new Set(group.parts.map(part => part.channel_index))].sort((a, b) => a - b);
      for (const part of group.parts) {
        const index = selectedSet.has(part.id) ? trackIndex.get(`${group.source.id}|${part.channel_index}`) : undefined;
        colors.set(part.id, trackColor(index ?? channels.indexOf(part.channel_index), prefs.accent));
      }
    }
    return colors;
  }, [groups, groupOfPart, scene, selectedSet, prefs.accent]);

  const thumb = useMemo<ThumbSource>(() => {
    if (hasNotes && scene) return { pattern: scene.scene, tracks: scene.tracks, seconds: visualSeconds, analysis: audioAnalysis };
    if (audioAnalysis) return { pattern: AUDIO_ONLY_PATTERN, tracks: [], seconds: audioAnalysis.durationSeconds, analysis: audioAnalysis };
    return { pattern: demo?.scene || AUDIO_ONLY_PATTERN, tracks: demo?.tracks || [], seconds: demoSeconds, analysis: null };
  }, [hasNotes, scene, visualSeconds, audioAnalysis, demo, demoSeconds]);

  const slug = activeGroup ? slugify(activeGroup.source.name) : selectedGroups.length > 1 ? 'mix' : audioFile ? slugify(fileStem(audioFile.name)) : 'visual';
  const getJob = (): ExportJob | null => status === 'demo' ? null : {
    scene: pattern, tracks, mode: prefs.mode, accent: prefs.accent, audioFile: audioAnalysis ? audioFile : null, audioAnalysis, visualOptions, slug,
  };
  const blockedReason = status === 'demo'
    ? (isRu ? 'Выберите партии или добавьте аудио — и видео можно экспортировать.' : 'Select parts or add audio to export a video.')
    : analysingAudio ? (isRu ? 'Дождитесь окончания анализа аудио.' : 'Wait for the audio analysis to finish.') : null;
  const onExportingChange = useCallback((active: boolean) => {
    if (active) pause();
    setExporting(active);
  }, [pause]);

  return (
    // The chosen accent colours the video (canvas, swatches) only; the controls around it stay neutral (--vz-accent in CSS).
    <div ref={pageRef} className="visualizer-page workspace-content">
      <div className="page-heading vz-heading">
        <div className="title-line"><h1>{isRu ? 'Визуализатор' : 'Visualizer'}</h1><span>9:16</span></div>
      </div>

      <div className="vz-layout">
        <div className="vz-stage-col">
          <VisualizerStage
            isRu={isRu}
            stageRef={stageRef}
            canvasRef={canvasRef}
            canvasSize={canvasSize}
            ticker={ticker}
            status={status}
            scene={hasNotes ? scene : null}
            visualSeconds={visualSeconds}
            timelineSeconds={timelineSeconds}
            overview={overview}
            playing={playing}
            canPlay={canPlay}
            analysing={analysingAudio}
            exporting={exporting}
            fullscreen={fullscreen}
            arrangement={scene ? scene.kind : effectiveArrangement}
            songAvailable={songAvailable}
            songBlocked={songBlocked}
            modeName={modeName}
            onTogglePlay={togglePlay}
            onSeek={seek}
            onArrangement={setArrangement}
            onToggleFullscreen={toggleFullscreen}
            onOpenFiles={openFiles}
            onOpenAudio={openAudio}
          />
        </div>

        <div className="vz-inspector">
          <SourcePanel
            isRu={isRu}
            groups={groups}
            selected={selectedSet}
            duplicates={duplicates}
            colors={partColors}
            expanded={expanded}
            query={query}
            libraryState={libraryState}
            importing={importing}
            error={importError}
            onQuery={setQuery}
            onToggleExpanded={toggleExpanded}
            onTogglePart={togglePart}
            onSelectGroup={selectGroup}
            onRemoveGroup={removeGroup}
            onClearSelection={clearSelection}
            onOpenFiles={openFiles}
            onRetryLibrary={retryLibrary}
            onDismissError={dismissError}
            onRetryImport={retryImport}
          />
          <LookPanel
            isRu={isRu}
            mode={prefs.mode}
            filter={prefs.lookFilter}
            thumb={thumb}
            accent={prefs.accent}
            options={visualOptions}
            reducedMotion={reducedMotion}
            onSelect={selectMode}
            onFilter={lookFilter => updatePrefs({ lookFilter })}
          />
          <StylePanel isRu={isRu} title={prefs.title} autoTitle={autoTitle} intensity={prefs.intensity} onChange={updatePrefs} />
          <AudioPanel isRu={isRu} file={pendingAudio ?? audioFile} analysis={audioAnalysis} analysing={analysingAudio} locked={exporting} ticker={ticker} onPick={openAudio} onRemove={removeAudio} onSeek={seek} />
          <ExportPanel
            isRu={isRu}
            prefs={prefs}
            blockedReason={blockedReason}
            fullSeconds={status === 'demo' ? 0 : visualSeconds}
            fullKind={status === 'scene' ? scene!.kind : status === 'audio' ? 'audio' : null}
            audioSeconds={audioSeconds}
            getJob={getJob}
            getPlayhead={ticker.now}
            onPrefs={updatePrefs}
            onExportingChange={onExportingChange}
          />
        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple hidden accept={`${PART_ACCEPT},${AUDIO_ACCEPT}`} onChange={event => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (files.length) void importFiles(files);
      }} />
      <input ref={audioInputRef} type="file" hidden accept={AUDIO_ACCEPT} onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void attachAudio(file);
      }} />
      {dragActive && <DropOverlay isRu={isRu} />}
    </div>
  );
};
