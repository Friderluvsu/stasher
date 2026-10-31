export interface NoteEvent {
  pitch: number;
  pos: number;
  duration: number;
  velocity: number;
}

export interface PatternItem {
  id: number;
  project_id: number;
  pattern_index: number;
  pattern_name: string;
  channel_index: number;
  channel_name: string;
  sample_path: string | null;
  tag: string;
  bars: number;
  key_root: string;
  note_count: number;
  tempo: number;
  ppq: number;
  notes: NoteEvent[];
  project_title: string;
  project_file_name: string;
  project_file_path: string;
  loop_ticks?: number;
}

export interface SoundItem {
  id: number;
  project_id: number;
  channel_index: number;
  channel_name: string;
  sample_name: string;
  sample_path: string | null;
  tag: string;
  file_exists: number;
  file_size: number;
  root_note?: string | null;
  project_title: string;
  project_file_name: string;
  project_tempo: number;
}

export interface PatternsResponse {
  total: number;
  items: PatternItem[];
  tag_counts: Record<string, number>;
}

export interface VisualizerSongClip {
  pattern_index: number;
  position: number;
  length: number;
  offset: number;
  track: number;
}

export interface VisualizerSong {
  ticks: number;
  clips: VisualizerSongClip[];
}

export interface VisualizerFlpResponse {
  file_name: string;
  title: string;
  tempo: number;
  ppq: number;
  patterns: Pick<PatternItem, 'pattern_index' | 'pattern_name' | 'channel_index' | 'channel_name' | 'tag' | 'bars' | 'key_root' | 'note_count' | 'tempo' | 'ppq' | 'notes'>[];
  song: VisualizerSong | null;
}

export type VisualizerApiErrorKind = 'offline' | 'unsupported' | 'too-large' | 'parse' | 'unknown';

export class VisualizerApiError extends Error {
  kind: VisualizerApiErrorKind;
  status: number | null;

  constructor(kind: VisualizerApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'VisualizerApiError';
    this.kind = kind;
    this.status = status;
  }
}

function errorDetail(data: unknown): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail.trim();
  if (Array.isArray(detail)) return detail.map(item => typeof item === 'string' ? item : (item as { msg?: unknown })?.msg).filter(item => typeof item === 'string' && item).join('; ');
  return '';
}

export interface SoundsResponse {
  total: number;
  items: SoundItem[];
  tag_counts: Record<string, number>;
}

export interface ProjectItem {
  id: number;
  file_path: string;
  file_name: string;
  title: string;
  tempo: number;
  ppq: number;
  channel_count: number;
  pattern_count: number;
  file_size: number;
  indexed_at: number;
}

export interface KitExportRequest {
  kit_name: string;
  sound_ids: number[];
  pattern_ids: number[];
}

const API_BASE = 'http://127.0.0.1:8765/api';

export const api = {
  async parseFlpForVisualizer(file: File, signal?: AbortSignal): Promise<VisualizerFlpResponse> {
    const body = new FormData();
    body.append('file', file);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/visualizer/parse-flp`, { method: 'POST', body, signal });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      throw new VisualizerApiError('offline', 'Stasher backend is not reachable');
    }
    if (!res.ok) {
      const detail = errorDetail(await res.json().catch(() => null));
      const kind: VisualizerApiErrorKind = res.status === 415 ? 'unsupported' : res.status === 413 ? 'too-large' : res.status === 422 ? 'parse' : 'unknown';
      throw new VisualizerApiError(kind, detail || `FLP parsing failed (${res.status})`, res.status);
    }
    const data = await res.json().catch(() => null) as Partial<VisualizerFlpResponse> | null;
    if (!data || typeof data !== 'object') throw new VisualizerApiError('unknown', 'Unexpected response from the Stasher backend', res.status);
    return {
      file_name: data.file_name || file.name,
      title: data.title || file.name.replace(/\.flp$/i, ''),
      tempo: data.tempo,
      ppq: data.ppq,
      patterns: Array.isArray(data.patterns) ? data.patterns : [],
      song: data.song && Array.isArray(data.song.clips) ? data.song : null,
    };
  },
  async fetchPatterns(params: {
    search?: string;
    tag?: string;
    min_bpm?: number;
    max_bpm?: number;
    project_id?: number;
    limit?: number;
    offset?: number;
  }): Promise<PatternsResponse> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.tag && params.tag !== 'All') query.set('tag', params.tag);
    if (params.min_bpm !== undefined) query.set('min_bpm', params.min_bpm.toString());
    if (params.max_bpm !== undefined) query.set('max_bpm', params.max_bpm.toString());
    if (params.project_id !== undefined) query.set('project_id', params.project_id.toString());
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.offset) query.set('offset', params.offset.toString());

    const res = await fetch(`${API_BASE}/patterns?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch patterns');
    return res.json();
  },

  async fetchSounds(params: {
    search?: string;
    tag?: string;
    project_id?: number;
    limit?: number;
    offset?: number;
  }): Promise<SoundsResponse> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.tag && params.tag !== 'All') query.set('tag', params.tag);
    if (params.project_id !== undefined) query.set('project_id', params.project_id.toString());
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.offset) query.set('offset', params.offset.toString());

    const res = await fetch(`${API_BASE}/sounds?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch sounds');
    return res.json();
  },

  async fetchProjects(): Promise<ProjectItem[]> {
    const res = await fetch(`${API_BASE}/projects`);
    if (!res.ok) throw new Error('Failed to fetch projects');
    return res.json();
  },

  async deleteProject(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete project');
  },

  async startScan(paths: string[], recursive: boolean = true) {
    const res = await fetch(`${API_BASE}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, recursive }),
    });
    if (!res.ok) throw new Error(`Failed to start scan (${res.status})`);
    return res.json();
  },

  async uploadAndScan(files: File[]) {
    const formData = new FormData();
    for (const f of files) {
      formData.append('files', f);
    }
    const res = await fetch(`${API_BASE}/upload-and-scan`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`Failed to upload and scan (${res.status})`);
    return res.json();
  },

  async getScanProgress() {
    const res = await fetch(`${API_BASE}/scan/progress`);
    return res.json();
  },

  async seedDemoData() {
    const res = await fetch(`${API_BASE}/demo-seed`, { method: 'POST' });
    return res.json();
  },

  async updateSound(id: number, name: string, tag: string) {
    const res = await fetch(`${API_BASE}/sounds/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tag })
    });
    if (!res.ok) throw new Error('Failed to update sound');
    return res.json();
  },

  async updatePattern(id: number, name: string, tag: string) {
    const res = await fetch(`${API_BASE}/patterns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tag })
    });
    if (!res.ok) throw new Error('Failed to update pattern');
    return res.json();
  },

  async deleteSoundsBatch(ids: number[]) {
    const res = await fetch(`${API_BASE}/sounds/batch`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) throw new Error('Failed to delete sounds');
    return res.json();
  },

  async deletePatternsBatch(ids: number[]) {
    const res = await fetch(`${API_BASE}/patterns/batch`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) throw new Error('Failed to delete patterns');
    return res.json();
  },

  async updateSoundsTagBatch(ids: number[], tag: string) {
    const res = await fetch(`${API_BASE}/sounds/batch-tag`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, tag })
    });
    if (!res.ok) throw new Error('Failed to update sounds tag');
    return res.json();
  },

  async updatePatternsTagBatch(ids: number[], tag: string) {
    const res = await fetch(`${API_BASE}/patterns/batch-tag`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, tag })
    });
    if (!res.ok) throw new Error('Failed to update patterns tag');
    return res.json();
  },

  async getKits(): Promise<{ kits: Array<{ id: string; name: string; sounds: SoundItem[]; patterns: PatternItem[] }>; active_kit_id: string }> {
    const res = await fetch(`${API_BASE}/kits`);
    if (!res.ok) throw new Error('Failed to fetch kits');
    return res.json();
  },

  async saveKit(kit: { id: string; name: string; sound_ids: number[]; pattern_ids: number[] }) {
    const res = await fetch(`${API_BASE}/kits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kit),
    });
    if (!res.ok) throw new Error('Failed to save kit');
    return res.json();
  },

  async deleteKit(kitId: string) {
    const res = await fetch(`${API_BASE}/kits/${kitId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete kit');
    return res.json();
  },

  async setActiveKit(activeKitId: string) {
    const res = await fetch(`${API_BASE}/kits/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active_kit_id: activeKitId }),
    });
    if (!res.ok) throw new Error('Failed to set active kit');
    return res.json();
  },

  async exportKit(request: KitExportRequest): Promise<Blob> {
    const res = await fetch(`${API_BASE}/kits/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error('Failed to export sound kit');
    return res.blob();
  },

  getMidiUrl(patternId: number) {
    return `${API_BASE}/patterns/${patternId}/midi`;
  },

  getSoundAudioUrl(soundId: number) {
    return `${API_BASE}/sounds/${soundId}/audio`;
  }
};
