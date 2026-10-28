import { CONFIG } from './config.js';
import { api, ApiError } from './api.js';
import { $, $$, el, avatarColor, formatChatTime, lazyScript, store, toast } from './util.js';

/**
 * Czat słuchaczy – zachowuje działanie czatu z radio17.pl:
 *  - zgoda na politykę prywatności przed wejściem (RODO),
 *  - historia:      GET  /api/chat/messages?page=N  (najnowsze pierwsze, paginacja)
 *  - wysyłka:       POST /api/chat/message {author, content}  → { status: "success" }
 *  - czas rzeczywisty: Pusher, kanał publiczny "radio17-chat", event "message.posted" → { message }
 *  - limity: nick ≤ 64 znaki, wiadomość ≤ 150 znaków, throttling po stronie serwera (HTTP 429)
 */
export class Chat {
  constructor() {
    this.root = $('#chat');
    this.slot = $('#chatSlot');
    this.drawer = $('#chatDrawer');
    this.scrim = $('#scrim');

    this.gate = $('#chatGate');
    this.body = $('#chatBody');
    this.log = $('#chatLog');
    this.list = $('#chatList');
    this.empty = $('#chatEmpty');
    this.moreBtn = $('#chatMoreBtn');
    this.jumpBtn = $('#chatJumpBtn');
    this.form = $('#chatForm');
    this.nickRow = $('#chatNickRow');
    this.composeRow = $('#chatComposeRow');
    this.nickInput = $('#chatNick');
    this.msgInput = $('#chatMsg');
    this.counter = $('#chatCounter');
    this.sendBtn = $('#chatSendBtn');
    this.whoName = $('#chatWhoName');

    this.nick = (store.get(CONFIG.chat.nickKey, '') || '').slice(0, CONFIG.chat.maxNick);
    this.consent = store.get(CONFIG.chat.consentKey) === '1';
    this.entered = false;
    this.messages = new Map(); // id -> node
    this.pending = []; // lokalnie wysłane, czekają na potwierdzenie z Pusher
    this.page = 0;
    this.lastPage = 1;
    this.unread = 0;
    this.mode = 'docked';
    this.drawerOpen = false;
    this.pusher = null;
    this.hasConnectedOnce = false;
    this.localSeq = 0;
  }

  init() {
    this.bindUi();
    this.setConn('idle');
    this.setupDock();
    this.refreshComposer();
    if (this.consent) {
      // wejście w tle – nie blokuje renderowania strony
      (window.requestIdleCallback || ((fn) => setTimeout(fn, 1200)))(() => this.enter(), { timeout: 2500 });
    }
  }

  /* ==================== UI ==================== */
  bindUi() {
    $('#chatAcceptBtn').addEventListener('click', () => {
      store.set(CONFIG.chat.consentKey, '1');
      this.consent = true;
      this.enter().then(() => this.focusInput());
    });

    $('#chatCloseBtn').addEventListener('click', () => this.close());
    this.scrim.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.drawerOpen && !document.querySelector('dialog[open]')) this.close();
    });
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-chat-toggle]');
      if (t) this.toggle();
    });

    // nick
    const acceptNick = () => {
      const nick = this.nickInput.value.trim().replace(/\s+/g, ' ');
      if (nick.length < 2) {
        toast('Nick musi mieć co najmniej 2 znaki.', 'error');
        this.nickInput.focus();
        return;
      }
      this.nick = nick.slice(0, CONFIG.chat.maxNick);
      store.set(CONFIG.chat.nickKey, this.nick);
      this.refreshComposer();
      this.msgInput.focus();
    };
    $('#chatNickOk').addEventListener('click', acceptNick);
    this.nickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        acceptNick();
      }
    });
    $('#chatWho').addEventListener('click', () => {
      this.nick = '';
      this.nickInput.value = store.get(CONFIG.chat.nickKey, '') || '';
      this.refreshComposer();
      this.nickInput.focus();
      this.nickInput.select();
    });

    // wiadomość
    this.msgInput.addEventListener('input', () => this.updateCounter());
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send();
    });

    this.moreBtn.addEventListener('click', () => this.loadOlder());
    this.jumpBtn.addEventListener('click', () => this.scrollBottom(true));
    this.log.addEventListener('scroll', () => {
      if (this.nearBottom()) this.jumpBtn.hidden = true;
    }, { passive: true });
  }

  refreshComposer() {
    const hasNick = this.nick.length >= 2;
    this.nickRow.hidden = hasNick;
    this.composeRow.hidden = !hasNick;
    this.whoName.textContent = this.nick || 'gość';
    this.updateCounter();
  }

  updateCounter() {
    const len = this.msgInput.value.length;
    this.counter.textContent = `${len}/${CONFIG.chat.maxMessage}`;
    this.counter.classList.toggle('is-near', len >= CONFIG.chat.maxMessage - 20);
    this.sendBtn.disabled = this.msgInput.value.trim().length === 0 || this.sending;
  }

  focusInput() {
    if (matchMedia('(hover: none)').matches) return; // na telefonie nie wymuszaj klawiatury
    (this.nick ? this.msgInput : this.nickInput).focus({ preventScroll: true });
  }

  setConn(state) {
    this.root.dataset.conn = state;
    const label = { idle: 'Rozłączony', connecting: 'Łączenie…', online: 'Połączony na żywo', offline: 'Brak połączenia' }[state];
    $('#chatStatus span').textContent = label;
  }

  /* ==================== dokowanie panelu ==================== */
  setupDock() {
    const desktop = matchMedia('(min-width: 1101px)');
    let heroVisible = true;
    const apply = () => this.setMode(desktop.matches && heroVisible ? 'docked' : 'drawer');
    new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      apply();
    }, { threshold: 0.12 }).observe($('#live'));
    desktop.addEventListener('change', apply);
    apply();
  }

  setMode(mode) {
    if (mode === this.mode && this.root.parentElement) {
      if (this.root.dataset.mode !== mode) this.root.dataset.mode = mode;
      return;
    }
    const wasNearBottom = this.nearBottom();
    this.mode = mode;
    this.root.dataset.mode = mode;
    if (mode === 'docked') {
      this.slot.append(this.root);
      this.setDrawerOpen(false);
      this.clearUnread();
    } else {
      this.drawer.append(this.root);
    }
    if (wasNearBottom) requestAnimationFrame(() => this.scrollBottom());
  }

  setDrawerOpen(open) {
    this.drawerOpen = open;
    this.drawer.classList.toggle('is-open', open);
    this.drawer.setAttribute('aria-hidden', String(!open));
    this.scrim.hidden = !open || matchMedia('(min-width: 721px)').matches;
    $$('[data-chat-toggle]').forEach((b) => b.setAttribute('aria-expanded', String(open || this.mode === 'docked')));
    if (open) {
      this.clearUnread();
      requestAnimationFrame(() => this.scrollBottom());
    }
  }

  toggle() {
    if (this.mode === 'docked') {
      this.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      this.focusInput();
      if (!this.consent) $('#chatAcceptBtn').focus({ preventScroll: true });
      return;
    }
    if (this.drawerOpen) this.close();
    else this.open();
  }

  open() {
    if (this.mode === 'docked') return this.toggle();
    this.setDrawerOpen(true);
    setTimeout(() => (this.consent ? this.focusInput() : $('#chatAcceptBtn').focus({ preventScroll: true })), 350);
  }

  close() {
    this.setDrawerOpen(false);
  }

  /* ==================== wejście na czat ==================== */
  async enter() {
    if (this.entered) return;
    this.entered = true;
    this.gate.hidden = true;
    this.body.hidden = false;
    this.setConn('connecting');
    await this.loadLatest();
    this.connectRealtime();
  }

  /* ==================== historia ==================== */
  async loadLatest() {
    this.showEmpty('Ładowanie wiadomości. Poczekaj chwilę ;-)');
    try {
      const res = await api.chatMessages(1);
      this.page = res.meta?.current_page ?? 1;
      this.lastPage = res.meta?.last_page ?? 1;
      this.empty.hidden = true;
      [...res.data].reverse().forEach((m) => this.addMessage(m, { silent: true }));
      this.moreBtn.hidden = this.page >= this.lastPage;
      if (!this.messages.size) this.showEmpty('Brak wiadomości :( Bądź pierwszy!');
      this.scrollBottom();
    } catch {
      this.showEmpty('Czat jest aktualnie niedostępny. Spróbuj ponownie później', true);
      this.setConn('offline');
    }
  }

  /** Po odzyskaniu połączenia dociągnij wiadomości, które mogły nas ominąć. */
  async syncLatest() {
    try {
      const res = await api.chatMessages(1);
      [...res.data].reverse().forEach((m) => this.addMessage(m, { live: true }));
    } catch { /* ciche – kolejna próba przy następnym połączeniu */ }
  }

  async loadOlder() {
    if (this.page >= this.lastPage || this.loadingOlder) return;
    this.loadingOlder = true;
    this.moreBtn.disabled = true;
    try {
      const res = await api.chatMessages(this.page + 1);
      const before = this.log.scrollHeight;
      const top = this.log.scrollTop;
      const fresh = res.data.filter((m) => !this.messages.has(String(m.id)));
      // dane są od najnowszych – dokładamy na górę w odpowiedniej kolejności
      const frag = document.createDocumentFragment();
      [...fresh].reverse().forEach((m) => {
        const node = this.buildNode(m);
        this.messages.set(String(m.id), node);
        frag.append(node);
      });
      this.list.prepend(frag);
      this.log.scrollTop = top + (this.log.scrollHeight - before);
      this.page = res.meta?.current_page ?? this.page + 1;
      this.lastPage = res.meta?.last_page ?? this.lastPage;
      this.moreBtn.hidden = this.page >= this.lastPage;
    } catch {
      toast('Wystąpił błąd podczas ładowania. Spróbuj ponownie później.', 'error');
    } finally {
      this.loadingOlder = false;
      this.moreBtn.disabled = false;
    }
  }

  showEmpty(text, retry = false) {
    this.empty.hidden = false;
    this.empty.replaceChildren(el('p', { text }));
    if (retry) {
      this.empty.append(el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Spróbuj ponownie', onclick: () => this.loadLatest().then(() => this.connectRealtime()) }));
    }
  }

  /* ==================== czas rzeczywisty (Pusher) ==================== */
  async connectRealtime() {
    if (this.pusher) return;
    try {
      await lazyScript(CONFIG.pusher.src);
      this.pusher = new window.Pusher(CONFIG.pusher.key, { cluster: CONFIG.pusher.cluster });
    } catch {
      this.setConn('offline');
      return;
    }
    const map = { connecting: 'connecting', connected: 'online', unavailable: 'offline', failed: 'offline', disconnected: 'offline', initialized: 'connecting' };
    this.pusher.connection.bind('state_change', ({ current }) => {
      this.setConn(map[current] || 'connecting');
      if (current === 'connected') {
        if (this.hasConnectedOnce) this.syncLatest();
        this.hasConnectedOnce = true;
      }
    });
    const channel = this.pusher.subscribe(CONFIG.pusher.channel);
    channel.bind(CONFIG.pusher.event, (data) => {
      const message = data?.message ?? data;
      if (message?.content) this.addMessage(message, { live: true });
    });
  }

  /* ==================== wiadomości ==================== */
  isMine(author) {
    return Boolean(this.nick) && String(author).trim().toLowerCase() === this.nick.toLowerCase();
  }

  buildNode(m, { pending = false } = {}) {
    const author = String(m.author ?? 'anonim');
    const mine = pending || this.isMine(author);
    return el('li', { class: `msg${mine ? ' msg--mine' : ''}${pending ? ' msg--pending' : ''}`, dataset: { id: m.id ?? '' } }, [
      el('div', { class: 'msg__avatar', style: `background:${avatarColor(author)}`, 'aria-hidden': 'true', text: author.trim().charAt(0) || '?' }),
      el('div', { class: 'msg__bubble' }, [
        el('div', { class: 'msg__head' }, [
          el('span', { class: 'msg__author', text: author, title: author }),
          el('time', { class: 'msg__time', datetime: m.created_at || '', text: formatChatTime(m.created_at || new Date().toISOString()) }),
        ]),
        el('p', { class: 'msg__text', text: String(m.content ?? '') }),
      ]),
    ]);
  }

  addMessage(m, { live = false, silent = false } = {}) {
    const id = m.id != null ? String(m.id) : null;
    if (id && this.messages.has(id)) return;

    // potwierdzenie własnej, wysłanej przed chwilą wiadomości
    if (live) {
      const idx = this.pending.findIndex((p) => p.author === String(m.author) && p.content === String(m.content) && Date.now() - p.ts < 30_000);
      if (idx !== -1) {
        const [p] = this.pending.splice(idx, 1);
        p.node.classList.remove('msg--pending');
        if (id) {
          p.node.dataset.id = id;
          this.messages.set(id, p.node);
        }
        return;
      }
    }

    this.empty.hidden = true;
    const stick = this.nearBottom();
    const node = this.buildNode(m);
    this.list.append(node);
    if (id) this.messages.set(id, node);

    if (silent) return;
    if (stick || node.classList.contains('msg--mine')) {
      this.scrollBottom();
    } else {
      this.jumpBtn.hidden = false;
    }
    const hiddenToUser = (this.mode === 'drawer' && !this.drawerOpen) || document.hidden;
    if (!node.classList.contains('msg--mine') && hiddenToUser) this.bumpUnread();
  }

  /* ==================== wysyłka ==================== */
  async send() {
    if (this.sending) return;
    const content = this.msgInput.value.trim().slice(0, CONFIG.chat.maxMessage);
    if (!content) return;
    if (this.nick.length < 2) {
      this.refreshComposer();
      this.nickInput.focus();
      return;
    }

    this.sending = true;
    this.msgInput.value = '';
    this.updateCounter();

    const author = this.nick;
    const node = this.buildNode({ author, content, created_at: new Date().toISOString() }, { pending: true });
    this.empty.hidden = true;
    this.list.append(node);
    this.scrollBottom();
    const entry = { author, content, node, ts: Date.now() };
    this.pending.push(entry);

    try {
      const res = await api.chatSend(author, content);
      if (res?.status !== 'success') throw new ApiError('Nie udało się wysłać wiadomości');
      // jeśli Pusher nie potwierdzi w 4 s, uznaj wiadomość za wysłaną
      setTimeout(() => node.classList.remove('msg--pending'), 4000);
      setTimeout(() => {
        const i = this.pending.indexOf(entry);
        if (i !== -1) this.pending.splice(i, 1);
      }, 30_000);
    } catch (err) {
      node.remove();
      const i = this.pending.indexOf(entry);
      if (i !== -1) this.pending.splice(i, 1);
      this.msgInput.value = content; // nie gub tekstu użytkownika
      toast(this.errorText(err), 'error');
    } finally {
      this.sending = false;
      this.updateCounter();
      this.msgInput.focus({ preventScroll: true });
    }
  }

  errorText(err) {
    if (err?.status === 429) return 'Wysyłasz za dużo wiadomości! Oj niegrzeczny...';
    if (err?.status === 419) return 'Sesja wygasła – odśwież stronę i spróbuj ponownie.';
    if (err?.status === 422) {
      const first = err.body?.errors && Object.values(err.body.errors).flat()[0];
      return first || 'Zachowuj się! Tak nie wypada :(';
    }
    return 'Wystąpił błąd podczas wysyłania wiadomości. Spróbuj ponownie później.';
  }

  /* ==================== przewijanie / nieprzeczytane ==================== */
  nearBottom() {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 90;
  }

  scrollBottom(smooth = false) {
    this.log.scrollTo({ top: this.log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    this.jumpBtn.hidden = true;
  }

  bumpUnread() {
    this.unread += 1;
    this.renderBadge();
  }

  clearUnread() {
    this.unread = 0;
    this.renderBadge();
  }

  renderBadge() {
    $$('[data-chat-badge]').forEach((b) => {
      b.hidden = this.unread === 0;
      b.textContent = this.unread > 99 ? '99+' : String(this.unread);
    });
  }
}
