// Режим «Киноман»: фильмы и сериалы (данные TMDB через наш Worker). Аккаунт и библиотека общие с аниме.
(function () {
  const cfg = window.APP_CONFIG || {};
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const IMG = "https://image.tmdb.org/t/p/";
  const mem = new Map();

  async function tmdb(path) {
    const w = cfg.WORKER_URL;
    if (!/^https:\/\//.test(w || "")) throw new Error("Шлюз не настроен");
    if (mem.has(path)) return mem.get(path);
    const r = await fetch(w + (w.includes("?") ? "&" : "?") + "tmdb=" + encodeURIComponent(path).replace(/%2F/g, "/").replace(/%3F/g, "?").replace(/%3D/g, "=").replace(/%26/g, "&").replace(/%2C/g, ","));
    if (r.status === 501) throw new Error("not_configured");
    if (!r.ok) throw new Error("Не удалось загрузить каталог (" + r.status + ")");
    const j = await r.json();
    mem.set(path, j);
    return j;
  }

  const L = "language=ru-RU";
  const kind = (m, def) => m.media_type || def;
  const title = (m) => m.title || m.name || "";
  const year = (m) => String(m.release_date || m.first_air_date || "").slice(0, 4);

  function card(m, def) {
    const k = kind(m, def);
    if (k !== "movie" && k !== "tv") return "";
    const sub = [year(m), k === "tv" ? "Сериал" : "Фильм"].filter(Boolean).join(", ");
    return `<a class="card" href="#/${k}/${m.id}">
      <div class="poster">${m.poster_path ? `<img src="${IMG}w342${m.poster_path}" alt="" loading="lazy">` : ""}
        ${m.vote_average ? `<span class="score">${m.vote_average.toFixed(1)}</span>` : ""}</div>
      <div class="name">${esc(title(m))}</div><div class="sub">${esc(sub)}</div></a>`;
  }
  const section = (t, body) => `<section class="section"><div class="section-head"><h2>${esc(t)}</h2></div>${body}</section>`;
  const rowOf = (list, def, ranked) => `<div class="row${ranked ? " ranked" : ""}">${list.map((m) => card(m, def)).join("")}</div>`;

  async function home(app) {
    app.innerHTML = `<div class="loading">Загружаю…</div>`;
    let trend, movies, tv, top, topTv;
    try {
      [trend, movies, tv, top, topTv] = await Promise.all([
        tmdb(`/trending/all/week?${L}`), tmdb(`/movie/now_playing?${L}&region=RU`), tmdb(`/tv/on_the_air?${L}`),
        tmdb(`/movie/top_rated?${L}`), tmdb(`/tv/top_rated?${L}`),
      ]);
    } catch (e) {
      app.innerHTML = `<div class="wrap"><div class="empty">${e.message === "not_configured" ? "Каталог фильмов ещё подключается. Загляни чуть позже." : esc(e.message)}</div></div>`;
      return;
    }
    const hero = (trend.results || []).filter((m) => m.backdrop_path)[0];
    let h = "";
    if (hero) {
      h += `<div class="kino-hero" style="background-image:url('${IMG}w1280${hero.backdrop_path}')"><div class="kino-hero-in wrap">
        <span class="hero-tag">В тренде</span><h1>${esc(title(hero))}</h1>
        <p>${esc((hero.overview || "").slice(0, 220))}${(hero.overview || "").length > 220 ? "…" : ""}</p>
        <a class="btn primary" href="#/${hero.media_type === "tv" ? "tv" : "movie"}/${hero.id}">Открыть</a></div></div>`;
    }
    h += `<div class="wrap">`;
    h += section("В тренде", rowOf((trend.results || []).slice(0, 18), "movie", true));
    h += section("Сейчас в кино", rowOf(movies.results || [], "movie"));
    h += section("Сериалы в эфире", rowOf(tv.results || [], "tv"));
    h += section("Лучшие фильмы", rowOf(top.results || [], "movie"));
    h += section("Лучшие сериалы", rowOf(topTv.results || [], "tv"));
    app.innerHTML = h + `</div>`;
  }

  function soon(app) {
    app.innerHTML = `<div class="wrap"><div class="empty">Страница фильма и плеер уже в работе. <a href="#/kino">Назад в Киноман</a></div></div>`;
  }

  window.Kino = { home, soon, ROUTES: ["kino", "movie", "tv"] };
})();
