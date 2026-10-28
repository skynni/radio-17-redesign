/**
 * Konfiguracja frontendu.
 *
 * Wartości pochodzą z analizy obecnej strony radio17.pl:
 *  - API Laravela:   /api/*  (stream/url, stream/stats, chat/*, schedule, news, blog, ...)
 *  - czat realtime:  Pusher (klucz publiczny), kanał publiczny "radio17-chat", event "message.posted"
 *  - antena:         Shoutcast – adres z /api/stream/url + "/;" (tak jak w oryginalnym odtwarzaczu)
 *
 * Gdy strona jest serwowana z radio17.pl, apiBase = '/api' działa w tym samym origin.
 * Można go nadpisać przed załadowaniem modułu: window.R17_API_BASE = 'https://radio17.pl/api'.
 */
export const CONFIG = {
  apiBase: (typeof window !== 'undefined' && window.R17_API_BASE) || '/api',
  site: 'https://radio17.pl',
  fallbackStream: 'https://emisja.radio17.pl',
  timezone: 'Europe/Warsaw',
  statsIntervalMs: 10_000,
  scheduleTickMs: 30_000,
  pusher: {
    src: 'https://js.pusher.com/8.4.0/pusher.min.js',
    key: '2ff25343012c8a40d5bd',
    cluster: 'eu',
    channel: 'radio17-chat',
    event: 'message.posted',
  },
  chat: {
    maxMessage: 150,
    maxNick: 64,
    consentKey: 'r17.chat.consent',
    nickKey: 'r17.chat.nick',
  },
};
