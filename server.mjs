/**
 * Lokalny serwer deweloperski dla redesignu Radia1.7.
 *
 *  - serwuje statyczne pliki z ./public
 *  - proxuje /api/* do https://radio17.pl/api/* (API produkcyjne nie wysyła nagłówków CORS)
 *  - dla żądań modyfikujących (np. wysyłka wiadomości na czacie) utrzymuje sesję Laravela:
 *    pobiera cookies + token CSRF ze strony głównej i dokłada je do żądania.
 *
 * Na produkcji (strona serwowana z radio17.pl) ten plik nie jest potrzebny –
 * frontend odpytuje wtedy /api bezpośrednio, w tym samym origin.
 *
 * Uruchomienie:  node server.mjs   (PORT=8080 node server.mjs – inny port)
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const UPSTREAM = process.env.UPSTREAM || 'https://radio17.pl';
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/* ---------- sesja Laravela (cookies + CSRF) ---------- */
const jar = new Map();
let csrf = '';
let sessionPromise = null;

function storeCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function refreshSession() {
  const res = await fetch(`${UPSTREAM}/`, {
    headers: { 'User-Agent': 'Radio17-Redesign-Dev/1.0', Cookie: cookieHeader() },
  });
  storeCookies(res);
  const html = await res.text();
  const match = html.match(/name="csrf-token"\s+content="([^"]+)"/);
  csrf = match ? match[1] : '';
}

function ensureSession(force = false) {
  if (force || !csrf) {
    sessionPromise = refreshSession().finally(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise || Promise.resolve();
}

/* ---------- proxy /api ---------- */
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxy(req, res) {
  const method = req.method || 'GET';
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const body = unsafe ? await readBody(req) : undefined;

  const send = async () => {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'Radio17-Redesign-Dev/1.0',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: UPSTREAM,
      Referer: `${UPSTREAM}/`,
    };
    if (unsafe) {
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
      headers['X-CSRF-TOKEN'] = csrf;
      headers.Cookie = cookieHeader();
    }
    return fetch(`${UPSTREAM}${req.url}`, { method, headers, body });
  };

  try {
    if (unsafe) await ensureSession();
    let upstream = await send();
    if (unsafe && upstream.status === 419) {
      // sesja/CSRF wygasły – odśwież i spróbuj jeszcze raz
      await ensureSession(true);
      upstream = await send();
    }
    if (unsafe) storeCookies(upstream);
    const payload = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(payload);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Błąd połączenia z serwerem Radia1.7', detail: String(err) }));
  }
}

/* ---------- pliki statyczne ---------- */
async function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let target = normalize(join(ROOT, urlPath));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    let info = await stat(target);
    if (info.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target);
    }
    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 – nie znaleziono');
  }
}

http
  .createServer((req, res) => {
    if ((req.url || '').startsWith('/api/')) {
      proxy(req, res);
    } else {
      serveStatic(req, res);
    }
  })
  .listen(PORT, () => {
    console.log(`\n  Radio1.7 redesign  →  http://localhost:${PORT}\n  API proxy          →  ${UPSTREAM}/api\n`);
  });
