import { create } from 'zustand';
import { api, type PatternItem, type SoundItem, type ProjectItem } from '../services/api';
import { audioEngine } from '../services/audioEngine';

export type WorkspaceTab = 'midi' | 'sounds' | 'kit';

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

  // Custom Sound Kit Builder
  kitName: string;
  kitSounds: SoundItem[];
  kitPatterns: PatternItem[];
  setKitName: (name: string) => void;
  toggleKitSound: (sound: SoundItem) => void;
  toggleKitPattern: (pattern: PatternItem) => void;
  removeKitSound: (soundId: number) => void;
  removeKitPattern: (patternId: number) => void;
  clearKit: () => void;
  exportKit: () => Promise<void>;

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

    kitName: 'My_StashSound_Kit',
    kitSounds: [],
    kitPatterns: [],

    setKitName: (name) => set({ kitName: name }),

    toggleKitSound: (sound) => {
      const { kitSounds } = get();
      const exists = kitSounds.some((s) => s.id === sound.id);
      if (exists) {
        set({ kitSounds: kitSounds.filter((s) => s.id !== sound.id) });
      } else {
        set({ kitSounds: [...kitSounds, sound] });
      }
    },

    toggleKitPattern: (pattern) => {
      const { kitPatterns } = get();
      const exists = kitPatterns.some((p) => p.id === pattern.id);
      if (exists) {
        set({ kitPatterns: kitPatterns.filter((p) => p.id !== pattern.id) });
      } else {
        set({ kitPatterns: [...kitPatterns, pattern] });
      }
    },

    removeKitSound: (soundId) => {
      const { kitSounds } = get();
      set({ kitSounds: kitSounds.filter((s) => s.id !== soundId) });
    },

    removeKitPattern: (patternId) => {
      const { kitPatterns } = get();
      set({ kitPatterns: kitPatterns.filter((p) => p.id !== patternId) });
    },

    clearKit: () => {
      set({ kitSounds: [], kitPatterns: [] });
    },

    exportKit: async () => {
      const { kitName, kitSounds, kitPatterns } = get();
      try {
        const blob = await api.exportKit({
          kit_name: kitName || 'My_StashSound_Kit',
          sound_ids: kitSounds.map((s) => s.id),
          pattern_ids: kitPatterns.map((p) => p.id)
        });

        // Trigger browser / Electron download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(kitName || 'My_StashSound_Kit').replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Kit export error:', err);
      }
    },

    isScanning: false,
    scanProgress: {
      scanned: 0,
      total: 0,
      current_file: '',
      successful: 0
    },

    fetchPatterns: async () => {
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
        set({
          patterns: res.items,
          totalPatterns: res.total,
          patternTagCounts: res.tag_counts
        });
      } catch (err) {
        console.error('Failed to load patterns:', err);
      }
    },

    fetchSounds: async () => {
      const { selectedTag, searchQuery, selectedProjectId } = get();
      try {
        const res = await api.fetchSounds({
          tag: selectedTag,
          search: searchQuery,
          project_id: selectedProjectId || undefined,
          limit: 200
        });
        set({
          sounds: res.items,
          totalSounds: res.total,
          soundTagCounts: res.tag_counts
        });
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
      set({ selectedTag: tag });
      const { activeTab } = get();
      if (activeTab === 'sounds') get().fetchSounds();
      else get().fetchPatterns();
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
      set({ selectedProjectId: id });
      const { activeTab } = get();
      if (activeTab === 'sounds') get().fetchSounds();
      else get().fetchPatterns();
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
