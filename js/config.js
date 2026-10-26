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

  // Источник 2 (резерв): сторонние плееры внутри нашего окна. Над плеером появятся кнопки по названиям ниже:
  // если одна база заблокирована или просит токен, переключись на другую.
  // В адресах подставляются {shikimori_id} (= номер MyAnimeList), {anilist_id} и {title}.
  // sandbox: права рамки. Если плеер уходит в чёрный экран, поставь sandbox: "" (рамка без ограничений).
  RESERVE: {
    enabled: true,
    sandbox: "allow-scripts allow-same-origin allow-forms allow-presentation",
    sources: [
      { name: "Kodik (теневой)", url: "https://aniqit.com/player?shikimoriID={shikimori_id}" },
      { name: "Collaps", url: "https://api.strvid.ws/embed/shikimori/{shikimori_id}" },
      { name: "Универсальный", url: "https://yohoho.cc/?shikimori={shikimori_id}" },
    ],
  },
};
