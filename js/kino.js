// Режим «Киноман»: фильмы и сериалы (данные TMDB через наш Worker). Аккаунт и библиотека общие с аниме.
(function () {
  const cfg = window.APP_CONFIG || {};
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const img = (size, path) => {
    const w = cfg.WORKER_URL || "";
    return w + (w.includes("?") ? "&" : "?") + "img=" + "/" + size + path;
  };
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
      <div class="poster">${m.poster_path ? `<img src="${img("w342", m.poster_path)}" alt="" loading="lazy">` : ""}
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
      h += `<div class="kino-hero" style="background-image:url('${img('w1280', hero.backdrop_path)}')"><div class="kino-hero-in wrap">
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

  const STATUS_TV = { "Returning Series": "Выходит", Ended: "Завершён", Canceled: "Отменён", "In Production": "В производстве", Planned: "Анонс" };

  async function detail(app, type, id) {
    if (!/^\d{1,9}$/.test(String(id || ""))) { app.innerHTML = `<div class="wrap"><div class="empty">Такой страницы нет. <a href="#/kino">В Киноман</a></div></div>`; return; }
    app.innerHTML = `<div class="loading">Загружаю…</div>`;
    let m;
    try { m = await tmdb(`/${type}/${id}?${L}&append_to_response=external_ids,credits,recommendations`); }
    catch (e) { app.innerHTML = `<div class="wrap"><div class="empty">${esc(e.message === "not_configured" ? "Каталог ещё подключается." : e.message)}</div></div>`; return; }
    const isTv = type === "tv";
    const ttl = title(m);
    const orig = (m.original_title || m.original_name) && (m.original_title || m.original_name) !== ttl ? m.original_title || m.original_name : "";
    const meta = [
      m.vote_average ? `<span><b>${m.vote_average.toFixed(1)}</b> оценка</span>` : "",
      year(m) ? `<span>${year(m)}</span>` : "",
      isTv ? `<span>Сериал</span>` : `<span>Фильм</span>`,
      !isTv && m.runtime ? `<span>${Math.floor(m.runtime / 60) ? Math.floor(m.runtime / 60) + " ч " : ""}${m.runtime % 60} мин</span>` : "",
      isTv && m.number_of_seasons ? `<span>${m.number_of_seasons} сез.</span>` : "",
      isTv && m.status ? `<span>${esc(STATUS_TV[m.status] || m.status)}</span>` : "",
    ].join("");
    const cast = ((m.credits && m.credits.cast) || []).slice(0, 8).map((c) => c.name).join(", ");
    const recs = ((m.recommendations && m.recommendations.results) || []).slice(0, 14);
    const seasons = isTv ? (m.seasons || []).filter((x) => x.season_number > 0) : [];
    const banner = m.backdrop_path ? img("w1280", m.backdrop_path) : "";
    app.innerHTML = `<div class="detail">
      <div class="detail-banner" style="background-image:url('${esc(banner)}')"></div>
      <div class="wrap detail-body">
        ${m.poster_path ? `<img class="cover" src="${esc(img("w500", m.poster_path))}" alt="">` : ""}
        <div>
          <h1 id="h1">${esc(ttl)}</h1>
          ${orig ? `<div class="alt">${esc(orig)}</div>` : ""}
          <div class="meta">${meta}</div>
          <div class="chips">${(m.genres || []).map((g) => `<span class="chip">${esc(g.name)}</span>`).join("")}</div>
          <div class="actions"><button type="button" class="btn primary" id="kPlay">Смотреть</button></div>
          ${m.tagline ? `<div class="alt" style="margin-top:18px">«${esc(m.tagline)}»</div>` : ""}
          <p class="desc">${esc(m.overview || "Описание пока отсутствует.")}</p>
          ${cast ? `<div class="muted" style="margin-top:14px"><b>В ролях:</b> ${esc(cast)}</div>` : ""}
        </div>
      </div>
      <div class="wrap" id="kWatch" hidden>
        ${isTv ? `<div class="kseasons chips" id="kSeasons">${seasons.map((x, i) => `<button type="button" class="chip ${i === 0 ? "on" : ""}" data-s="${x.season_number}">${esc(x.name || "Сезон " + x.season_number)}</button>`).join("")}</div><div class="eps" id="kEps"></div>` : ""}
        <div class="player-wrap kino-player" id="kPlayer"></div>
      </div>
      ${recs.length ? `<div class="wrap">${section("Похожее", rowOf(recs, type))}</div>` : ""}
    </div>`;

    const ids = { imdb_id: m.imdb_id || (m.external_ids && m.external_ids.imdb_id) || "" };
    const box = app.querySelector("#kPlayer");
    let urlCache = null;
    async function getUrl() {
      if (urlCache) return urlCache;
      const w = cfg.WORKER_URL;
      const q = ids.imdb_id ? "imdb=" + ids.imdb_id : "";
      if (!q) throw new Error("Для этого " + (isTv ? "сериала" : "фильма") + " пока нет данных для поиска плеера (слишком свежий релиз).");
      const r = await fetch(w + (w.includes("?") ? "&" : "?") + q);
      if (!r.ok) throw new Error("Плеер для этого " + (isTv ? "сериала" : "фильма") + " не нашёлся. Возможно, его нет в источнике.");
      urlCache = (await r.json()).url;
      return urlCache;
    }
    // запасной источник: агрегатор плееров Kinobox (ищет по IMDb), когда в Kodik фильма нет
    function loadScript(src) {
      return new Promise((res, rej) => {
        if (window.Kinobox) return res();
        const sc = document.createElement("script");
        sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error("script"));
        document.head.appendChild(sc);
      });
    }
    async function fallback() {
      await loadScript("https://kinobox.tv/kinobox.min.js");
      box.innerHTML = `<div class="kb" id="kbBox" style="min-height:420px"></div><div class="muted" style="margin-top:8px;font-size:13px">Источник: агрегатор плееров. Если плеер не запускается, выбери другой источник в списке над видео.</div>`;
      const search = ids.imdb_id ? { imdb: ids.imdb_id } : { title: orig || ttl, year: year(m) ? +year(m) : undefined };
      new window.Kinobox("#kbBox", { search, menu: { enabled: true } }).init();
    }
    async function play(season, episode) {
      box.innerHTML = `<div class="loading">Ищу плеер…</div>`;
      try {
        let src = await getUrl();
        if (isTv) src += (src.includes("?") ? "&" : "?") + "season=" + season + "&episode=" + episode;
        box.innerHTML = `<iframe src="${esc(src)}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="origin" style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px;background:#000"></iframe>`;
      } catch (e) {
        try { await fallback(); }
        catch (e2) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
      }
    }
    let curS = seasons[0] ? seasons[0].season_number : 1, curE = 1;
    async function drawEps(sn) {
      curS = sn;
      const el = app.querySelector("#kEps");
      el.innerHTML = `<div class="muted">Загружаю серии…</div>`;
      try {
        const sd = await tmdb(`/tv/${id}/season/${sn}?${L}`);
        const eps = sd.episodes || [];
        el.innerHTML = eps.map((e) => `<a class="ep ${e.episode_number === curE ? "cur" : ""}" href="#" data-e="${e.episode_number}" title="${esc(e.name || "")}">${e.episode_number}</a>`).join("");
      } catch (e) { el.innerHTML = ""; }
    }
    app.querySelector("#kPlay").onclick = () => {
      const w = app.querySelector("#kWatch"); w.hidden = false;
      w.scrollIntoView({ behavior: "smooth", block: "start" });
      if (isTv) drawEps(curS);
      play(curS, curE);
    };
    if (isTv) {
      app.querySelector("#kSeasons").onclick = (e) => {
        const b = e.target.closest("[data-s]"); if (!b) return;
        app.querySelectorAll("#kSeasons .chip").forEach((c) => c.classList.toggle("on", c === b));
        curE = 1; drawEps(+b.dataset.s); play(+b.dataset.s, 1);
      };
      app.querySelector("#kEps").onclick = (e) => {
        const a = e.target.closest("[data-e]"); if (!a) return; e.preventDefault();
        curE = +a.dataset.e;
        app.querySelectorAll("#kEps .ep").forEach((c) => c.classList.toggle("cur", c === a));
        play(curS, curE);
      };
    }
  }

  window.Kino = { home, detail, ROUTES: ["kino", "movie", "tv"] };
})();
