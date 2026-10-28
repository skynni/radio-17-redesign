import { Player, Visualizer } from './player.js';
import { NowPlaying } from './nowplaying.js';
import { Schedule } from './schedule.js';
import { Chat } from './chat.js';
import { initContent } from './content.js';
import { initHot17, initTeam, initContact } from './sections.js';
import { $, $$ } from './util.js';

/* ---------- nagłówek: tło po przewinięciu, menu mobilne, scroll-spy ---------- */
function initChrome() {
  const header = $('#siteHeader');
  const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 12);
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });

  const nav = $('#mainNav');
  const btn = $('#menuBtn');
  const setMenu = (open) => {
    nav.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Zamknij menu' : 'Otwórz menu');
  };
  btn.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => e.target.closest('a') && setMenu(false));
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('is-open') && !e.target.closest('#mainNav, #menuBtn')) setMenu(false);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

  // podświetlanie aktywnej sekcji
  const links = new Map($$('[data-nav]').map((a) => [a.dataset.nav, a]));
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach((a) => a.classList.remove('is-active'));
      links.get(entry.target.id)?.classList.add('is-active');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });

  // animacje wejścia
  const reveal = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        reveal.unobserve(e.target);
      }
    });
  }, { threshold: 0, rootMargin: '0px 0px -40px 0px' });
  $$('[data-reveal]').forEach((s) => reveal.observe(s));

  $('#year').textContent = String(new Date().getFullYear());
}

/* ---------- mini-odtwarzacz: pokazuj, gdy główny odtwarzacz jest poza ekranem ---------- */
function initMiniPlayer() {
  const mini = $('#miniplayer');
  new IntersectionObserver(([entry]) => {
    mini.dataset.hidden = String(entry.isIntersecting);
  }, { threshold: 0.2 }).observe($('#stage'));
}

async function main() {
  initChrome();
  initMiniPlayer();

  const player = new Player();
  await player.init();
  new Visualizer($('#viz'), player);

  new NowPlaying(player).start();
  new Schedule().start();

  const chat = new Chat();
  chat.init();

  initContent();
  initHot17();
  initTeam();
  initContact();
}

main().catch((err) => console.error('Błąd inicjalizacji strony', err));
