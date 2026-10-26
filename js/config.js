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

  // Источник 2 (резерв): сторонний встраиваемый плеер в изолированной рамке без всплывающих окон.
  // В адресе подставляются {shikimori} (= номер MyAnimeList), {anilist} и {title}.
  // Внимание: multiembed.mov рассчитан на номера TMDB/IMDb и в проверке показал пустую рамку.
  // Если найдёшь рабочий шаблон, замени url, остальное подхватится само.
  RESERVE: {
    enabled: true,
    url: "https://multiembed.mov/?video_id={shikimori}&anime=1",
  },

  // Кнопки страховки, когда видео не открылось ни в одном источнике.
  LINKS: {
    animego: "https://animego.org/search/all?q={q}",
    shikimori: "https://shikimori.one/animes/{mal}",
  },
};
