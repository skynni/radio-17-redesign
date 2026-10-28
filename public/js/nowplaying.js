import { CONFIG } from './config.js';
import { api } from './api.js';
import { $, el, gradientFor } from './util.js';

const HISTORY_KEY = 'r17.recent';
const artCache = new Map();

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Okładka z iTunes Search API (publiczne, bez klucza, z CORS).
 * Wynik akceptujemy tylko, gdy artysta zgadza się z metadanymi – lepiej bez okładki niż z błędną.
 */
async function fetchArtwork(artist, title) {
  const key = `${artist}|${title}`;
  if (artCache.has(key)) return artCache.get(key);
  let url = null;
  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=5`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const { results = [] } = await res.json();
      const a = norm(artist);
      const hit = results.find((r) => {
        const ra = norm(r.artistName);
        return a && (ra.includes(a) || a.includes(ra));
      });
      if (hit?.artworkUrl100) url = hit.artworkUrl100.replace('100x100bb', '600x600bb');
    }
  } catch { /* brak okładki – generujemy gradient */ }
  artCache.set(key, url);
  return url;
}

export class NowPlaying {
  constructor(player) {
    this.player = player;
    this.current = null;
    this.history = this.loadHistory();
  }

  loadHistory() {
    try {
      return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
    } catch { return []; }
  }

  saveHistory() {
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(this.history.slice(0, 8))); } catch { /* ignoruj */ }
  }

  start() {
    this.renderHistory();
    this.poll();
    setInterval(() => !document.hidden && this.poll(), CONFIG.statsIntervalMs);
    document.addEventListener('visibilitychange', () => !document.hidden && this.poll());
  }

  async poll() {
    try {
      const stats = await api.streamStats();
      const artist = String(stats?.artist ?? '').trim();
      const title = String(stats?.title ?? '').trim();
      this.update(stats?.status === 'success' && (artist || title) ? { artist, title } : { artist: 'Radio1.7', title: 'Na żywo' }, stats?.status === 'success' && (artist || title));
    } catch {
      this.update({ artist: 'Radio1.7', title: 'Na żywo' }, false);
    }
  }

  async update(song, real) {
    const id = `${song.artist}|${song.title}`;
    if (this.current?.id === id) return;
    const prev = this.current;
    this.current = { id, ...song, real, artwork: null };

    // jeśli artysta jest pusty, pokaż tytuł jako główną linię
    const mainTitle = song.title || song.artist;
    const sub = song.title ? song.artist : 'Radio1.7';
    this.setText('[data-now-title]', mainTitle);
    this.setText('[data-now-artist]', sub);
    this.setText('[data-now-title-mini]', mainTitle);
    this.setText('[data-now-artist-mini]', sub);
    this.player.setMeta({ title: mainTitle, artist: sub, artwork: null });
    this.renderCover(null, id);

    if (prev?.real) {
      this.history = [{ artist: prev.artist, title: prev.title }, ...this.history.filter((h) => `${h.artist}|${h.title}` !== prev.id)].slice(0, 8);
      this.saveHistory();
      this.renderHistory();
    }

    if (real && song.artist) {
      const art = await fetchArtwork(song.artist, song.title);
      if (this.current?.id === id) {
        this.current.artwork = art;
        this.renderCover(art, id);
        if (art) this.player.setMeta({ artwork: art });
      }
    }
  }

  setText(sel, text) {
    const node = $(sel);
    if (node && node.textContent !== text) node.textContent = text;
  }

  renderCover(art, id) {
    const grad = gradientFor(id);
    const targets = [
      { box: $('[data-cover-art]'), big: true },
      { box: $('[data-cover-mini]'), big: false },
    ];
    for (const { box, big } of targets) {
      if (!box) continue;
      box.style.setProperty('--cover-grad', grad);
      if (box.hasAttribute('data-cover-art')) box.setAttribute('data-gen', '');
      box.querySelector('img')?.remove();
      const fallback = box.querySelector('.icon');
      if (fallback) fallback.style.display = art ? 'none' : '';
      if (art) {
        const img = el('img', { src: art, alt: big ? `Okładka: ${this.current?.title || ''}` : '', loading: 'eager', decoding: 'async' });
        img.addEventListener('error', () => {
          img.remove();
          if (fallback) fallback.style.display = '';
        });
        box.append(img);
      }
    }
  }

  renderHistory() {
    const wrap = $('#recentWrap');
    const list = $('#recentList');
    if (!wrap || !list) return;
    list.replaceChildren(
      ...this.history.slice(0, 6).map((h) => el('li', { title: `${h.artist} – ${h.title}`, text: h.title ? `${h.artist} – ${h.title}` : h.artist })),
    );
    wrap.hidden = this.history.length === 0;
  }
}
