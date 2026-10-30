# Radio1.7 – redesign strony

Redesign strony Radia1.7 (Centrum Mediów AGH): odtwarzacz anteny na żywo, czat słuchaczy, ramówka i aktualności. Czysty HTML, CSS i JavaScript (moduły ES), bez bundlera.

Strona: https://skynni.github.io/radio-17-redesign/

## Funkcje

- odtwarzacz anteny na żywo i aktualnie grany utwór,
- czat słuchaczy (historia, wysyłka, czas rzeczywisty przez Pusher),
- ramówka, aktualności, blog, ekipa, kontakt.

## Struktura

```
public/          statyczny frontend (index.html, css/, js/, img/, env.js)
server.mjs       lokalny serwer + proxy do API radio17.pl
worker/          Cloudflare Worker – proxy CORS dla GitHub Pages
.github/         workflow wdrażający stronę na GitHub Pages
```

## Uruchomienie lokalne

Wymagany Node.js ≥ 18.

```bash
npm start
```

Serwer serwuje `public/` i przekazuje `/api/*` do radio17.pl. Pamiętaj, że `public/env.js` ustawia adres API – lokalnie zostaw pusty, żeby używać `/api`.

## Wdrożenie

1. **Frontend** – push na `main` uruchamia workflow w `.github/workflows/pages.yml` (GitHub Pages).
2. **Proxy CORS** – API radio17.pl nie wysyła nagłówków CORS, więc na GitHub Pages potrzebny jest Worker:

   ```bash
   npx wrangler deploy worker/cors-proxy.js --name radio17-proxy
   ```

   Następnie wpisz jego adres w `public/env.js`:

   ```js
   window.R17_API_BASE = 'https://radio17-proxy.TWOJA-NAZWA.workers.dev/api';
   ```

   Dozwolone originy ustawiasz w `ALLOWED_ORIGINS` w `worker/cors-proxy.js`.

## Czat

- historia: `GET /api/chat/messages?page=N`,
- wysyłka: `POST /api/chat/message` `{ author, content }` (nick ≤ 64, wiadomość ≤ 150 znaków),
- czas rzeczywisty: Pusher, kanał `radio17-chat`, event `message.posted`,
- przy zewnętrznym proxy token CSRF dokłada Worker.

Konfiguracja frontendu: `public/js/config.js`.
