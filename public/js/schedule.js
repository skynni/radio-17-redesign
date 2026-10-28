import { CONFIG } from './config.js';
import { api } from './api.js';
import { $, $$, el, gradientFor, DAY_KEYS, DAY_LABELS, DAY_SHORT, warsawNow, toMinutes, hhmm } from './util.js';

/**
 * Ramówka: zakładki dni, wyróżnienie audycji „na antenie”,
 * oraz dane do hero (bieżąca i następna audycja – liczone w strefie Europe/Warsaw).
 */
export class Schedule {
  constructor() {
    this.data = null;
    this.selectedDay = warsawNow().day;
  }

  async start() {
    try {
      this.data = await api.schedule();
      this.renderTabs();
      this.renderDay();
      this.updateHero();
      setInterval(() => this.tick(), CONFIG.scheduleTickMs);
    } catch {
      const box = $('#scheduleList');
      box.replaceChildren(
        el('div', { class: 'error-box' }, [
          el('p', { text: 'Nie udało się pobrać ramówki.' }),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Spróbuj ponownie', onclick: () => this.start() }),
        ]),
      );
    }
  }

  entries(day) {
    return [...(this.data?.[day] || [])].sort((a, b) => toMinutes(a.start_hour) - toMinutes(b.start_hour));
  }

  /** Zwraca { current, next } dla bieżącej chwili. */
  now() {
    const { day, minutes } = warsawNow();
    const today = this.entries(day);
    const current = today.find((e) => minutes >= toMinutes(e.start_hour) && minutes < (toMinutes(e.end_hour) || 1440)) || null;
    let next = today.find((e) => toMinutes(e.start_hour) > minutes) || null;
    let nextDay = day;
    if (!next) {
      const idx = DAY_KEYS.indexOf(day);
      for (let i = 1; i <= 7 && !next; i++) {
        nextDay = DAY_KEYS[(idx + i) % 7];
        next = this.entries(nextDay)[0] || null;
      }
    }
    return { current, next, nextDay, day };
  }

  tick() {
    this.renderDay();
    this.updateHero();
  }

  /* ---------- hero ---------- */
  updateHero() {
    if (!this.data) return;
    const { current, next, nextDay, day } = this.now();
    $('[data-show-title]').textContent = current ? current.title : 'Muzyka non-stop';
    $('[data-show-time]').textContent = current ? `${hhmm(current.start_hour)}–${hhmm(current.end_hour)}` : 'Najlepsze brzmienia przez całą dobę';
    const nextRow = $('[data-show-next-row]');
    if (next) {
      const when = nextDay === day ? hhmm(next.start_hour) : `${DAY_LABELS[nextDay]} ${hhmm(next.start_hour)}`;
      $('[data-show-next]').textContent = `${next.title} · ${when}`;
      nextRow.hidden = false;
    } else {
      nextRow.hidden = true;
    }
  }

  /* ---------- zakładki ---------- */
  renderTabs() {
    const today = warsawNow().day;
    const tabs = $('#dayTabs');
    tabs.replaceChildren(
      ...DAY_KEYS.map((day) =>
        el('button', {
          class: `tab${day === today ? ' is-today' : ''}`,
          type: 'button',
          role: 'tab',
          id: `tab-${day}`,
          'aria-selected': String(day === this.selectedDay),
          'aria-controls': 'scheduleList',
          title: DAY_LABELS[day],
          dataset: { day },
          text: DAY_SHORT[day],
          onclick: () => {
            this.selectedDay = day;
            $$('.tab', tabs).forEach((t) => t.setAttribute('aria-selected', String(t.dataset.day === day)));
            this.renderDay(true);
          },
        }),
      ),
    );
    tabs.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
      const idx = DAY_KEYS.indexOf(this.selectedDay) + (e.key === 'ArrowRight' ? 1 : -1);
      const day = DAY_KEYS[(idx + 7) % 7];
      $(`#tab-${day}`).click();
      $(`#tab-${day}`).focus();
    });
  }

  /* ---------- lista audycji ---------- */
  renderDay(animate = false) {
    const list = $('#scheduleList');
    if (!this.data) return;
    const now = warsawNow();
    const isToday = this.selectedDay === now.day;
    const entries = this.entries(this.selectedDay);

    // zachowaj stan rozwinięcia opisów przy odświeżaniu co 30 s
    const opened = new Set($$('.slot.is-open', list).map((n) => n.dataset.id));

    if (!entries.length) {
      list.replaceChildren(el('div', { class: 'error-box' }, [el('p', { text: `W ${DAY_LABELS[this.selectedDay].toLowerCase()} gramy muzykę non-stop – bez zaplanowanych audycji.` })]));
      return;
    }

    const nodes = [];
    entries.forEach((e, i) => {
      const start = toMinutes(e.start_hour);
      const end = toMinutes(e.end_hour) || 1440;
      const live = isToday && now.minutes >= start && now.minutes < end;
      const past = isToday && now.minutes >= end;
      const upcoming = isToday && !live && !past && !entries.some((x) => toMinutes(x.start_hour) > now.minutes && toMinutes(x.start_hour) < start);

      // przerwa między audycjami = muzyka non-stop
      const prev = entries[i - 1];
      const prevEnd = prev ? toMinutes(prev.end_hour) : 0;
      if (start - prevEnd >= 20 && (prev || start > 0)) {
        nodes.push(this.gapNode(prev ? prev.end_hour : '00:00:00', e.start_hour, animate ? i : 0));
      }
      nodes.push(this.slotNode(e, { live, past, upcoming }, opened.has(String(e.id)), animate ? i : 0));
    });
    const last = entries[entries.length - 1];
    if (toMinutes(last.end_hour) <= 1440 - 20) nodes.push(this.gapNode(last.end_hour, '24:00:00', animate ? entries.length : 0));

    list.replaceChildren(...nodes);
  }

  gapNode(from, to, i) {
    return el('article', { class: 'slot slot--gap', style: i ? `animation-delay:${i * 40}ms` : 'animation:none' }, [
      el('div', { class: 'slot__time' }, [`${hhmm(from)}–${hhmm(to).replace('24:00', '00:00')}`]),
      el('h3', { class: 'slot__title', text: 'Muzyka non-stop · Radio1.7' }),
    ]);
  }

  slotNode(e, { live, past, upcoming }, open, i) {
    const hasDesc = Boolean(e.description && e.description.trim());
    const img = e.schedule_image || e.player_image;
    const long = hasDesc && e.description.length > 130;

    const node = el(
      'article',
      {
        class: `slot${live ? ' slot--live' : ''}${past ? ' slot--past' : ''}${open ? ' is-open' : ''}`,
        dataset: { id: e.id },
        style: i ? `animation-delay:${i * 40}ms` : 'animation:none',
        ...(live ? { 'aria-current': 'true' } : {}),
      },
      [
        el('div', { class: 'slot__time' }, [`${hhmm(e.start_hour)}–${hhmm(e.end_hour)}`]),
        el('div', { class: 'slot__img', style: `--slot-grad:${gradientFor(e.title)}` }, [
          img ? el('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', onerror: (ev) => { ev.target.remove(); } }) : null,
          img ? null : e.title.trim().charAt(0).toUpperCase(),
        ]),
        el('div', { class: 'slot__main' }, [
          el('h3', { class: 'slot__title', text: e.title }),
          hasDesc ? el('p', { class: 'slot__desc', text: e.description.trim() }) : null,
          long
            ? el('button', {
                class: 'slot__toggle', type: 'button', text: open ? 'Zwiń' : 'Czytaj więcej',
                'aria-expanded': String(open),
                onclick: (ev) => {
                  const slot = ev.target.closest('.slot');
                  const isOpen = slot.classList.toggle('is-open');
                  ev.target.textContent = isOpen ? 'Zwiń' : 'Czytaj więcej';
                  ev.target.setAttribute('aria-expanded', String(isOpen));
                },
              })
            : null,
        ]),
        live
          ? el('span', { class: 'pill pill--live slot__state' }, [el('i'), 'Na antenie'])
          : upcoming
            ? el('span', { class: 'pill pill--next slot__state', text: 'Następna' })
            : null,
      ],
    );
    return node;
  }
}
