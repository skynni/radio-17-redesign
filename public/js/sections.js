import { api } from './api.js';
import { $, $$, el, icon, gradientFor } from './util.js';

const initials = (name = '') => name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/* ---------- Gorąca 17 ---------- */
export async function initHot17() {
  const section = $('#hot17');
  try {
    const data = await api.hot17();
    const entries = [...(data?.entries || [])].sort((a, b) => b.votes_count - a.votes_count).slice(0, 17);
    if (!data?.enabled || !entries.length) return; // sekcja zostaje ukryta, gdy edycja nie trwa
    const max = Math.max(1, ...entries.map((e) => e.votes_count));
    $('#hotList').replaceChildren(
      ...entries.map((e, i) =>
        el('li', { class: 'hot__item' }, [
          el('span', { class: 'hot__bar', style: `--w:0%`, dataset: { w: `${Math.max(4, Math.round((e.votes_count / max) * 100))}%` } }),
          el('span', { class: 'hot__rank', text: String(i + 1) }),
          el('span', { class: 'hot__song', text: e.song }),
          el('span', { class: 'hot__votes' }, [String(e.votes_count), el('small', { text: 'głosów' })]),
        ]),
      ),
    );
    section.hidden = false;
    // animacja pasków po wejściu w widok
    const io = new IntersectionObserver((items) => {
      if (!items.some((i) => i.isIntersecting)) return;
      io.disconnect();
      requestAnimationFrame(() => $('#hotList').querySelectorAll('.hot__bar').forEach((b) => b.style.setProperty('--w', b.dataset.w)));
    }, { threshold: 0.2 });
    io.observe($('#hotList'));
  } catch { /* edycja niedostępna – sekcja pozostaje ukryta */ }
}

/* ---------- Zespół (podział na redakcje i działy, jak na oryginalnej stronie) ---------- */
const OFFICE_ORDER = ['Redakcja informacyjna', 'Redakcja muzyczna', 'Redakcja programowa', 'Dział techniczny', 'Dział promocji'];

/** Kolejność w grupie: naczelni → szefowie → zastępcy → pozostali członkowie. */
function roleRank(role = '') {
  const r = role.toLowerCase();
  if (!r) return 4;
  if (r.includes('prezes') || r.includes('naczeln') && !r.includes('zast')) return 0;
  if (r.startsWith('szef')) return 1;
  if (r.startsWith('zast')) return 2;
  return 3;
}

function personCard(p, i) {
  const lead = Boolean(p.radio_role?.role);
  return el('article', { class: `person${lead ? '' : ' person--member'}`, style: `animation-delay:${Math.min(i, 10) * 50}ms` }, [
    el('div', { class: 'person__photo', style: `--card-grad:${gradientFor(p.user?.name)}` }, [
      initials(p.user?.name),
      p.photo ? el('img', { src: p.photo, alt: p.user?.name || '', loading: 'lazy', decoding: 'async', onerror: (e) => e.target.remove() }) : null,
    ]),
    el('div', { class: 'person__body' }, [
      lead ? el('p', { class: 'person__role', text: p.radio_role.role }) : null,
      el('h3', { class: 'person__name', text: (p.user?.name || '').replace(/\s+/g, ' ').trim() }),
      p.description ? el('p', { class: 'person__bio', title: p.description, text: p.description }) : null,
    ]),
  ]);
}

export async function initTeam() {
  const grid = $('#teamGrid');
  try {
    const staff = await api.staff(); // wszyscy członkowie, nie tylko kolegium redakcyjne
    const groups = new Map();
    for (const p of staff) {
      const office = p.editorial_office?.name || 'Pozostali';
      if (!groups.has(office)) groups.set(office, []);
      groups.get(office).push(p);
    }
    const offices = [...groups.keys()].sort((a, b) => {
      const ia = OFFICE_ORDER.indexOf(a);
      const ib = OFFICE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const sections = offices.map((office) => {
      const members = groups.get(office).sort((a, b) => roleRank(a.radio_role?.role) - roleRank(b.radio_role?.role));
      return el('section', { class: 'team-group', dataset: { office }, 'aria-label': office }, [
        el('header', { class: 'team-group__head' }, [
          el('h3', { class: 'team-group__title', text: office }),
          el('span', { class: 'team-group__count', text: String(members.length) }),
        ]),
        el('div', { class: 'team-group__grid' }, members.map(personCard)),
      ]);
    });
    grid.replaceChildren(...sections);

    // filtrowanie po redakcji – te same chipy co w Blogu muzycznym
    const bar = $('#teamFilters');
    if (bar) {
      const select = (office) => {
        $$('.chip-btn', bar).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.office === office)));
        sections.forEach((s) => (s.hidden = office !== '' && s.dataset.office !== office));
      };
      const mk = (label, office) =>
        el('button', { class: 'chip-btn', type: 'button', text: label, 'aria-pressed': String(office === ''), dataset: { office }, onclick: () => select(office) });
      bar.replaceChildren(mk('Wszyscy', ''), ...offices.map((o) => mk(o, o)));
    }
  } catch {
    grid.replaceChildren(el('div', { class: 'error-box' }, [el('p', { text: 'Nie udało się pobrać listy zespołu.' })]));
  }
}

/* ---------- Kontakt + social media ---------- */
const SOCIAL = [
  ['social-facebook', 'facebook', 'Facebook'],
  ['social-instagram', 'instagram', 'Instagram'],
  ['social-youtube', 'youtube', 'YouTube'],
  ['social-tiktok', 'tiktok', 'TikTok'],
  ['social-linkedin', 'linkedin', 'LinkedIn'],
  ['social-mixcloud', 'mixcloud', 'Mixcloud'],
];

export async function initContact() {
  // karty kontaktowe
  try {
    const contacts = await api.contact();
    $('#contactCards').replaceChildren(
      ...contacts.map((c) =>
        el('article', { class: 'dept' }, [
          el('h3', { class: 'dept__role', text: c.role }),
          el('p', { class: 'dept__name', text: c.staff?.user?.name || '' }),
          c.email ? el('a', { class: 'dept__link', href: `mailto:${c.email}` }, [icon('mail'), c.email]) : null,
          c.phone ? el('a', { class: 'dept__link', href: `tel:${c.phone.replace(/\s+/g, '')}` }, [icon('phone'), c.phone]) : null,
        ]),
      ),
    );
  } catch {
    $('#contactCards').replaceChildren(
      el('article', { class: 'dept' }, [
        el('h3', { class: 'dept__role', text: 'Redakcja' }),
        el('a', { class: 'dept__link', href: 'mailto:redakcja@radio17.pl' }, [icon('mail'), 'redakcja@radio17.pl']),
        el('a', { class: 'dept__link', href: 'tel:664605251' }, [icon('phone'), '664 605 251']),
      ]),
    );
  }

  // ustawienia współdzielone: adres, social media, współrzędne
  try {
    const s = await api.settings();
    if (s['contact-street']) document.querySelector('[data-contact="street"]').textContent = s['contact-street'];
    if (s['contact-city']) document.querySelector('[data-contact="city"]').textContent = `${s['contact-postal-code'] || ''} ${s['contact-city']}`.trim();
    if (s['contact-geo-latitude'] && s['contact-geo-longitude']) {
      $('#mapLink').href = `https://www.openstreetmap.org/?mlat=${s['contact-geo-latitude']}&mlon=${s['contact-geo-longitude']}#map=17/${s['contact-geo-latitude']}/${s['contact-geo-longitude']}`;
    }
    fillSocials(s);
  } catch {
    fillSocials({
      'social-facebook': 'https://www.facebook.com/radio17pl',
      'social-instagram': 'https://www.instagram.com/radio17.pl/',
      'social-youtube': 'https://www.youtube.com/channel/UC3-uSQvcomGNIyrLmE7ggtQ',
      'social-tiktok': 'https://www.tiktok.com/@centrummediowagh/',
      'social-linkedin': 'https://www.linkedin.com/company/studenckie-radio17',
      'social-mixcloud': 'https://www.mixcloud.com/Radio17/',
    });
  }
}

function fillSocials(s) {
  $('#socials').replaceChildren(
    ...SOCIAL.filter(([key]) => s[key]).map(([key, sym, label]) =>
      el('li', {}, [el('a', { href: s[key], target: '_blank', rel: 'noopener', 'aria-label': label, title: label }, [icon(sym)])]),
    ),
  );
}
