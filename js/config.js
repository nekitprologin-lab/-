// Настройки сайта. Меняй только этот файл.
window.APP_CONFIG = {
  SITE_NAME: "Tsukimi",

  // Облачный режим (аккаунты друзей, общие лайки и история).
  // Пока поля пустые, сайт работает в локальном режиме: данные лежат только в твоём браузере.
  // Где взять значения: Supabase → Project Settings → API.
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // Видео берётся из AniLibria (публичное API v1) и воспроизводится встроенным плеером на hls.js.
  // Если AniLibria снова поменяет адрес API, поменяй его здесь.
  LIBRIA_API: "https://anilibria.top/api/v1",

  // Ручная карта для сложных тайтлов, которые поиск не находит сам.
  // Ключ: номер MyAnimeList (он же Shikimori; его видно в адресе myanimelist.net/anime/НОМЕР),
  // значение: номер или alias релиза в AniLibria (anilibria.top/anime/releases/release/ALIAS/episodes).
  // Пример: 269: "bleach", 1735: "naruto-shippuuden-naruto-uragannye-khroniki"
  // Важно: в AniLibria есть не всё. Например, «Атаки титанов» там нет вообще, и карта тут не поможет.
  LIBRIA_MAP: {},

  // Источник 2 (резерв): ссылка на плеер ищется через Kodik REST API по номеру Shikimori (= номеру MyAnimeList).
  // host: Kodik отдаёт ссылки на домен kodik.info, который у многих провайдеров закрыт, поэтому домен подменяется
  // (можно поставить "https://kodik.biz/"). token: токен API (публичный, лежит в открытом коде сайта).
  // sandbox: права рамки; если плеер уходит в чёрный экран, поставь "" (рамка без ограничений).
  RESERVE: {
    enabled: true,
    api: "https://kodikapi.com/search",
    token: "8f828a2a87a8b139c2794ebf32b842de",
    host: "https://kodik.cc/",
    sandbox: "allow-scripts allow-same-origin allow-forms allow-presentation",
    timeoutMs: 8000,
  },
};
