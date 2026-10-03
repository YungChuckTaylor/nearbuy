// Tracker API client — same origin as the app: /api/tracker/*.
const BASE = (typeof window !== 'undefined' && window.NBG_CONFIG?.API_BASE ? window.NBG_CONFIG.API_BASE : '') + '/api/tracker';
const TOKEN_KEY = 'nbg_tracker_token';
const PROJECT_KEY = 'nbg_tracker_project';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
export const getProjectId = () => localStorage.getItem(PROJECT_KEY);
export const setProjectId = (id) => (id ? localStorage.setItem(PROJECT_KEY, id) : localStorage.removeItem(PROJECT_KEY));

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

async function request(method, path, body, { auth = true, raw = false } = {}) {
  const headers = {};
  const tok = getToken();
  if (auth && tok) headers.Authorization = `Bearer ${tok}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Network error — check your connection.');
  }
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res;
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data);
  return data;
}

export const api = {
  health: () => request('GET', '/health', undefined, { auth: false }),
  meta: () => request('GET', '/meta', undefined, { auth: false }),
  guest: (name) => request('POST', '/auth/guest', { name }, { auth: false }),
  login: (email, password) => request('POST', '/auth/login', { email, password }, { auth: false }),
  register: (name, email, password) => request('POST', '/auth/register', { name, email, password }, { auth: false }),
  me: () => request('GET', '/auth/me'),
  bootstrap: (project) => request('GET', `/bootstrap${project ? `?project=${encodeURIComponent(project)}` : ''}`),
  createProject: (data) => request('POST', '/projects', data),
  updateProject: (id, patch) => request('PATCH', `/projects/${id}`, patch),

  features: (query = '') => request('GET', `/features${query}`),
  createFeature: (data) => request('POST', '/features', data),
  updateFeature: (id, patch) => request('PATCH', `/features/${id}`, patch),
  deleteFeature: (id) => request('DELETE', `/features/${id}`),
  bulk: (payload) => request('POST', '/features/bulk', payload),

  workspaces: () => request('GET', '/workspaces'),
  createWorkspace: (data) => request('POST', '/workspaces', data),
  updateWorkspace: (id, patch) => request('PATCH', `/workspaces/${id}`, patch),
  deleteWorkspace: (id) => request('DELETE', `/workspaces/${id}`),
  board: (id) => request('GET', `/workspaces/${id}/cards`),

  place: (data) => request('POST', '/placements', data),
  movePlacements: (moves) => request('POST', '/placements/move', { moves }),
  unplace: (data) => request('POST', '/placements/remove', data),

  activity: (limit = 60) => request('GET', `/activity?limit=${limit}`),
  comments: (subject_id) => request('GET', `/comments${subject_id ? `?subject_id=${encodeURIComponent(subject_id)}` : ''}`),
  addComment: (data) => request('POST', '/comments', data),
  stats: () => request('GET', '/stats'),
  search: (q) => request('GET', `/search?q=${encodeURIComponent(q)}`),
  importDoc: (data) => request('POST', '/import', data),
  plan: (data) => request('POST', '/plan', data),
  invite: (data) => request('POST', '/invites', data),
  exportUrl: (format = 'json') => `${BASE}/export?format=${format}&project=${encodeURIComponent(getProjectId() || '')}`,
  streamUrl: (project) => `${BASE}/events?project=${encodeURIComponent(project || '')}`,
};
