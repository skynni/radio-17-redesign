import { CONFIG } from './config.js';
import { api } from './api.js';
import { $, $$, store, toast } from './util.js';

/**
 * Odtwarzacz anteny na żywo.
 * Źródło: /api/stream/url → Shoutcast, do którego (tak jak w oryginalnym odtwarzaczu) dopisujemy "/;".
 * Stan wystawiany jest w body[data-player] = idle | loading | playing | paused | error,
 * dzięki czemu CSS może reagować bez dodatkowego kodu.
 */
export class Player {
  constructor() {
    this.state = 'idle';
    this.intent = false; // czy użytkownik chce słuchać (do automatycznego wznawiania)
    this.retries = 0;
    this.useCors = true;
    this.audio = null;
    this.ctx = null;
    this.analyser = null;
    this.streamBase = CONFIG.fallbackStream;
    this.volume = Number(store.get('r17.volume', '0.8'));
    this.muted = store.get('r17.muted') === '1';
    this.listeners = new Set();
    this.meta = { title: 'Radio1.7', artist: 'Na żywo', artwork: null };
  }

  async init() {
    this.bindUi();
    this.applyVolumeUi();
    this.setState('idle');
    this.bindMediaSession();
    try {
      this.streamBase = (await api.streamUrl()) || CONFIG.fallbackStream;
    } catch {
      this.streamBase = CONFIG.fallbackStream; // awaryjnie – ten sam adres co w API
    }
  }

  get src() {
    const base = this.streamBase.replace(/\/+$/, '');
    return `${base}/;`;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setState(state) {
    this.state = state;
    document.body.dataset.player = state;
    const playing = state === 'playing' || state === 'loading';
    $$('[data-player-toggle]').forEach((btn) => {
      $$('[data-icon-play]', btn).forEach((i) => i.toggleAttribute('hidden', playing));
      $$('[data-icon-pause]', btn).forEach((i) => i.toggleAttribute('hidden', !playing));
      btn.setAttribute('aria-pressed', String(playing));
      if (!btn.dataset.keepLabel) btn.setAttribute('aria-label', playing ? 'Zatrzymaj antenę' : 'Włącz antenę');
      const label = $('[data-player-label]', btn);
      if (label) label.textContent = state === 'loading' ? 'Łączenie…' : playing ? 'Pauza' : 'Słuchaj';
    });
    const stateChip = $('[data-stream-state]');
    if (stateChip) {
      stateChip.textContent = { idle: 'Antena', loading: 'Łączenie…', playing: 'Gra na żywo', paused: 'Wstrzymano', error: 'Brak sygnału' }[state];
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    this.listeners.forEach((fn) => fn(state));
  }

  /* ---------- sterowanie ---------- */
  async toggle() {
    if (this.state === 'playing' || this.state === 'loading') this.stop();
    else await this.play();
  }

  createAudio(cors) {
    this.destroyAudio();
    const audio = new Audio();
    audio.preload = 'none';
    if (cors) audio.crossOrigin = 'anonymous';
    audio.volume = this.muted ? 0 : this.volume;
    // handlery reagują tylko, gdy to wciąż aktualny element audio
    const live = (fn) => () => {
      if (this.audio === audio) fn();
    };
    audio.addEventListener('playing', live(() => {
      this.retries = 0;
      this.lastProgress = Date.now();
      this.setState('playing');
    }));
    audio.addEventListener('timeupdate', live(() => { this.lastProgress = Date.now(); }));
    audio.addEventListener('waiting', live(() => this.intent && this.setState('loading')));
    audio.addEventListener('ended', live(() => this.intent && this.recover()));
    audio.addEventListener('error', live(() => this.onError()));
    this.audio = audio;
    this.analyser = null;
    this.lastProgress = Date.now();
    this.startWatchdog();
    return audio;
  }

  /** Jeśli przez 12 s nie ma postępu odtwarzania (zerwane połączenie), wznów stream. */
  startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      if (!this.intent || !this.audio || this.state === 'error') return;
      if (Date.now() - this.lastProgress > 12_000 && this.retries < 4) {
        this.lastProgress = Date.now();
        this.recover();
      }
    }, 4000);
  }

  destroyAudio() {
    if (!this.audio) return;
    const a = this.audio;
    this.audio = null;
    a.pause();
    a.removeAttribute('src');
    a.load();
  }

  ensureAnalyser() {
    if (!this.useCors || this.analyser || !this.audio) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx ||= new AudioCtx();
      const source = this.ctx.createMediaElementSource(this.audio);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      analyser.connect(this.ctx.destination);
      this.analyser = analyser;
    } catch {
      this.analyser = null; // wizualizacja zastępcza
    }
  }

  async play() {
    this.intent = true;
    this.setState('loading');
    if (!this.audio) this.createAudio(this.useCors);
    this.ensureAnalyser();
    try { await this.ctx?.resume(); } catch { /* ignoruj */ }
    this.audio.src = this.src;
    this.audio.load();
    try {
      await this.audio.play();
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        this.intent = false;
        this.setState('paused');
        toast('Przeglądarka zablokowała odtwarzanie – kliknij Play jeszcze raz.', 'error');
      }
      // pozostałe błędy obsługuje zdarzenie "error"
    }
  }

  stop() {
    this.intent = false;
    this.retries = 0;
    this.destroyAudio(); // zamyka połączenie ze streamem (po wznowieniu zawsze „na żywo”)
    this.setState('paused');
  }

  onError() {
    if (!this.intent) return;
    // Jeśli CORS zawiódł przy pierwszej próbie – spróbuj bez analizatora (dźwięk ważniejszy niż wizualizacja)
    if (this.useCors && this.retries === 0) {
      this.useCors = false;
      this.createAudio(false);
      this.play();
      return;
    }
    this.recover();
  }

  recover() {
    if (!this.intent) return;
    if (this.retries >= 4) {
      this.intent = false;
      this.destroyAudio();
      this.setState('error');
      toast('Nie udało się połączyć z anteną. Spróbuj ponownie za chwilę.', 'error');
      return;
    }
    this.retries += 1;
    this.setState('loading');
    const delay = 800 * 2 ** (this.retries - 1);
    setTimeout(() => {
      if (!this.intent) return;
      if (!this.audio) this.createAudio(this.useCors);
      this.audio.src = this.src;
      this.audio.load();
      this.audio.play().catch(() => {});
    }, delay);
  }

  /* ---------- głośność ---------- */
  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, value));
    this.muted = this.volume === 0;
    store.set('r17.volume', String(this.volume || 0.8));
    store.set('r17.muted', this.muted ? '1' : '0');
    this.applyVolumeUi();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (!this.muted && this.volume === 0) this.volume = 0.6;
    store.set('r17.muted', this.muted ? '1' : '0');
    this.applyVolumeUi();
  }

  applyVolumeUi() {
    if (this.audio) this.audio.volume = this.muted ? 0 : this.volume;
    const range = $('#volumeRange');
    if (range) {
      const pct = Math.round((this.muted ? 0 : this.volume) * 100);
      range.value = String(pct);
      range.style.setProperty('--pct', `${pct}%`);
    }
    const muteBtn = $('#muteBtn');
    if (muteBtn) {
      $('[data-icon-volume]', muteBtn).toggleAttribute('hidden', this.muted);
      $('[data-icon-mute]', muteBtn).toggleAttribute('hidden', !this.muted);
      muteBtn.setAttribute('aria-label', this.muted ? 'Włącz dźwięk' : 'Wycisz');
    }
  }

  /* ---------- UI ---------- */
  bindUi() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-player-toggle]');
      if (btn) this.toggle();
    });
    $('#volumeRange')?.addEventListener('input', (e) => this.setVolume(Number(e.target.value) / 100));
    $('#muteBtn')?.addEventListener('click', () => this.toggleMute());

    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag) || document.activeElement?.isContentEditable) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'm' || e.key === 'M') {
        this.toggleMute();
      }
    });
  }

  /* ---------- Media Session (sterowanie z klawiatury multimedialnej / ekranu blokady) ---------- */
  bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.stop());
    navigator.mediaSession.setActionHandler('stop', () => this.stop());
    this.updateMediaSession();
  }

  setMeta(meta) {
    this.meta = { ...this.meta, ...meta };
    this.updateMediaSession();
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const { title, artist, artwork } = this.meta;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: 'Radio1.7 – na żywo',
      artwork: [
        ...(artwork ? [{ src: artwork, sizes: '600x600', type: 'image/jpeg' }] : []),
        { src: 'https://radio17.pl/img/favicons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      ],
    });
  }
}

/* ==========================================================================
   Wizualizator – słupki z AnalyserNode (lub animacja zastępcza)
   ========================================================================== */
export class Visualizer {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.player = player;
    this.levels = [];
    this.visible = true;
    this.t = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.loop();
    }).observe(canvas);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    const gap = 4 * dpr;
    const barW = 5 * dpr;
    this.count = Math.max(12, Math.floor(this.canvas.width / (barW + gap)));
    this.barW = barW;
    this.gap = gap;
    this.levels = new Array(this.count).fill(0);
    const grad = this.ctx2d.createLinearGradient(0, 0, this.canvas.width, 0);
    grad.addColorStop(0, '#00e08a');
    grad.addColorStop(1, '#00a5b5');
    this.fill = grad;
  }

  loop() {
    if (!this.visible || document.hidden) {
      if (this.visible) requestAnimationFrame(this.loop);
      return;
    }
    this.draw();
    requestAnimationFrame(this.loop);
  }

  draw() {
    const { ctx2d: c, canvas, player, count } = this;
    if (!count) return;
    this.t += 0.035;
    const playing = player.state === 'playing';
    const loading = player.state === 'loading';
    let freq = null;
    if (playing && player.analyser) {
      freq = new Uint8Array(player.analyser.frequencyBinCount);
      player.analyser.getByteFrequencyData(freq);
    }

    c.clearRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = this.fill;
    const maxH = canvas.height;
    const usable = freq ? Math.floor(freq.length * 0.72) : 0;

    for (let i = 0; i < count; i++) {
      let target;
      if (freq) {
        // mapowanie pasm: więcej rozdzielczości dla niskich częstotliwości
        const pos = Math.pow(i / count, 1.35);
        const v = freq[Math.min(usable - 1, Math.floor(pos * usable))] / 255;
        target = 0.06 + v * 0.94;
      } else if (playing) {
        const n = Math.sin(this.t * 2.2 + i * 0.55) * 0.5 + Math.sin(this.t * 1.3 + i * 1.1) * 0.5;
        target = 0.18 + (n * 0.5 + 0.5) * 0.62 * (0.7 + 0.3 * Math.sin(this.t * 0.7));
      } else if (loading) {
        target = 0.1 + (Math.sin(this.t * 6 - i * 0.4) * 0.5 + 0.5) * 0.35;
      } else {
        target = 0.05 + (Math.sin(this.t * 0.8 + i * 0.35) * 0.5 + 0.5) * 0.07;
      }
      if (this.reduced) target = playing ? 0.35 : 0.06;
      this.levels[i] += (target - this.levels[i]) * (target > this.levels[i] ? 0.45 : 0.14);
      const h = Math.max(this.barW, this.levels[i] * maxH);
      const x = i * (this.barW + this.gap);
      const y = (maxH - h) / 2;
      c.globalAlpha = playing ? 0.95 : 0.45;
      c.beginPath();
      c.roundRect ? c.roundRect(x, y, this.barW, h, this.barW / 2) : c.rect(x, y, this.barW, h);
      c.fill();
    }
    c.globalAlpha = 1;
  }
}
