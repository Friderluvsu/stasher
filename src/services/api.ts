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
