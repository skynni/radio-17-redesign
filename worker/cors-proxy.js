/**
 * Proxy CORS dla API radio17.pl – potrzebny, gdy strona stoi na GitHub Pages
 * (API radio17.pl nie wysyła nagłówków CORS). Wdrożenie: Cloudflare Workers (darmowy plan).
 *
 *  - GET /api/...   → przekazuje do https://radio17.pl/api/... i dokłada nagłówki CORS
 *  - POST /api/...  → (czat) pobiera sesję + token CSRF ze strony głównej i dokłada je do żądania
 */
const UPSTREAM = 'https://radio17.pl';
const ALLOWED_ORIGINS = ['https://skynni.github.io', 'http://localhost:5173'];

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  Vary: 'Origin',
});

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: cors(origin) });

    const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Origin: UPSTREAM, Referer: `${UPSTREAM}/` };
    let body;
    if (request.method === 'POST') {
      body = await request.text();
      const home = await fetch(`${UPSTREAM}/`);
      const html = await home.text();
      headers['X-CSRF-TOKEN'] = (html.match(/name="csrf-token"\s+content="([^"]+)"/) || [])[1] || '';
      headers.Cookie = (home.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
      headers['Content-Type'] = request.headers.get('Content-Type') || 'application/json';
    }
    const res = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, { method: request.method, headers, body });
    return new Response(res.body, {
      status: res.status,
      headers: { ...cors(origin), 'Content-Type': res.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
