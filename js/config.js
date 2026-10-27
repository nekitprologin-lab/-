// Настройки сайта. Меняй только этот файл.
window.APP_CONFIG = {
  SITE_NAME: "Tsukimi",

  // Облачный режим (аккаунты друзей, общие лайки и история).
  // Пока поля пустые, сайт работает в локальном режиме: данные лежат только в твоём браузере.
  // Где взять значения: Supabase → Project Settings → API.
  SUPABASE_URL: "https://lsscaosxueqmkrulahlx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxzc2Nhb3N4dWVxbWtydWxhaGx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNDA4NzAsImV4cCI6MjEwODYxNjg3MH0.M3s-qUOgQvo9NsAPzlLhZVyWEBMd4305W5QnQktjux0",

  // Видео берётся из AniLibria (публичное API v1) и воспроизводится встроенным плеером на hls.js.
  // Если AniLibria снова поменяет адрес API, поменяй его здесь.
  // Кнопки входа через внешние сервисы на странице входа: "google", "discord", "github".
  // Добавляй сервис сюда только после того, как включил его в Supabase (Authentication → Providers),
  // иначе кнопка будет вести на ошибку. Пустой список = только вход по почте.
  OAUTH_PROVIDERS: [],

  LIBRIA_API: "https://anilibria.top/api/v1",

  // Ручная карта для сложных тайтлов, которые поиск не находит сам.
  // Ключ: номер MyAnimeList (он же Shikimori; его видно в адресе myanimelist.net/anime/НОМЕР),
  // значение: номер или alias релиза в AniLibria (anilibria.top/anime/releases/release/ALIAS/episodes).
  // Пример: 269: "bleach", 1735: "naruto-shippuuden-naruto-uragannye-khroniki"
  // Важно: в AniLibria есть не всё. Например, «Атаки титанов» там нет вообще, и карта тут не поможет.
  LIBRIA_MAP: {},

  // Источник 2: Kodik через твой шлюз на Cloudflare Workers (код воркера выдан в чате, инструкция в README).
  // Впиши адрес воркера, например "https://kodik-gate.твоё-имя.workers.dev". Пока пусто, вкладка «Источник 2» отключена.
  // Сайт делает запрос WORKER_URL?id=НОМЕР_MYANIMELIST, воркер отвечает JSON {"url": "https://…"}, ссылка идёт в рамку.
  WORKER_URL: "https://api.tsukimianime.dpdns.org",
  // Домен плеера Kodik. Воркер отдаёт ссылку на aniqit.com, а он у меня не открывался; kodikplayer.com открылся и показал
  // настоящий плеер Kodik. Домен подменяется прямо на сайте, воркер переразвёртывать не нужно. Пусто = оставить как пришло.
  KODIK_HOST: "https://kodikplayer.com/",
  WORKER_SANDBOX: "allow-scripts allow-same-origin allow-forms allow-presentation",

  // Источник 3 (крайний случай): плеер megaplay.buzz по номеру MyAnimeList, внутри нашего окна. Язык: английские
  // субтитры или английская озвучка (русской нет). Серии выбираются кнопками под плеером.
  // В адресе подставляются {mal} (номер MyAnimeList), {ep} (серия) и {lang} (sub или dub).
  // sandbox оставь пустым: megaplay не работает в рамке с sandbox и пишет «Sandboxed our player is not allowed».
  // Это значит, что сторонний плеер может открывать всплывающие окна, чего песочница не позволяла бы.
  RESERVE: {
    enabled: true,
    url: "https://megaplay.buzz/stream/mal/{mal}/{ep}/{lang}",
    sandbox: "",
  },
};
