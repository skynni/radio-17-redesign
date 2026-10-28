import { CONFIG } from './config.js';

export class ApiError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function xsrfFromCookie() {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function csrfHeaders() {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const meta = document.querySelector('meta[name="csrf-token"]')?.content;
  if (meta) headers['X-CSRF-TOKEN'] = meta;
  const xsrf = xsrfFromCookie();
  if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;
  return headers;
}

async function request(path, { method = 'GET', body, timeout = 15_000, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });

  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    Object.assign(headers, csrfHeaders());
  }

  try {
    const res = await fetch(`${CONFIG.apiBase}/${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) throw new ApiError(data?.message || `HTTP ${res.status}`, res.status, data);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.name === 'AbortError' ? 'Przekroczono czas oczekiwania' : 'Brak połączenia z serwerem', 0);
  } finally {
    clearTimeout(timer);
  }
}

export const getJson = (path, opts) => request(path, opts);
export const postJson = (path, body, opts) => request(path, { ...opts, method: 'POST', body });

/** Endpointy API Radia1.7 (nazwy z oryginalnego bundla strony). */
export const api = {
  streamUrl: async () => (await getJson('stream/url')).value,
  streamStats: () => getJson('stream/stats'),
  schedule: () => getJson('schedule'),
  news: (page = 1) => getJson(`news?page=${page}`),
  newsBySlug: (slug) => getJson(`news/show/${encodeURIComponent(slug)}`),
  blog: (page = 1, category) => getJson(category ? `blog/category/${encodeURIComponent(category)}?page=${page}` : `blog?page=${page}`),
  blogBySlug: (slug) => getJson(`blog/show/${encodeURIComponent(slug)}`),
  categories: () => getJson('categories'),
  hot17: () => getJson('hot-17'),
  staff: () => getJson('staff'),
  contact: () => getJson('contact'),
  settings: () => getJson('shared-settings'),
  chatMessages: (page = 1) => getJson(`chat/messages?page=${page}`),
  chatSend: (author, content) => postJson('chat/message', { author, content }),
};
