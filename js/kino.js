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
    const r = await fetch(w + (w.includes("?") ? "&" : "?") + "tmdb=" + encodeURIComponent(path));
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
    async function play(season, episode) {
      box.innerHTML = `<div class="loading">Ищу плеер…</div>`;
      try {
        let src = await getUrl();
        if (isTv) src += (src.includes("?") ? "&" : "?") + "season=" + season + "&episode=" + episode;
        box.innerHTML = `<iframe src="${esc(src)}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="origin" style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px;background:#000"></iframe>`;
      } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
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

  // ---------- поиск и каталог ----------
  const GENRES = {
    movie: [[28, "Боевик"], [12, "Приключения"], [16, "Мультфильм"], [35, "Комедия"], [80, "Криминал"], [99, "Документальный"], [18, "Драма"], [10751, "Семейный"], [14, "Фэнтези"], [36, "История"], [27, "Ужасы"], [10402, "Музыка"], [9648, "Детектив"], [10749, "Мелодрама"], [878, "Фантастика"], [53, "Триллер"], [10752, "Военный"], [37, "Вестерн"]],
    tv: [[10759, "Боевик и приключения"], [16, "Мультсериал"], [35, "Комедия"], [80, "Криминал"], [99, "Документальный"], [18, "Драма"], [10751, "Семейный"], [10762, "Детский"], [9648, "Детектив"], [10765, "Фантастика и фэнтези"], [10768, "Война и политика"], [10764, "Реалити"], [37, "Вестерн"]],
  };
  const today = () => new Date().toISOString().slice(0, 10);

  async function find(app, params) {
    const st = { q: params.get("q") || "", type: params.get("type") === "tv" ? "tv" : "movie", genre: params.get("genre") || "", sort: params.get("sort") || "", year: params.get("year") || "", page: 1 };
    app.innerHTML = `<div class="wrap cat">
      <div class="cat-head"><h1>Каталог</h1><p class="muted">Фильмы и сериалы со всего мира. Ищи по названию или подбирай по жанру и году.</p></div>
      <div class="kf-tabs" id="kfType"><button type="button" data-t="movie">Фильмы</button><button type="button" data-t="tv">Сериалы</button></div>
      <form class="filters" id="kf" autocomplete="off">
        <label class="f-search"><input type="search" name="q" placeholder="Название фильма или сериала" value="${esc(st.q)}" aria-label="Название"></label>
        <select class="select" name="sort" aria-label="Сортировка">
          <option value="">Популярные</option><option value="vote_average.desc">По оценке</option><option value="date">Новые</option>
        </select>
        <input type="number" name="year" placeholder="Год" min="1900" max="2100" value="${esc(st.year)}" aria-label="Год">
        <button class="btn" type="button" id="kfReset">Сбросить</button>
      </form>
      <div class="chips genre-row" id="kfGenres"></div>
      <div id="kfRes"></div></div>`;
    const res = app.querySelector("#kfRes"), input = app.querySelector("input[name=q]"), sel = app.querySelector("select[name=sort]");
    sel.value = st.sort;
    let seq = 0, timer = null;
    const skel = () => `<div class="grid">${Array.from({ length: 12 }, () => `<div class="card sk"><div class="poster"></div><div class="name"></div><div class="sub"></div></div>`).join("")}</div>`;
    const drawTabs = () => app.querySelectorAll("#kfType button").forEach((b) => b.classList.toggle("on", b.dataset.t === st.type));
    const drawGenres = () => {
      app.querySelector("#kfGenres").innerHTML = GENRES[st.type].map(([id, n]) => `<button type="button" class="chip ${String(id) === st.genre ? "on" : ""}" data-g="${id}">${esc(n)}</button>`).join("");
    };
    const sync = () => {
      const p = new URLSearchParams();
      Object.entries({ q: st.q, type: st.type === "tv" ? "tv" : "", genre: st.genre, sort: st.sort, year: st.year }).forEach(([k, v]) => v && p.set(k, v));
      history.replaceState(null, "", "#/kfind" + (p.toString() ? "?" + p : ""));
    };
    const url = () => {
      const t = st.type, yp = t === "tv" ? "first_air_date_year" : "year";
      if (st.q) return `/search/${t}?${L}&query=${encodeURIComponent(st.q)}&page=${st.page}&include_adult=false${st.year ? `&${yp}=${encodeURIComponent(st.year)}` : ""}`;
      const dk = t === "tv" ? "first_air_date" : "primary_release_date";
      let u = `/discover/${t}?${L}&page=${st.page}&include_adult=false&sort_by=`;
      if (st.sort === "vote_average.desc") u += `vote_average.desc&vote_count.gte=400`;
      else if (st.sort === "date") u += `${dk}.desc&${dk}.lte=${today()}&vote_count.gte=20`;
      else u += `popularity.desc`;
      if (st.genre) u += `&with_genres=${st.genre}`;
      if (st.year) u += `&${t === "tv" ? "first_air_date_year" : "primary_release_year"}=${encodeURIComponent(st.year)}`;
      return u;
    };
    async function run(append) {
      const my = ++seq;
      if (!append) res.innerHTML = skel();
      let r;
      try { r = await tmdb(url()); } catch (e) {
        if (my !== seq) return;
        res.innerHTML = `<div class="empty">${e.message === "not_configured" ? "Каталог ещё подключается." : esc(e.message)}</div>`; return;
      }
      if (my !== seq) return;
      let items = (r.results || []).filter((m) => m.poster_path || m.backdrop_path);
      if (st.q && st.genre) items = items.filter((m) => (m.genre_ids || []).includes(+st.genre));
      const html = items.map((m, i) => card(m, st.type).replace('<a class="card"', `<a class="card in" style="--i:${Math.min(i, 20)}"`)).join("");
      const more = r.page < Math.min(r.total_pages || 1, 25);
      if (append) {
        res.querySelector(".more") && res.querySelector(".more").remove();
        res.querySelector(".grid").insertAdjacentHTML("beforeend", html);
      } else if (!items.length) { res.innerHTML = `<div class="empty">Ничего не нашлось. Попробуй часть названия или сними фильтры.</div>`; return; }
      else res.innerHTML = `<div class="grid">${html}</div>`;
      if (more) {
        res.insertAdjacentHTML("beforeend", `<button class="btn more" type="button">Показать ещё</button>`);
        res.querySelector(".more").onclick = () => { st.page++; run(true); };
      }
    }
    const change = (delay) => { st.page = 1; sync(); clearTimeout(timer); timer = setTimeout(() => run(false), delay || 0); };
    app.querySelector("#kf").onsubmit = (e) => e.preventDefault();
    input.addEventListener("input", () => { st.q = input.value.trim(); sel.disabled = !!st.q; change(st.q ? 280 : 0); });
    sel.onchange = () => { st.sort = sel.value; change(0); };
    app.querySelector("input[name=year]").addEventListener("input", (e) => { st.year = e.target.value; change(400); });
    app.querySelector("#kfType").onclick = (e) => {
      const b = e.target.closest("[data-t]"); if (!b || b.dataset.t === st.type) return;
      st.type = b.dataset.t; st.genre = ""; drawTabs(); drawGenres(); change(0);
    };
    app.querySelector("#kfGenres").onclick = (e) => {
      const b = e.target.closest("[data-g]"); if (!b) return;
      st.genre = st.genre === b.dataset.g ? "" : b.dataset.g;
      drawGenres(); change(0);
    };
    app.querySelector("#kfReset").onclick = () => {
      st.q = st.genre = st.sort = st.year = ""; input.value = ""; sel.value = ""; sel.disabled = false;
      app.querySelector("input[name=year]").value = ""; drawGenres(); change(0);
    };
    sel.disabled = !!st.q;
    drawTabs(); drawGenres(); run(false);
  }

  // подсказки в строке поиска в шапке
  async function suggest(q) {
    const r = await tmdb(`/search/multi?${L}&query=${encodeURIComponent(q)}&page=1&include_adult=false`);
    return (r.results || []).filter((m) => (m.media_type === "movie" || m.media_type === "tv") && m.poster_path).slice(0, 8).map((m) => ({
      href: `#/${m.media_type}/${m.id}`, img: img("w92", m.poster_path), title: title(m),
      sub: [year(m), m.media_type === "tv" ? "Сериал" : "Фильм", m.vote_average ? "★ " + m.vote_average.toFixed(1) : ""].filter(Boolean).join(" · "),
    }));
  }

  window.Kino = { home, detail, find, suggest, ROUTES: ["kino", "movie", "tv", "kfind"] };
})();
