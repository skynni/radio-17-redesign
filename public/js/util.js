import { CONFIG } from './config.js';

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tworzy element. attrs: class, dataset, text, html(tylko zaufane), on* -> listener, reszta -> atrybuty. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${cls}`.trim());
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/* ---------- toasty ---------- */
export function toast(message, type = 'info', ms = 4200) {
  const host = $('#toasts');
  if (!host) return;
  const node = el('div', { class: `toast toast--${type}`, role: 'status', text: message });
  host.append(node);
  setTimeout(() => {
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, ms);
}

/* ---------- kolory generowane z tekstu ---------- */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Spójny gradient w palecie marki dla danego tekstu (okładki, placeholdery). */
export function gradientFor(text) {
  const h = hash(text || 'radio');
  const hue1 = 150 + (h % 70); // zielenie → turkusy
  const hue2 = 170 + ((h >> 8) % 90); // turkus → fiolet
  return `linear-gradient(${120 + (h % 90)}deg, hsl(${hue1} 70% 24%), hsl(${hue2} 65% 14%))`;
}

export function avatarColor(name) {
  const h = hash((name || '?').toLowerCase());
  return `hsl(${(h % 360)} 78% 66%)`;
}

/* ---------- czas ---------- */
const fmtDate = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: CONFIG.timezone });
const fmtShortDate = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', timeZone: CONFIG.timezone });
const fmtTime = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.timezone });
const fmtDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: CONFIG.timezone });

export const formatDate = (iso) => (iso ? fmtDate.format(new Date(iso)) : '');

export function formatChatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = fmtDay.format(date) === fmtDay.format(new Date());
  return sameDay ? fmtTime.format(date) : `${fmtShortDate.format(date)}, ${fmtTime.format(date)}`;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const DAY_KEYS = WEEKDAYS;
export const DAY_LABELS = {
  monday: 'Poniedziałek',
  tuesday: 'Wtorek',
  wednesday: 'Środa',
  thursday: 'Czwartek',
  friday: 'Piątek',
  saturday: 'Sobota',
  sunday: 'Niedziela',
};
export const DAY_SHORT = { monday: 'Pon', tuesday: 'Wt', wednesday: 'Śr', thursday: 'Czw', friday: 'Pt', saturday: 'Sob', sunday: 'Ndz' };

/** Aktualny dzień tygodnia i minuty od północy w strefie Europe/Warsaw (niezależnie od strefy użytkownika). */
export function warsawNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.timezone,
    weekday: 'long',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    day: String(get('weekday')).toLowerCase(),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export function toMinutes(hhmmss) {
  const [h = '0', m = '0'] = String(hhmmss).split(':');
  return Number(h) * 60 + Number(m);
}

export const hhmm = (hhmmss) => String(hhmmss).slice(0, 5);

/* ---------- sanityzacja HTML z CMS ---------- */
const ALLOWED_IFRAME_HOSTS = [
  'open.spotify.com', 'www.youtube.com', 'www.youtube-nocookie.com', 'youtube.com', 'player.vimeo.com',
  'w.soundcloud.com', 'www.mixcloud.com', 'bandcamp.com', 'embed.music.apple.com', 'www.facebook.com', 'tidal.com',
];
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'BASE', 'TITLE', 'SVG']);

/** Czyści HTML artykułu: usuwa skrypty/style/zdarzenia, zostawia bezpieczne osadzenia (Spotify, YouTube…). */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (DROP_TAGS.has(child.tagName.toUpperCase())) {
        child.remove();
        continue;
      }
      if (child.tagName === 'IFRAME') {
        let ok = false;
        try {
          const url = new URL(child.getAttribute('src') || '', CONFIG.site);
          ok = url.protocol === 'https:' && ALLOWED_IFRAME_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
        } catch { /* niepoprawny URL */ }
        if (!ok) {
          child.remove();
          continue;
        }
        child.setAttribute('loading', 'lazy');
        child.setAttribute('allow', 'autoplay; clipboard-write; encrypted-media; picture-in-picture');
        child.removeAttribute('width');
        if (!/spotify|youtu/.test(child.getAttribute('src') || '')) child.removeAttribute('height');
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        const unsafeUrl = (name === 'href' || name === 'src') && value.startsWith('javascript:');
        const keep = ['href', 'src', 'alt', 'title', 'loading', 'allow', 'allowfullscreen', 'colspan', 'rowspan', 'height', 'srcset'];
        if (name.startsWith('on') || name === 'style' || unsafeUrl || !keep.includes(name)) child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      if (child.tagName === 'IMG') {
        child.setAttribute('loading', 'lazy');
        child.setAttribute('decoding', 'async');
      }
      walk(child);
    }
  };
  walk(doc.body);
  // usuń puste akapity (&nbsp;)
  doc.body.querySelectorAll('p').forEach((p) => {
    if (!p.textContent.replace(/\u00a0/g, '').trim() && !p.querySelector('img, iframe')) p.remove();
  });
  return doc.body.innerHTML;
}

/* ---------- różne ---------- */
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function lazyScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Nie udało się załadować ${src}`));
    document.head.append(s);
  });
}

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* tryb prywatny */ }
  },
};
