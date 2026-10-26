// Настройки сайта. Меняй только этот файл.
window.APP_CONFIG = {
  SITE_NAME: "Tsukimi",

  // Облачный режим (аккаунты друзей, общие лайки и история).
  // Пока поля пустые, сайт работает в локальном режиме: данные лежат только в твоём браузере.
  // Где взять значения: Supabase → Project Settings → API.
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // Источники видео. В ссылке можно использовать:
  //   {mal_id}  — номер аниме (он же id на Shikimori и MyAnimeList)
  //   {episode} — номер серии
  // Плееры сторонних сервисов меняют адреса и пропадают. Если плеер не открывается,
  // замени ссылку здесь или добавь ещё один источник, ничего больше править не нужно.
  PLAYERS: [
    { name: "Kodik", url: "https://kodik.info/find-player?shikimoriID={mal_id}&episode={episode}" },
    // Запасные адреса того же сервиса: если основной блокирует провайдер, пробуй их через переключатель «Источник».
    { name: "Kodik (зеркало 2)", url: "https://kodik.cc/find-player?shikimoriID={mal_id}&episode={episode}" },
    { name: "Kodik (зеркало 3)", url: "https://aniqit.com/find-player?shikimoriID={mal_id}&episode={episode}" },
  ],
};
