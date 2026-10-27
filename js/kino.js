// Режим «Киноман»: фильмы и сериалы (данные TMDB через наш Worker). Аккаунт и библиотека общие с аниме.
(function () {
  const cfg = window.APP_CONFIG || {};
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // у шлюза два адреса (свой домен и workers.dev): работает не всегда оба, запоминаем тот, что ответил
  const bases = () => {
    const a = [cfg.WORKER_URL, cfg.WORKER_FALLBACK].filter((x) => /^https:\/\//.test(x || ""));
    let pref = ""; try { pref = localStorage.getItem("tsukimi:wbase") || ""; } catch (e) {}
    return pref && a.includes(pref) ? [pref, ...a.filter((x) => x !== pref)] : a;
  };
  const baseNow = () => bases()[0] || "";
  const img = (size, path) => baseNow() + "?img=/" + size + path;
  const mem = new Map();

  // запрос к шлюзу: по очереди пробуем оба адреса, у каждого ограничение по времени
  async function gate(query, timeoutMs) {
    const list = bases();
    if (!list.length) throw new Error("Шлюз не настроен");
    let lastErr;
    for (let i = 0; i < list.length; i++) {
      const base = list[i];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs || 9000);
      try {
        const r = await fetch(base + "?" + query, { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.status === 501) throw new Error("not_configured");
        if (r.status >= 500 && i < list.length - 1) { lastErr = new Error("Ошибка сервера (" + r.status + ")"); continue; }
        try { localStorage.setItem("tsukimi:wbase", base); } catch (e) {}
        return r;
      } catch (e) {
        clearTimeout(timer);
        if (e.message === "not_configured") throw e;
        lastErr = e.name === "AbortError" ? new Error("Каталог не отвечает: соединение с сервером зависло (таймаут)") : new Error("Нет связи с сервером каталога (" + (e.message || "ошибка сети") + ")");
      }
    }
    throw lastErr;
  }

  async function tmdb(path) {
    if (mem.has(path)) return mem.get(path);
    const r = await gate("tmdb=" + encodeURIComponent(path), 9000);
    if (!r.ok) throw new Error("Не удалось загрузить каталог (" + r.status + ")");
    const j = await r.json();
    mem.set(path, j);
    return j;
  }

  const L = "language=ru-RU";
  const KSTATUS = { watching: "Смотрю", planned: "В планах", completed: "Просмотрено", dropped: "Брошено" };
  // постер из строки библиотеки: "tmdb:/abc.jpg" -> адрес через наш воркер
  const posterUrl = (r) => (r && r.poster ? (String(r.poster).startsWith("tmdb:") ? img("w342", String(r.poster).slice(5)) : r.poster) : "");
  const libHref = (r) => { const k = window.Store.kparse(r.anime_id); return `#/${k.type}/${k.id}`; };
  function lcard(r, sub) {
    const k = window.Store.kparse(r.anime_id);
    return `<a class="card" href="#/${k.type}/${k.id}"><div class="poster">${r.poster ? `<img src="${esc(posterUrl(r))}" alt="" loading="lazy">` : ""}
      ${r.score ? `<span class="score">${(r.score / 10).toFixed(1)}</span>` : ""}${r.liked ? `<span class="heart">♥</span>` : ""}</div>
      <div class="name">${esc(r.title)}</div><div class="sub">${esc(sub || (k.type === "tv" ? "Сериал" : "Фильм"))}</div></a>`;
  }
  const epLabel = (h) => (h.anime_id >= 2 * 10000000 ? `Сезон ${Math.floor(h.episode / 1000)}, серия ${h.episode % 1000}` : "Фильм");
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
    const rows = [
      ["В тренде", `/trending/all/week?${L}`, "movie", true, 18],
      ["Сейчас в кино", `/movie/now_playing?${L}&region=RU`, "movie"],
      ["Сериалы в эфире", `/tv/on_the_air?${L}`, "tv"],
      ["Лучшие фильмы", `/movie/top_rated?${L}`, "movie"],
      ["Лучшие сериалы", `/tv/top_rated?${L}`, "tv"],
    ];
    const sk = () => `<div class="row">${Array.from({ length: 6 }, () => `<div class="card sk"><div class="poster"></div><div class="name"></div><div class="sub"></div></div>`).join("")}</div>`;
    app.innerHTML = `<div id="kHero"></div><div class="wrap"><div id="kMine"></div><div id="kRecs"></div><div id="kFriends"></div>${rows.map((r, i) => `<div id="kr${i}">${section(r[0], sk())}</div>`).join("")}</div>`;
    let failed = 0;
    const fail = (i, e) => {
      failed++;
      const box = app.querySelector("#kr" + i);
      if (!box) return;
      box.innerHTML = e.message === "not_configured"
        ? section(rows[i][0], `<div class="empty">Каталог фильмов ещё подключается. Загляни чуть позже.</div>`)
        : section(rows[i][0], `<div class="empty">${esc(e.message)}<br><button class="btn" type="button" data-retry="${i}" style="margin-top:12px">Повторить</button></div>`);
    };
    const load = async (i) => {
      const [name, path, def, ranked, n] = rows[i];
      const box = app.querySelector("#kr" + i);
      if (box) box.innerHTML = section(name, sk());
      try {
        const j = await tmdb(path);
        if (!app.querySelector("#kr" + i)) return; // ушли с главной
        const list = (j.results || []).filter((m) => m.poster_path);
        app.querySelector("#kr" + i).innerHTML = list.length ? section(name, rowOf(n ? list.slice(0, n) : list, def, ranked)) : "";
        if (i === 0) hero(j);
      } catch (e) { fail(i, e); }
    };
    const hero = (trend) => {
      const m = (trend.results || []).filter((x) => x.backdrop_path)[0];
      const el = app.querySelector("#kHero");
      if (!m || !el) return;
      el.innerHTML = `<div class="kino-hero" style="background-image:url('${img("w1280", m.backdrop_path)}')"><div class="kino-hero-in wrap">
        <span class="hero-tag">В тренде</span><h1>${esc(title(m))}</h1>
        <p>${esc((m.overview || "").slice(0, 220))}${(m.overview || "").length > 220 ? "…" : ""}</p>
        <a class="btn primary" href="#/${m.media_type === "tv" ? "tv" : "movie"}/${m.id}">Открыть</a></div></div>`;
    };
    app.onclick = (e) => { const b = e.target.closest("[data-retry]"); if (b) load(+b.dataset.retry); };
    // первым грузим «В тренде» (он же даёт обложку), остальные ряды параллельно, но каждый сам по себе
    rows.forEach((_, i) => load(i));
    personal(app);
  }

  // личные блоки на главной: продолжить, в планах, рекомендации по лайкам, что смотрят друзья
  async function personal(app) {
    const St = window.Store;
    if (!St || !St.user) return;
    const all = St.kinoAll(), hist = St.kinoHistory();
    const mine = app.querySelector("#kMine");
    if (mine) {
      const seen = new Set(), cont = [];
      hist.forEach((hh) => { if (!seen.has(hh.anime_id) && (St.get(hh.anime_id) || {}).status !== "completed") { seen.add(hh.anime_id); cont.push(hh); } });
      let html = "";
      if (cont.length) html += section("Продолжить просмотр", `<div class="row">${cont.slice(0, 14).map((hh) => lcard({ ...(St.get(hh.anime_id) || {}), anime_id: hh.anime_id, title: hh.title, poster: hh.poster, liked: (St.get(hh.anime_id) || {}).liked }, epLabel(hh))).join("")}</div>`);
      const planned = all.filter((r) => r.status === "planned").sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
      if (planned.length) html += section("В планах", `<div class="row">${planned.slice(0, 14).map((r) => lcard(r)).join("")}</div>`);
      mine.outerHTML = html;
    }
    // рекомендации: похожее на то, что понравилось или просмотрено
    try {
      const base = all.filter((r) => r.liked || r.status === "completed").sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 2);
      const box = app.querySelector("#kRecs");
      if (box && base.length) {
        const lists = await Promise.all(base.map((r) => { const k = St.kparse(r.anime_id); return tmdb(`/${k.type}/${k.id}/recommendations?${L}`).then((j) => (j.results || []).map((x) => ({ ...x, media_type: k.type }))).catch(() => []); }));
        const have = new Set(all.map((r) => r.anime_id));
        const seen = new Set(), out = [];
        for (let i = 0; out.length < 18 && i < 20; i++) lists.forEach((l) => { const x = l[i]; if (x && x.poster_path && !seen.has(x.media_type + x.id) && !have.has(St.kid(x.media_type, x.id))) { seen.add(x.media_type + x.id); out.push(x); } });
        if (out.length) box.outerHTML = section("Рекомендуем тебе", rowOf(out, "movie"));
      }
    } catch (e) {}
    try {
      const fs = await St.friendships();
      const box = app.querySelector("#kFriends");
      if (box && fs.ready && fs.friends.length) {
        const rows = await St.friends(fs.friends.map((f) => f.id), true);
        const items = rows.filter((r) => r.liked || r.status).slice(0, 12);
        if (items.length) box.outerHTML = section("Что смотрят друзья", `<div class="row">${items.map((r) => lcard(r, r.friend + (r.liked ? " ♥" : KSTATUS[r.status] ? ": " + KSTATUS[r.status].toLowerCase() : ""))).join("")}</div>`);
      }
    } catch (e) {}
  }

  // ---------- библиотека фильмов ----------
  function library(app, params) {
    const St = window.Store;
    if (!St.user) { location.hash = "#/login"; return; }
    const tab = params.get("tab") || "liked";
    const all = St.kinoAll(), hist = St.kinoHistory();
    const tabs = [["liked", "Нравится"], ...Object.entries(KSTATUS), ["history", "История"]];
    const count = (k) => (k === "history" ? hist.length : all.filter((r) => (k === "liked" ? r.liked : r.status === k)).length);
    const stag = (html, i) => html.replace('<a class="card"', `<a class="card in" style="--i:${Math.min(i, 20)}"`);
    const fmt = (iso) => { try { return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
    const empty = { liked: "Нажми «♡ Нравится» на странице фильма, и он появится здесь.", watching: "Здесь будет то, что ты смотришь. Нажмёшь «Смотреть», и фильм добавится сам.", planned: "Выбери «В планах» на странице фильма или сериала.", completed: "Отметь уже просмотренное, и по нему подберутся рекомендации.", dropped: "Пока ничего не брошено.", history: "Открытые фильмы и серии появятся здесь." };
    let body = "";
    if (tab === "history") {
      body = hist.length ? `<div class="grid lib-grid">${hist.map((hh, i) => stag(lcard({ ...(St.get(hh.anime_id) || {}), anime_id: hh.anime_id, title: hh.title, poster: hh.poster }, epLabel(hh) + " · " + fmt(hh.watched_at)), i)).join("")}</div>` : "";
    } else {
      const list = all.filter((r) => (tab === "liked" ? r.liked : r.status === tab)).sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
      body = list.length ? `<div class="grid lib-grid">${list.map((r, i) => stag(lcard(r), i)).join("")}</div>` : "";
    }
    if (!body) body = `<div class="lib-empty"><div class="moon"></div><p>${esc(empty[tab] || "Пока пусто.")}</p><div class="actions" style="justify-content:center"><a class="btn primary" href="#/kfind">Открыть каталог</a></div></div>`;
    app.innerHTML = `<div class="wrap lib"><div class="lib-head"><h1>Моё кино</h1>
      <div class="lib-stats"><span><b>${all.filter((r) => r.status || r.liked).length}</b> в библиотеке</span><span><b>${all.filter((r) => r.status === "completed").length}</b> просмотрено</span><span><b>${all.filter((r) => r.liked).length}</b> нравится</span></div></div>
      <div class="lib-tabs" role="tablist">${tabs.map(([k, v]) => `<a role="tab" class="${k === tab ? "on" : ""}" href="#/klib?tab=${k}">${v}<em>${count(k)}</em></a>`).join("")}</div>
      <div class="lib-body">${body}</div></div>`;
  }

  const STATUS_TV = { "Returning Series": "Выходит", Ended: "Завершён", Canceled: "Отменён", "In Production": "В производстве", Planned: "Анонс" };

  async function detail(app, type, id) {
    if (!/^\d{1,9}$/.test(String(id || ""))) { app.innerHTML = `<div class="wrap"><div class="empty">Такой страницы нет. <a href="#/kino">В Киноман</a></div></div>`; return; }
    app.innerHTML = `<div class="loading">Загружаю…</div>`;
    let m;
    try { m = await tmdb(`/${type}/${id}?${L}&append_to_response=external_ids,credits,recommendations,videos&include_video_language=ru,en,null`); }
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
    const vids = ((m.videos && m.videos.results) || []).filter((v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"));
    vids.sort((a, b) => (b.iso_639_1 === "ru") - (a.iso_639_1 === "ru") || (b.type === "Trailer") - (a.type === "Trailer") || (b.official ? 1 : 0) - (a.official ? 1 : 0));
    const trailer = vids[0] || null;
    const item = { type, id: m.id, title: ttl, poster_path: m.poster_path, genres: (m.genres || []).map((g) => g.name), score: m.vote_average };
    const lib = (window.Store && window.Store.user && window.Store.get(window.Store.kid(type, m.id))) || {};
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
          <div class="actions">
            <button type="button" class="btn primary" id="kPlay">Смотреть</button>
            ${trailer ? `<button type="button" class="btn" id="kTrailerBtn">▶ Трейлер</button>` : ""}
            <button type="button" class="btn ${lib.liked ? "liked" : ""}" id="kLike">${lib.liked ? "♥ Нравится" : "♡ Нравится"}</button>
            <select class="select" id="kStatus" aria-label="Статус"><option value="">Не в списке</option>${Object.entries(KSTATUS).map(([k, v]) => `<option value="${k}" ${lib.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
          </div>
          <div id="kTrailer"></div>
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
      const q = ids.imdb_id ? "imdb=" + ids.imdb_id : "";
      if (!q) throw new Error("Для этого " + (isTv ? "сериала" : "фильма") + " пока нет данных для поиска плеера (слишком свежий релиз).");
      const r = await gate(q, 15000);
      if (!r.ok) throw new Error("Плеер для этого " + (isTv ? "сериала" : "фильма") + " не нашёлся. Возможно, его нет в источнике.");
      urlCache = (await r.json()).url;
      return urlCache;
    }
    async function play(season, episode) {
      box.innerHTML = `<div class="loading">Ищу плеер…</div>`;
      const St = window.Store;
      if (St && St.user) {
        St.addHistoryKino(item, season, episode).catch(() => {});
        if (!St.get(St.kid(type, m.id)) || !St.get(St.kid(type, m.id)).status) {
          St.saveKino(item, { status: "watching" }).then(() => { const sel = app.querySelector("#kStatus"); if (sel) sel.value = "watching"; }).catch(() => {});
        }
      }
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
    const needLogin = () => { window.toast && window.toast("Сначала войди"); location.hash = "#/login"; };
    app.querySelector("#kLike").onclick = async () => {
      const St = window.Store;
      if (!St || !St.user) return needLogin();
      const liked = !(St.get(St.kid(type, m.id)) || {}).liked;
      await St.saveKino(item, { liked }).catch((e) => window.toast && window.toast(e.message));
      const b = app.querySelector("#kLike");
      b.className = "btn" + (liked ? " liked" : "");
      b.textContent = liked ? "♥ Нравится" : "♡ Нравится";
    };
    app.querySelector("#kStatus").onchange = async (e) => {
      const St = window.Store;
      if (!St || !St.user) { e.target.value = ""; return needLogin(); }
      await St.saveKino(item, { status: e.target.value || null }).catch((err) => window.toast && window.toast(err.message));
      window.toast && window.toast("Сохранено");
    };
    const tb = app.querySelector("#kTrailerBtn");
    if (tb) tb.onclick = () => {
      const box2 = app.querySelector("#kTrailer");
      if (box2.firstChild) { box2.innerHTML = ""; tb.textContent = "▶ Трейлер"; return; }
      tb.textContent = "✕ Трейлер";
      box2.innerHTML = `<div class="player-wrap kino-player" style="margin-top:18px"><iframe src="https://www.youtube-nocookie.com/embed/${esc(trailer.key)}?rel=0" allowfullscreen allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px;background:#000"></iframe></div><div class="muted" style="margin-top:8px;font-size:13px">Трейлер идёт с YouTube: без VPN у некоторых провайдеров может не загрузиться. <a href="https://www.youtube.com/watch?v=${esc(trailer.key)}" target="_blank" rel="noopener">Открыть на YouTube</a></div>`;
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

  window.Kino = { home, detail, find, suggest, library, posterUrl, libHref, ROUTES: ["kino", "movie", "tv", "kfind", "klib"] };
})();
