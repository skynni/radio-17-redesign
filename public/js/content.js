import { api } from './api.js';
import { $, $$, el, icon, formatDate, gradientFor, sanitizeHtml, toast } from './util.js';

/* ==========================================================================
   Karty artykułów + paginowane listy (news / blog)
   ========================================================================== */

const KIND_LABEL = { news: 'Aktualności', blog: 'Blog muzyczny' };

function cardNode(post, kind, { feature = false, side = false, index = 0, onOpen }) {
  const category = post.category?.category || (kind === 'news' ? 'Aktualności' : 'Blog');
  const meta = [formatDate(post.published_at || post.created_at), post.author?.name].filter(Boolean);

  const media = el('div', { class: 'card__media', style: `--card-grad:${gradientFor(post.title)}` }, [
    post.image
      ? el('img', {
          src: post.image, alt: '', loading: index < 2 ? 'eager' : 'lazy', decoding: 'async',
          onerror: (e) => e.target.remove(),
        })
      : el('div', { class: 'card__ph' }, [icon('note')]),
  ]);

  const body = el('div', { class: 'card__body' }, [
    el('div', { class: 'card__meta' }, meta.flatMap((m, i) => (i ? [el('i'), m] : [m]))),
    el('h3', { class: 'card__title', text: post.title }),
    post.summary ? el('p', { class: 'card__sum', text: stripTags(post.summary) }) : null,
    el('span', { class: 'card__more' }, ['Czytaj dalej', icon('arrow')]),
  ]);

  const card = el(
    'a',
    {
      class: `card${feature ? ' card--feature' : ''}${side ? ' card--side' : ''}`,
      href: `#/${kind}/${post.slug}`,
      style: `animation-delay:${Math.min(index, 8) * 60}ms`,
      'aria-label': post.title,
      onclick: (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        onOpen(post, kind);
      },
    },
    [media, body],
  );
  if (kind === 'blog' || post.category) media.append(el('span', { class: 'card__cat', text: category }));
  return card;
}

function stripTags(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.textContent.replace(/\s+/g, ' ').trim();
}

class PagedList {
  constructor({ kind, grid, moreBtn, fetchPage, onOpen }) {
    this.kind = kind;
    this.grid = grid;
    this.moreBtn = moreBtn;
    this.fetchPage = fetchPage;
    this.onOpen = onOpen;
    this.page = 0;
    this.lastPage = 1;
    this.count = 0;
    this.loading = false;
    this.token = 0;
    moreBtn.addEventListener('click', () => this.load());
  }

  reset() {
    this.token++;
    this.page = 0;
    this.lastPage = 1;
    this.count = 0;
    this.loading = false;
    this.grid.replaceChildren();
  }

  skeleton() {
    const first = this.page === 0;
    return [first ? el('div', { class: 'skeleton skeleton--feature' }) : null, ...Array.from({ length: first ? 4 : 3 }, () => el('div', { class: 'skeleton' }))].filter(Boolean);
  }

  async load() {
    if (this.loading || (this.page && this.page >= this.lastPage)) return;
    this.loading = true;
    const token = this.token;
    this.moreBtn.hidden = true;
    const skeletons = this.skeleton();
    this.grid.append(...skeletons);
    try {
      const res = await this.fetchPage(this.page + 1);
      if (token !== this.token) return; // zmieniono kategorię w trakcie ładowania
      skeletons.forEach((s) => s.remove());
      this.page = res.meta?.current_page ?? this.page + 1;
      this.lastPage = res.meta?.last_page ?? this.page;
      const frag = document.createDocumentFragment();
      res.data.forEach((post) => {
        frag.append(cardNode(post, this.kind, { feature: this.count === 0, side: this.count === 1 || this.count === 2, index: this.count % 6, onOpen: this.onOpen }));
        this.count++;
      });
      if (!res.data.length && this.count === 0) {
        frag.append(el('div', { class: 'error-box' }, [el('p', { text: 'Brak wpisów w tej kategorii.' })]));
      }
      this.grid.append(frag);
      this.moreBtn.hidden = this.page >= this.lastPage;
    } catch (err) {
      if (token !== this.token) return;
      skeletons.forEach((s) => s.remove());
      this.grid.append(
        el('div', { class: 'error-box' }, [
          el('p', { text: 'Nie udało się pobrać wpisów.' }),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Spróbuj ponownie', onclick: (e) => { e.target.closest('.error-box').remove(); this.load(); } }),
        ]),
      );
    } finally {
      if (token === this.token) this.loading = false;
    }
  }
}

/* ==========================================================================
   Czytnik artykułów (<dialog>) + routing #/news/slug, #/blog/slug
   ========================================================================== */
class Reader {
  constructor() {
    this.dialog = $('#reader');
    this.current = null;
    this.lastFocus = null;
    $('#readerClose').addEventListener('click', () => this.close());
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.close(); });
    this.dialog.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
    $('#readerShare').addEventListener('click', async () => {
      const canonical = `https://radio17.pl/${this.current.kind}/${this.current.post.slug}`;
      try {
        if (navigator.share) await navigator.share({ title: this.current.post.title, url: canonical });
        else {
          await navigator.clipboard.writeText(canonical);
          toast('Link skopiowany do schowka', 'ok');
        }
      } catch { /* anulowano */ }
    });
    window.addEventListener('hashchange', () => this.route());
  }

  open(post, kind, { pushHash = true } = {}) {
    this.current = { post, kind };
    this.lastFocus = document.activeElement;
    const category = post.category?.category;

    const cover = $('#readerCover');
    cover.replaceChildren();
    cover.hidden = !post.image;
    if (post.image) cover.append(el('img', { src: post.image, alt: '', decoding: 'async', onerror: (e) => { e.target.remove(); cover.hidden = true; } }));

    $('#readerMeta').replaceChildren(
      ...[
        el('span', { class: 'chip', text: category || KIND_LABEL[kind] }),
        formatDate(post.published_at || post.created_at) ? el('span', { text: formatDate(post.published_at || post.created_at) }) : null,
        post.author?.name ? el('span', { text: `Autor: ${post.author.name}` }) : null,
      ].filter(Boolean),
    );
    $('#readerTitle').textContent = post.title;
    $('#readerBody').innerHTML = sanitizeHtml(post.content || `<p>${post.summary || ''}</p>`);
    $('#readerTags').replaceChildren(...(post.tagged || []).map((t) => el('li', { text: `#${t.tag_name}` })));
    document.title = `${post.title} – Radio1.7`;

    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.scrollTop = 0;
    document.documentElement.style.overflow = 'hidden';
    if (pushHash) history.pushState(null, '', `#/${kind}/${post.slug}`);
  }

  close() {
    if (!this.dialog.open) return;
    this.dialog.close();
    document.documentElement.style.overflow = '';
    document.title = 'Radio1.7 – studenckie radio z Krakowa | Słuchaj na żywo';
    if (/^#\/(news|blog)\//.test(location.hash)) history.pushState(null, '', location.pathname + location.search + `#${kindAnchor(this.current?.kind)}`);
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  async route() {
    const match = location.hash.match(/^#\/(news|blog)\/([a-z0-9-]+)$/i);
    if (!match) {
      if (this.dialog.open) {
        this.dialog.close();
        document.documentElement.style.overflow = '';
      }
      return;
    }
    const [, kind, slug] = match;
    if (this.current?.post.slug === slug && this.dialog.open) return;
    try {
      const post = await (kind === 'news' ? api.newsBySlug(slug) : api.blogBySlug(slug));
      this.open(post.data || post, kind, { pushHash: false });
    } catch {
      toast('Nie znaleziono artykułu.', 'error');
    }
  }
}

const kindAnchor = (kind) => (kind === 'news' ? 'aktualnosci' : 'blog');

/* ==========================================================================
   Inicjalizacja sekcji
   ========================================================================== */
export function initContent() {
  const reader = new Reader();
  const onOpen = (post, kind) => reader.open(post, kind);

  const news = new PagedList({
    kind: 'news', grid: $('#newsGrid'), moreBtn: $('#newsMore'), onOpen,
    fetchPage: (page) => api.news(page),
  });

  let blogCategory = null;
  const blog = new PagedList({
    kind: 'blog', grid: $('#blogGrid'), moreBtn: $('#blogMore'), onOpen,
    fetchPage: (page) => api.blog(page, blogCategory),
  });

  const lazyStart = (target, fn) => {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    }, { rootMargin: '400px 0px' });
    io.observe(target);
  };

  lazyStart($('#aktualnosci'), () => news.load());
  lazyStart($('#blog'), async () => {
    blog.load();
    try {
      const cats = (await api.categories()).filter((c) => c.main_menu);
      const wrap = $('#blogCats');
      const mk = (label, slug) =>
        el('button', {
          class: 'chip-btn', type: 'button', text: label, 'aria-pressed': String(slug === null),
          dataset: { slug: slug ?? '' },
          onclick: () => {
            if ((blogCategory ?? null) === slug) return;
            blogCategory = slug;
            $$('.chip-btn', wrap).forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.slug || null) === slug)));
            blog.reset();
            blog.load();
          },
        });
      wrap.replaceChildren(mk('Wszystko', null), ...cats.map((c) => mk(c.category, c.slug)));
    } catch { /* bez filtrów też działa */ }
  });

  reader.route(); // deep link, np. #/blog/slug
}
