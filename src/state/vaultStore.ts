import { create } from 'zustand';
import { api, type PatternItem, type SoundItem, type ProjectItem } from '../services/api';
import { audioEngine } from '../services/audioEngine';

export type WorkspaceTab = 'midi' | 'sounds' | 'kit';


export interface Kit {
  id: string;
  name: string;
  sounds: SoundItem[];
  patterns: PatternItem[];
}

interface VaultState {

  // Navigation
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;

  // Patterns
  patterns: PatternItem[];
  totalPatterns: number;
  patternTagCounts: Record<string, number>;

  // Sounds (StashSound)
  sounds: SoundItem[];
  totalSounds: number;
  soundTagCounts: Record<string, number>;

  // Projects
  projects: ProjectItem[];

  // Filters
  selectedTag: string;
  searchQuery: string;
  minBpm: number | null;
  maxBpm: number | null;
  selectedProjectId: number | null;

  // Audio Playback
  currentlyPlayingId: number | null;
  isPlaying: boolean;

  // Stacks (Multi-track mixer)
  masterTempo: number;

  // Selection & Batch Operations
  selectedSoundIds: number[];
  selectedPatternIds: number[];
  toggleSelectSound: (id: number) => void;
  toggleSelectPattern: (id: number) => void;
  selectAllSounds: (ids?: number[]) => void;
  selectAllPatterns: (ids?: number[]) => void;
  clearSelection: () => void;
  batchDeleteSelected: () => Promise<void>;
  batchUpdateTagSelected: (tag: string) => Promise<void>;
  batchUpdateItemsTag: (type: 'sound' | 'pattern', ids: number[], tag: string) => Promise<void>;
  batchAddSelectedToKit: (kitId?: string) => void;

  // Custom Sound Kit Builder
  kits: Kit[];
  activeKitId: string;
  createKit: (name: string) => string;
  setActiveKit: (id: string) => void;
  deleteKit: (id: string) => void;
  setKitName: (id: string, name: string) => void;
  toggleKitSound: (sound: SoundItem, kitId?: string) => void;
  toggleKitPattern: (pattern: PatternItem, kitId?: string) => void;
  removeKitSound: (soundId: number, kitId?: string) => void;
  removeKitPattern: (patternId: number, kitId?: string) => void;
  clearKit: (kitId?: string) => void;
  exportKit: (kitId?: string) => Promise<void>;

  // Item Updates
  updateItemInStore: (type: 'sound' | 'pattern', id: number, name: string, tag: string) => void;
  updateItemTag: (type: 'sound' | 'pattern', id: number, tag: string) => Promise<void>;

  // Scanning Modal & Progress
  isScanning: boolean;
  scanProgress: {
    scanned: number;
    total: number;
    current_file: string;
    successful: number;
  };

  // Actions
  fetchPatterns: () => Promise<void>;
  fetchSounds: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
  setSelectedTag: (tag: string) => void;
  setSearchQuery: (query: string) => void;
  setBpmFilter: (min: number | null, max: number | null) => void;
  setSelectedProjectId: (id: number | null) => void;
  
  // Playback
  playPattern: (pattern: PatternItem) => void;
  playSound: (sound: SoundItem) => void;
  stopPlayback: () => void;
  
  // Stacks

  // Scans & Seeds
  startScan: (paths: string[]) => Promise<void>;
  uploadAndScan: (files: File[]) => Promise<void>;
  pollScanProgress: () => Promise<void>;
  seedDemoData: () => Promise<void>;
  // Internal request sequence counters (race condition prevention)
  _patternFetchSeq: number;
  _soundFetchSeq: number;
}

export const useVaultStore = create<VaultState>((set, get) => {
  audioEngine.setListener((isPlaying, patternId) => {
    set({ isPlaying, currentlyPlayingId: patternId });
  });

  return {
    activeTab: 'midi',
    setActiveTab: (tab) => {
      set({ activeTab: tab });
      if (tab === 'sounds') get().fetchSounds();
      else if (tab === 'midi') get().fetchPatterns();
    },

    patterns: [],
    totalPatterns: 0,
    patternTagCounts: {},

    sounds: [],
    totalSounds: 0,
    soundTagCounts: {},

    projects: [],

    selectedTag: 'All',
    searchQuery: '',
    minBpm: null,
    maxBpm: null,
    selectedProjectId: null,

    currentlyPlayingId: null,
    isPlaying: false,

    masterTempo: 140,

    selectedSoundIds: [],
    selectedPatternIds: [],

    toggleSelectSound: (id) => {
      const { selectedSoundIds } = get();
      if (selectedSoundIds.includes(id)) {
        set({ selectedSoundIds: selectedSoundIds.filter((x) => x !== id) });
      } else {
        set({ selectedSoundIds: [...selectedSoundIds, id] });
      }
    },

    toggleSelectPattern: (id) => {
      const { selectedPatternIds } = get();
      if (selectedPatternIds.includes(id)) {
        set({ selectedPatternIds: selectedPatternIds.filter((x) => x !== id) });
      } else {
        set({ selectedPatternIds: [...selectedPatternIds, id] });
      }
    },

    selectAllSounds: (ids) => {
      const allIds = ids || get().sounds.map((s) => s.id);
      const { selectedSoundIds } = get();
      if (selectedSoundIds.length === allIds.length && allIds.length > 0) {
        set({ selectedSoundIds: [] });
      } else {
        set({ selectedSoundIds: allIds });
      }
    },

    selectAllPatterns: (ids) => {
      const allIds = ids || get().patterns.map((p) => p.id);
      const { selectedPatternIds } = get();
      if (selectedPatternIds.length === allIds.length && allIds.length > 0) {
        set({ selectedPatternIds: [] });
      } else {
        set({ selectedPatternIds: allIds });
      }
    },

    clearSelection: () => {
      set({ selectedSoundIds: [], selectedPatternIds: [] });
    },

    batchDeleteSelected: async () => {
      const { activeTab, selectedSoundIds, selectedPatternIds } = get();
      if (activeTab === 'sounds' && selectedSoundIds.length > 0) {
        const idsToDelete = [...selectedSoundIds];
        set({ selectedSoundIds: [] });
        await api.deleteSoundsBatch(idsToDelete);
        await get().fetchSounds();
      } else if (activeTab === 'midi' && selectedPatternIds.length > 0) {
        const idsToDelete = [...selectedPatternIds];
        set({ selectedPatternIds: [] });
        await api.deletePatternsBatch(idsToDelete);
        await get().fetchPatterns();
      }
    },

    batchUpdateTagSelected: async (tag: string) => {
      const { activeTab, selectedSoundIds, selectedPatternIds } = get();
      if (activeTab === 'sounds' && selectedSoundIds.length > 0) {
        const ids = [...selectedSoundIds];
        set({ selectedSoundIds: [] });
        await get().batchUpdateItemsTag('sound', ids, tag);
      } else if (activeTab === 'midi' && selectedPatternIds.length > 0) {
        const ids = [...selectedPatternIds];
        set({ selectedPatternIds: [] });
        await get().batchUpdateItemsTag('pattern', ids, tag);
      }
    },

    batchUpdateItemsTag: async (type: 'sound' | 'pattern', ids: number[], tag: string) => {
      if (!ids || ids.length === 0 || !tag) return;
      const numIds = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (numIds.length === 0) return;

      if (type === 'sound') {
        const currentSounds = get().sounds;
        const currentTagCounts = { ...get().soundTagCounts };

        // Optimistically recalculate counts
        for (const id of numIds) {
          const oldItem = currentSounds.find((s) => s.id === id);
          if (oldItem && oldItem.tag !== tag) {
            if (oldItem.tag && currentTagCounts[oldItem.tag]) {
              currentTagCounts[oldItem.tag] = Math.max(0, currentTagCounts[oldItem.tag] - 1);
            }
            currentTagCounts[tag] = (currentTagCounts[tag] || 0) + 1;
          }
        }

        const updatedSounds = currentSounds.map((s) => (numIds.includes(s.id) ? { ...s, tag } : s));

        set({
          sounds: updatedSounds,
          soundTagCounts: currentTagCounts,
          kits: get().kits.map((k) => ({
            ...k,
            sounds: k.sounds.map((s) => (numIds.includes(s.id) ? { ...s, tag } : s)),
          })),
        });

        try {
          await api.updateSoundsTagBatch(numIds, tag);
        } catch (err) {
          console.warn('Batch sounds tag failed, updating individually:', err);
          for (const id of numIds) {
            const s = currentSounds.find((item) => item.id === id);
            const name = s?.sample_name || s?.channel_name || 'Sound';
            await api.updateSound(id, name, tag).catch(() => {});
          }
        }
        await get().fetchSounds();
      } else {
        const currentPatterns = get().patterns;
        const currentTagCounts = { ...get().patternTagCounts };

        // Optimistically recalculate counts
        for (const id of numIds) {
          const oldItem = currentPatterns.find((p) => p.id === id);
          if (oldItem && oldItem.tag !== tag) {
            if (oldItem.tag && currentTagCounts[oldItem.tag]) {
              currentTagCounts[oldItem.tag] = Math.max(0, currentTagCounts[oldItem.tag] - 1);
            }
            currentTagCounts[tag] = (currentTagCounts[tag] || 0) + 1;
          }
        }

        const updatedPatterns = currentPatterns.map((p) => (numIds.includes(p.id) ? { ...p, tag } : p));

        set({
          patterns: updatedPatterns,
          patternTagCounts: currentTagCounts,
          kits: get().kits.map((k) => ({
            ...k,
            patterns: k.patterns.map((p) => (numIds.includes(p.id) ? { ...p, tag } : p)),
          })),
        });

        try {
          await api.updatePatternsTagBatch(numIds, tag);
        } catch (err) {
          console.warn('Batch patterns tag failed, updating individually:', err);
          for (const id of numIds) {
            const p = currentPatterns.find((item) => item.id === id);
            const name = p?.pattern_name || p?.channel_name || 'Pattern';
            await api.updatePattern(id, name, tag).catch(() => {});
          }
        }
        await get().fetchPatterns();
      }
    },

    batchAddSelectedToKit: (kitId?: string) => {
      const { activeTab, selectedSoundIds, selectedPatternIds, sounds, patterns } = get();
      const targetId = kitId || get().activeKitId;

      if (activeTab === 'sounds' && selectedSoundIds.length > 0) {
        const selectedSounds = sounds.filter((s) => selectedSoundIds.includes(s.id));
        set({
          kits: get().kits.map((k) => {
            if (k.id !== targetId) return k;
            const existingIds = new Set(k.sounds.map((s) => s.id));
            const newSounds = selectedSounds.filter((s) => !existingIds.has(s.id));
            return { ...k, sounds: [...k.sounds, ...newSounds] };
          }),
        });
      } else if (activeTab === 'midi' && selectedPatternIds.length > 0) {
        const selectedPatterns = patterns.filter((p) => selectedPatternIds.includes(p.id));
        set({
          kits: get().kits.map((k) => {
            if (k.id !== targetId) return k;
            const existingIds = new Set(k.patterns.map((p) => p.id));
            const newPatterns = selectedPatterns.filter((p) => !existingIds.has(p.id));
            return { ...k, patterns: [...k.patterns, ...newPatterns] };
          }),
        });
      }
    },

    kits: [{ id: 'default', name: 'My_StashSound_Kit', sounds: [], patterns: [] }],
    activeKitId: 'default',

    createKit: (name) => {
      const id = Date.now().toString();
      set({ kits: [...get().kits, { id, name, sounds: [], patterns: [] }], activeKitId: id });
      return id;
    },
    setActiveKit: (id) => set({ activeKitId: id }),
    deleteKit: (id) => {
      const { kits, activeKitId } = get();
      if (kits.length <= 1) return;
      const newKits = kits.filter(k => k.id !== id);
      set({ kits: newKits, activeKitId: activeKitId === id ? newKits[0].id : activeKitId });
    },
    setKitName: (id, name) => {
      set({
        kits: get().kits.map(k => k.id === id ? { ...k, name } : k)
      });
    },

    toggleKitSound: (sound, kitId) => {
      const targetId = kitId || get().activeKitId;
      set({
        kits: get().kits.map(k => {
          if (k.id !== targetId) return k;
          const exists = k.sounds.some(s => s.id === sound.id);
          return {
            ...k,
            sounds: exists ? k.sounds.filter(s => s.id !== sound.id) : [...k.sounds, sound]
          };
        })
      });
    },

    toggleKitPattern: (pattern, kitId) => {
      const targetId = kitId || get().activeKitId;
      set({
        kits: get().kits.map(k => {
          if (k.id !== targetId) return k;
          const exists = k.patterns.some(p => p.id === pattern.id);
          return {
            ...k,
            patterns: exists ? k.patterns.filter(p => p.id !== pattern.id) : [...k.patterns, pattern]
          };
        })
      });
    },

    removeKitSound: (soundId, kitId) => {
      const targetId = kitId || get().activeKitId;
      set({
        kits: get().kits.map(k => k.id === targetId ? { ...k, sounds: k.sounds.filter(s => s.id !== soundId) } : k)
      });
    },

    removeKitPattern: (patternId, kitId) => {
      const targetId = kitId || get().activeKitId;
      set({
        kits: get().kits.map(k => k.id === targetId ? { ...k, patterns: k.patterns.filter(p => p.id !== patternId) } : k)
      });
    },

    clearKit: (kitId) => {
      const targetId = kitId || get().activeKitId;
      set({
        kits: get().kits.map(k => k.id === targetId ? { ...k, sounds: [], patterns: [] } : k)
      });
    },

    exportKit: async (kitId) => {
      const targetId = kitId || get().activeKitId;
      const kit = get().kits.find(k => k.id === targetId);
      if (!kit) return;
      try {
        const blob = await api.exportKit({
          kit_name: kit.name || 'My_StashSound_Kit',
          sound_ids: kit.sounds.map(s => s.id),
          pattern_ids: kit.patterns.map(p => p.id)
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(kit.name || 'My_StashSound_Kit').replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Kit export error:', err);
      }
    },

    updateItemInStore: (type, id, name, tag) => {
      if (type === 'sound') {
        const currentSounds = get().sounds;
        const currentTagCounts = { ...get().soundTagCounts };
        const oldItem = currentSounds.find((s) => s.id === id);
        if (oldItem && oldItem.tag !== tag) {
          if (oldItem.tag && currentTagCounts[oldItem.tag]) {
            currentTagCounts[oldItem.tag] = Math.max(0, currentTagCounts[oldItem.tag] - 1);
          }
          currentTagCounts[tag] = (currentTagCounts[tag] || 0) + 1;
        }

        set({
          sounds: get().sounds.map(s => s.id === id ? { ...s, sample_name: name, tag } : s),
          soundTagCounts: currentTagCounts,
          kits: get().kits.map(k => ({
            ...k,
            sounds: k.sounds.map(s => s.id === id ? { ...s, sample_name: name, tag } : s)
          }))
        });
        get().fetchSounds();
      } else {
        const currentPatterns = get().patterns;
        const currentTagCounts = { ...get().patternTagCounts };
        const oldItem = currentPatterns.find((p) => p.id === id);
        if (oldItem && oldItem.tag !== tag) {
          if (oldItem.tag && currentTagCounts[oldItem.tag]) {
            currentTagCounts[oldItem.tag] = Math.max(0, currentTagCounts[oldItem.tag] - 1);
          }
          currentTagCounts[tag] = (currentTagCounts[tag] || 0) + 1;
        }

        set({
          patterns: get().patterns.map(p => p.id === id ? { ...p, pattern_name: name, tag } : p),
          patternTagCounts: currentTagCounts,
          kits: get().kits.map(k => ({
            ...k,
            patterns: k.patterns.map(p => p.id === id ? { ...p, pattern_name: name, tag } : p)
          }))
        });
        get().fetchPatterns();
      }
    },

    updateItemTag: async (type, id, tag) => {
      return get().batchUpdateItemsTag(type, [id], tag);
    },


    isScanning: false,
    scanProgress: {
      scanned: 0,
      total: 0,
      current_file: '',
      successful: 0
    },

    // Sequence counters to cancel stale in-flight requests
    _patternFetchSeq: 0,
    _soundFetchSeq: 0,

    fetchPatterns: async () => {
      const seq = get()._patternFetchSeq + 1;
      set({ _patternFetchSeq: seq });

      const { selectedTag, searchQuery, minBpm, maxBpm, selectedProjectId } = get();
      try {
        const res = await api.fetchPatterns({
          tag: selectedTag,
          search: searchQuery,
          min_bpm: minBpm || undefined,
          max_bpm: maxBpm || undefined,
          project_id: selectedProjectId || undefined,
          limit: 200
        });
        // Only apply if this is still the latest request
        if (get()._patternFetchSeq === seq) {
          set({
            patterns: res.items,
            totalPatterns: res.total,
            patternTagCounts: res.tag_counts
          });
        }
      } catch (err) {
        console.error('Failed to load patterns:', err);
      }
    },

    fetchSounds: async () => {
      const seq = get()._soundFetchSeq + 1;
      set({ _soundFetchSeq: seq });

      const { selectedTag, searchQuery, selectedProjectId } = get();
      try {
        const res = await api.fetchSounds({
          tag: selectedTag,
          search: searchQuery,
          project_id: selectedProjectId || undefined,
          limit: 200
        });
        // Only apply if this is still the latest request
        if (get()._soundFetchSeq === seq) {
          set({
            sounds: res.items,
            totalSounds: res.total,
            soundTagCounts: res.tag_counts
          });
        }
      } catch (err) {
        console.error('Failed to load sounds:', err);
      }
    },

    fetchProjects: async () => {
      try {
        const projects = await api.fetchProjects();
        set({ projects });
      } catch (err) {
        console.error('Failed to load projects:', err);
      }
    },

    deleteProject: async (id: number) => {
      try {
        await api.deleteProject(id);
        const { selectedProjectId } = get();
        if (selectedProjectId === id) {
          set({ selectedProjectId: null });
        }
        await get().fetchProjects();
        await get().fetchPatterns();
        await get().fetchSounds();
      } catch (err) {
        console.error('Failed to delete project:', err);
        throw err;
      }
    },

    setSelectedTag: (tag) => {
      const { activeTab } = get();
      if (activeTab === 'sounds') {
        set({ selectedTag: tag, sounds: [], totalSounds: 0 });
        get().fetchSounds();
      } else {
        set({ selectedTag: tag, patterns: [], totalPatterns: 0 });
        get().fetchPatterns();
      }
    },

    setSearchQuery: (query) => {
      set({ searchQuery: query });
      const { activeTab } = get();
      if (activeTab === 'sounds') get().fetchSounds();
      else get().fetchPatterns();
    },

    setBpmFilter: (min, max) => {
      set({ minBpm: min, maxBpm: max });
      get().fetchPatterns();
    },

    setSelectedProjectId: (id) => {
      const { activeTab } = get();
      if (activeTab === 'sounds') {
        set({ selectedProjectId: id, sounds: [], totalSounds: 0 });
        get().fetchSounds();
      } else {
        set({ selectedProjectId: id, patterns: [], totalPatterns: 0 });
        get().fetchPatterns();
      }
    },

    playPattern: (pattern) => {
      audioEngine.playPattern(
        pattern.id,
        pattern.notes,
        pattern.tempo || 140,
        pattern.ppq || 96,
        pattern.tag,
        true
      );
    },

    playSound: (sound) => {
      audioEngine.playSoundSample(sound.id, sound.tag);
    },

    stopPlayback: () => {
      audioEngine.stop();
    },


    startScan: async (paths) => {
      set({ isScanning: true });
      await api.startScan(paths);
      get().pollScanProgress();
    },

    uploadAndScan: async (files) => {
      set({ isScanning: true });
      try {
        await api.uploadAndScan(files);
        await get().fetchPatterns();
        await get().fetchSounds();
        await get().fetchProjects();
      } catch (err) {
        console.error('Upload and scan error:', err);
      } finally {
        set({ isScanning: false });
      }
    },

    pollScanProgress: async () => {
      const interval = setInterval(async () => {
        try {
          const res = await api.getScanProgress();
          set({ scanProgress: res });
          if (!res.is_scanning) {
            clearInterval(interval);
            set({ isScanning: false });
            get().fetchPatterns();
            get().fetchSounds();
            get().fetchProjects();
          }
        } catch {
          clearInterval(interval);
          set({ isScanning: false });
        }
      }, 400);
    },

    seedDemoData: async () => {
      try {
        await api.seedDemoData();
        await get().fetchPatterns();
        await get().fetchSounds();
        await get().fetchProjects();
      } catch (err) {
        console.error('Failed to seed demo data:', err);
      }
    }
  };
});
