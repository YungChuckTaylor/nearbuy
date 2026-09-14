// API client — talks to the same REST service the native apps will use.
const BASE = ((typeof window !== 'undefined' && window.NBG_CONFIG?.API_BASE) || '') + '/api/v1';
const TOKEN_KEY = 'nbg_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(method, path, body, { auth = true, cache = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const tok = getToken();
  if (auth && tok) headers.Authorization = `Bearer ${tok}`;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
  } catch (e) {
    // Offline fallback: serve last cached GET from localStorage
    if (method === 'GET' && cache) {
      const hit = localStorage.getItem('nbg_cache:' + path);
      if (hit) { const data = JSON.parse(hit); data.__stale = true; return data; }
    }
    throw new ApiError(0, 'You appear to be offline. Showing cached data where available.');
  }
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  if (method === 'GET' && cache) {
    try { localStorage.setItem('nbg_cache:' + path, JSON.stringify(data)); } catch { /* quota */ }
  }
  return data;
}

export const api = {
  get: (p, opts) => request('GET', p, null, opts),
  post: (p, body, opts) => request('POST', p, body, opts),
  put: (p, body, opts) => request('PUT', p, body, opts),
  del: (p, opts) => request('DELETE', p, null, opts),
};
