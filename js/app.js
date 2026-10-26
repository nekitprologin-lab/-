// Страницы и роутинг. Адреса вида #/anime/123, #/watch/123/4, #/search?q=...
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  const cfg = window.APP_CONFIG;
  const { Api, Store } = window;

  document.title = cfg.SITE_NAME;
  $("#logo").textContent = cfg.SITE_NAME;

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STATUS = { watching: "Смотрю", planned: "В планах", completed: "Просмотрено", dropped: "Брошено" };
  const STATUS_FORMAT = { TV: "ТВ", MOVIE: "Фильм", OVA: "OVA", ONA: "ONA", SPECIAL: "Спешл", TV_SHORT: "ТВ-короткий", MUSIC: "Клип" };
  const AIRING = { RELEASING: "Выходит", FINISHED: "Завершён", NOT_YET_RELEASED: "Анонс", CANCELLED: "Отменён", HIATUS: "Пауза" };

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- карточки ----------
  function card(m) {
    const lib = Store.get(m.id);
    const total = m.episodes || 0;
    const pct = lib && lib.episode && total ? Math.min(100, Math.round((lib.episode / total) * 100)) : 0;
    const poster = m.coverImage && m.coverImage.large;
    const sub = [m.seasonYear, STATUS_FORMAT[m.format]].filter(Boolean).join(", ");
    return `<a class="card" href="#/anime/${m.id}">
      <div class="poster" style="background:${esc((m.coverImage && m.coverImage.color) || "var(--panel)")}">
        ${poster ? `<img src="${esc(poster)}" alt="" loading="lazy">` : ""}
        ${m.averageScore ? `<span class="score">${(m.averageScore / 10).toFixed(1)}</span>` : ""}
        ${lib && lib.liked ? `<span class="heart" title="Нравится">♥</span>` : ""}
        ${pct ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ""}
      </div>
      <div class="name" data-mal="${esc(m.idMal || "")}">${esc(Api.title(m))}</div>
      <div class="sub">${esc(sub)}</div>
    </a>`;
  }

  // карточка из строки библиотеки (там уже есть название и постер, запрос к API не нужен)
  function libCard(r, extra) {
    const pct = r.episode && r.episodes ? Math.min(100, Math.round((r.episode / r.episodes) * 100)) : 0;
    return `<a class="card" href="#/anime/${r.anime_id}">
      <div class="poster">
        ${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy">` : ""}
        ${r.score ? `<span class="score">${(r.score / 10).toFixed(1)}</span>` : ""}
        ${r.liked ? `<span class="heart">♥</span>` : ""}
        ${pct ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ""}
      </div>
      <div class="name" data-mal="${esc(r.mal_id || "")}">${esc(r.title)}</div>
      <div class="sub">${esc(extra || "")}</div>
    </a>`;
  }

  const section = (title, body, right = "") =>
    `<section class="section"><div class="section-head"><h2>${esc(title)}</h2>${right}</div>${body}</section>`;

  const loading = (t = "Загружаю…") => (app.innerHTML = `<div class="loading">${t}</div>`);
  const fail = (e) =>
    (app.innerHTML = `<div class="wrap"><div class="empty">Не получилось загрузить данные: ${esc(e.message || e)}.<br>Проверь интернет и <a href="javascript:location.reload()">обнови страницу</a>.</div></div>`);

  // ---------- рекомендации ----------
  // Вес жанра: лайк +3, просмотрено +2, смотрю +1, брошено -2. Берём топ-жанры, ищем популярное в них,
  // добавляем «похожее» от AniList для двух последних лайков и ранжируем по совпадению жанров и оценке.
  async function recommend() {
    const lib = Store.all();
    const weights = {};
    lib.forEach((r) => {
      const w = (r.liked ? 3 : 0) + (r.status === "completed" ? 2 : 0) + (r.status === "watching" ? 1 : 0) - (r.status === "dropped" ? 2 : 0);
      if (w) (r.genres || []).forEach((g) => (weights[g] = (weights[g] || 0) + w));
    });
    const top = Object.entries(weights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (!top.length) return [];

    const seen = new Set(lib.map((r) => r.anime_id));
    const recentLikes = lib.filter((r) => r.liked).sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 2);

    const [byGenre, similar] = await Promise.all([
      Promise.all(top.map(([g]) => Api.byGenre(g))),
      Promise.all(recentLikes.map((r) => Api.detail(r.anime_id).catch(() => null))),
    ]);

    const pool = new Map();
    byGenre.flat().forEach((m) => pool.set(m.id, { m, bonus: 0 }));
    similar.forEach((d) => {
      if (!d) return;
      d.recommendations.nodes.forEach((n) => {
        const m = n.mediaRecommendation;
        if (!m) return;
        const e = pool.get(m.id) || { m, bonus: 0 };
        e.bonus += 5;
        pool.set(m.id, e);
      });
    });

    return [...pool.values()]
      .filter((e) => !seen.has(e.m.id))
      .map((e) => ({
        m: e.m,
        s: (e.m.genres || []).reduce((a, g) => a + (weights[g] || 0), 0) + e.bonus + (e.m.averageScore || 0) / 20,
      }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 18)
      .map((e) => e.m);
  }

  // ---------- страницы ----------
  async function pageHome() {
    loading();
    const [trending, season] = await Promise.all([Api.trending(18), Api.thisSeason(18)]);
    const hero = trending.find((m) => m.bannerImage) || trending[0];
    const lib = Store.all();

    let html = "";
    if (hero) {
      html += `<div class="hero" style="background-image:url('${esc(hero.bannerImage || (hero.coverImage && hero.coverImage.large))}')">
        <div>
          <h1>${esc(Api.title(hero))}</h1>
          <div class="meta"><span><b>${hero.averageScore ? (hero.averageScore / 10).toFixed(1) : "—"}</b> оценка</span>
          <span>${esc((hero.genres || []).slice(0, 3).map(Api.genreRu).join(", "))}</span></div>
          <p></p>
          <a class="btn primary" href="#/anime/${hero.id}">Открыть</a>
        </div></div>`;
    }
    html += `<div class="wrap">`;

    const cont = lib.filter((r) => r.episode && r.status !== "completed").sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 12);
    if (cont.length)
      html += section("Продолжить просмотр", `<div class="row">${cont.map((r) => libCard(r, "Серия " + r.episode)).join("")}</div>`);

    html += `<div id="recs"></div><div id="friendsBlock"></div>`;
    html += section("В тренде", `<div class="row">${trending.map(card).join("")}</div>`);
    html += section("Этот сезон", `<div class="row">${season.map(card).join("")}</div>`);
    if (!Store.user)
      html += `<div class="empty" style="margin-top:40px"><a href="#/login">Войди</a>, чтобы сохранять лайки и историю и получать рекомендации.</div>`;
    html += `</div>`;
    app.innerHTML = html;

    // описание героя (убираем html-теги из ответа API)
    if (hero) {
      Api.detail(hero.id).then((d) => {
        const p = $(".hero p");
        if (!p || !d) return;
        const en = (d.description || "").replace(/<[^>]*>/g, "");
        p.textContent = en;
        // в шапке влезает три строки: переводим только начало, это быстрее
        const head = en.length > 420 ? en.slice(0, 420).replace(/[^.!?…]*$/, "") || en.slice(0, 420) : en;
        Api.translate(head, "h" + d.id).then((ru) => { if (ru && $(".hero p")) $(".hero p").textContent = ru; });
      }).catch(() => {});
    }

    // рекомендации и друзья догружаются отдельно, чтобы не задерживать страницу
    if (Store.user) {
      recommend().then((list) => {
        const box = $("#recs");
        if (box && list.length) box.outerHTML = section("Рекомендуем тебе", `<div class="row">${list.map(card).join("")}</div>`);
        else if (box && !list.length && Store.all().length < 3)
          box.outerHTML = `<div class="empty" style="margin-top:40px">Поставь ♥ нескольким аниме — и здесь появятся рекомендации под твой вкус.</div>`;
      }).catch(() => {});
      Store.friends().then((rows) => {
        const box = $("#friendsBlock");
        if (!box || !rows.length) return;
        const items = rows.filter((r) => r.episode).slice(0, 8);
        if (items.length)
          box.outerHTML = section("Что смотрят друзья", `<div class="row">${items.map((r) => libCard(r, `${r.friend}: серия ${r.episode}`)).join("")}</div>`);
      }).catch(() => {});
    }
  }

  async function pageSearch(params) {
    const state = {
      q: params.get("q") || "",
      genre: params.get("genre") || "",
      sort: params.get("sort") || "",
      year: params.get("year") || "",
      page: 1,
    };
    app.innerHTML = `<div class="wrap">
      <h1 style="font-size:26px">Каталог</h1>
      <form class="filters" id="f">
        <input type="search" name="q" placeholder="Название" value="${esc(state.q)}">
        <select class="select" name="sort" aria-label="Сортировка">
          <option value="">${state.q ? "По совпадению" : "По популярности"}</option>
          <option value="SCORE_DESC">По оценке</option>
          <option value="TRENDING_DESC">В тренде</option>
          <option value="START_DATE_DESC">Сначала новые</option>
        </select>
        <input type="number" name="year" placeholder="Год" min="1960" max="2100" value="${esc(state.year)}">
        <button class="btn" type="submit">Найти</button>
      </form>
      <div class="chips" id="genres">${Api.GENRES.map((g) => `<button type="button" class="chip ${g === state.genre ? "on" : ""}" data-genre="${esc(g)}">${esc(Api.genreRu(g))}</button>`).join("")}</div>
      <div id="results" style="margin-top:24px"><div class="loading">Ищу…</div></div>
    </div>`;
    $("select[name=sort]").value = state.sort;

    const results = $("#results");
    async function run(append) {
      try {
        const r = await Api.search({ q: state.q, genres: state.genre ? [state.genre] : [], year: state.year ? Number(state.year) : null, sort: state.sort, page: state.page });
        if (!append) results.innerHTML = r.items.length ? `<div class="grid"></div>` : `<div class="empty">Ничего не найдено. Попробуй другое название или сними фильтры.</div>`;
        const grid = $(".grid", results);
        if (grid) grid.insertAdjacentHTML("beforeend", r.items.map(card).join(""));
        const old = $(".more", results);
        if (old) old.remove();
        if (r.hasNext && grid) {
          results.insertAdjacentHTML("beforeend", `<button class="btn more">Показать ещё</button>`);
          $(".more", results).onclick = () => { state.page++; run(true); };
        }
      } catch (e) {
        results.innerHTML = `<div class="empty">Не получилось загрузить: ${esc(e.message)}</div>`;
      }
    }

    const go = () => {
      const p = new URLSearchParams();
      Object.entries({ q: state.q, genre: state.genre, sort: state.sort, year: state.year }).forEach(([k, v]) => v && p.set(k, v));
      location.hash = "#/search" + (p.toString() ? "?" + p : "");
    };
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.q = fd.get("q").trim(); state.sort = fd.get("sort"); state.year = fd.get("year");
      go();
    };
    $("#genres").onclick = (e) => {
      const b = e.target.closest("[data-genre]");
      if (!b) return;
      state.genre = state.genre === b.dataset.genre ? "" : b.dataset.genre;
      go();
    };
    run(false);
  }

  async function pageAnime(id) {
    loading();
    const m = await Api.detail(id);
    if (!m) return fail("Аниме не найдено");
    const lib = Store.get(m.id) || {};
    const total = m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : 0);
    const cur = lib.episode || 0;
    const studio = m.studios && m.studios.nodes[0] && m.studios.nodes[0].name;
    const relations = (m.relations.edges || []).filter((e) => e.node.type === "ANIME").slice(0, 8);
    const recs = (m.recommendations.nodes || []).map((n) => n.mediaRecommendation).filter(Boolean);
    const banner = m.bannerImage || (m.coverImage && m.coverImage.large);
    const startEp = cur ? cur : 1;

    let epsHtml = "";
    for (let i = 1; i <= Math.min(total, 500); i++)
      epsHtml += `<a class="ep ${i === cur ? "cur" : i < cur ? "done" : ""}" href="#/watch/${m.id}/${i}">${i}</a>`;

    app.innerHTML = `<div class="detail">
      <div class="detail-banner" style="background-image:url('${esc(banner)}')"></div>
      <div class="wrap detail-body">
        <img class="cover" src="${esc(m.coverImage && m.coverImage.large)}" alt="">
        <div>
          <h1 id="h1">${esc(Api.title(m))}</h1>
          <div class="alt" id="ru">${esc([Api.altTitle(m), m.title.romaji].filter((x, i, a) => x && x !== Api.title(m) && a.indexOf(x) === i).join(" · "))}</div>
          <div class="meta">
            ${m.averageScore ? `<span><b>${(m.averageScore / 10).toFixed(1)}</b> оценка</span>` : ""}
            ${m.seasonYear ? `<span>${m.seasonYear}</span>` : ""}
            ${m.format ? `<span>${esc(STATUS_FORMAT[m.format] || m.format)}</span>` : ""}
            ${m.episodes ? `<span>${m.episodes} эп.</span>` : ""}
            ${m.status ? `<span>${esc(AIRING[m.status] || m.status)}</span>` : ""}
            ${studio ? `<span>${esc(studio)}</span>` : ""}
          </div>
          <div class="chips">${(m.genres || []).map((g) => `<a class="chip" href="#/search?genre=${encodeURIComponent(g)}">${esc(Api.genreRu(g))}</a>`).join("")}</div>
          <div class="actions">
            <a class="btn primary" href="#/watch/${m.id}/${startEp}">${cur ? "Продолжить: серия " + cur + ((Pos.get(m.id) && String(Pos.get(m.id).ep) === String(cur) && Pos.get(m.id).t > 10) ? " · " + mmss(Pos.get(m.id).t) : "") : "Смотреть"}</a>
            <button class="btn ${lib.liked ? "liked" : ""}" id="likeBtn">${lib.liked ? "♥ Нравится" : "♡ Нравится"}</button>
            <select class="select" id="statusSel" aria-label="Статус">
              <option value="">Не в списке</option>
              ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${lib.status === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </div>
          <div class="desc" id="desc">${m.description ? '<div class="skel"></div><div class="skel"></div><div class="skel s"></div>' : "Описания пока нет."}</div>
        </div>
      </div>
      <div class="wrap" style="padding-top:0">
        <div id="seasons"></div>
        ${total ? section("Серии",`<div class="eps">${epsHtml}</div>`) : ""}
        ${relations.length ? section("Связанное", `<div class="row">${relations.map((e) => card({ ...e.node, genres: [], averageScore: null, episodes: null })).join("")}</div>`) : ""}
        ${recs.length ? section("Похожее", `<div class="row">${recs.map(card).join("")}</div>`) : ""}
      </div>
    </div>`;

    // сезоны: показываем только если у франшизы больше одного сериала (фильмам и одиночным тайтлам — ничего)
    if (["TV", "TV_SHORT", "ONA"].includes(m.format)) {
      Api.seasons(m.id).then((list) => {
        const box = $("#seasons");
        if (!box || !list.length) return;
        box.innerHTML = section("Сезоны", `<div class="seasons">${list.map((n, i) =>
          `<a class="season ${n.id === m.id ? "cur" : ""}" href="#/anime/${n.id}"><b>Сезон ${i + 1}</b><span data-mal="${n.idMal || ""}">${esc(Api.title(n))}</span>${n.seasonYear || (n.startDate && n.startDate.year) ? `<small>${n.seasonYear || n.startDate.year}</small>` : ""}</a>`).join("")}</div>`);
      }).catch(() => {});
    }

    // русское название и описание: с Shikimori, если он доступен; иначе описание переводится автоматически
    const showDesc = (text, auto) => {
      const d = $("#desc");
      if (!d) return;
      d.textContent = text;
    };
    // перевод описания стартует сразу, не дожидаясь Shikimori; на экране — заглушка, а не английский текст
    const plain = (m.description || "").replace(/<[^>]*>/g, "");
    let done = false;
    const finish = (text, auto) => { if (done || !$("#desc")) return; done = true; showDesc(text, auto); };
    if (m.description) {
      Api.translate(m.description, "d" + m.id).then((ru) => { if (ru) finish(ru, true); });
      setTimeout(() => finish(plain, false), 4500); // если перевод не пришёл — показываем оригинал
    }
    Api.russian(m.idMal).then((r) => {
      if (!$("#h1") || !r) return;
      if (r.name && $("#ru")) $("#ru").textContent = [r.name, m.title.romaji].filter((x, i, a) => x && x !== Api.title(m) && a.indexOf(x) === i).join(" · ");
      if (r.description) finish(r.description, false);
    });

    const needLogin = () => { toast("Сначала войди"); location.hash = "#/login"; };
    $("#likeBtn").onclick = async () => {
      if (!Store.user) return needLogin();
      const liked = !(Store.get(m.id) || {}).liked;
      await Store.save(m, { liked }).catch((e) => toast(e.message));
      const b = $("#likeBtn");
      b.className = "btn" + (liked ? " liked" : "");
      b.textContent = liked ? "♥ Нравится" : "♡ Нравится";
    };
    $("#statusSel").onchange = async (e) => {
      if (!Store.user) { e.target.value = ""; return needLogin(); }
      await Store.save(m, { status: e.target.value || null }).catch((err) => toast(err.message));
      toast("Сохранено");
    };
  }

  // ---------- Плеер: hls.js + AniLibria ----------
  const QUALITIES = [["1080", "1080p"], ["720", "720p"], ["480", "480p"]];
  let activeHls = null;
  let hlsLoading = null;

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  // Позиция просмотра (минута серии) хранится в этом браузере; серия и статус синхронизируются через аккаунт
  const Pos = {
    key: (id) => "tsukimi:pos:" + ((Store.user && Store.user.name) || "guest") + ":" + id,
    get(id) { try { return JSON.parse(localStorage.getItem(Pos.key(id)) || "null"); } catch (e) { return null; } },
    set(id, ep, t) { try { localStorage.setItem(Pos.key(id), JSON.stringify({ ep: String(ep), t: Math.floor(t), at: Date.now() })); } catch (e) {} },
    clear(id) { try { localStorage.removeItem(Pos.key(id)); } catch (e) {} },
  };
  const mmss = (t) => { t = Math.floor(t); const h = Math.floor(t / 3600), m2 = Math.floor((t % 3600) / 60), s2 = t % 60; return (h ? h + ":" + String(m2).padStart(2, "0") : m2) + ":" + String(s2).padStart(2, "0"); };

  // освобождаем плеер, когда уходим со страницы просмотра
  function stopPlayer() {
    if (activeHls) {
      activeHls.destroy();
      activeHls = null;
    }
  }

  // hls.js подключается только на странице просмотра
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    if (!hlsLoading) {
      hlsLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
        s.onload = resolve;
        s.onerror = () => {
          hlsLoading = null;
          s.remove();
          reject(new Error("не удалось загрузить библиотеку плеера hls.js (cdn.jsdelivr.net)"));
        };
        document.head.appendChild(s);
      });
    }
    return hlsLoading;
  }

  async function pageWatch(id, epParam) {
    loading();
    const m = await Api.detail(id);
    if (!m) return fail("Аниме не найдено");

    app.innerHTML = `<div class="wrap watch">
      <div class="watch-bar">
        <a class="btn" href="#/anime/${m.id}">← ${esc(Api.title(m))}</a>
        <div class="grow"><h1 id="epTitle">Серия</h1></div>
        <select class="select" id="qualitySel" aria-label="Качество" hidden></select>
      </div>
      <div class="srcbar" id="srcBar" role="tablist" aria-label="Источник видео" hidden></div>
      <div class="tip" id="adTip" role="note" hidden>
        <span class="tip-ico" aria-hidden="true">ⓘ</span>
        <p>В плеере Kodik есть встроенная видеореклама. Чтобы смотреть без неё, рекомендуем использовать <a href="https://ublockorigin.com/" target="_blank" rel="noopener noreferrer">uBlock Origin</a> или браузер со встроенным блоком (<a href="https://brave.com/" target="_blank" rel="noopener noreferrer">Brave</a> / <a href="https://adguard.com/" target="_blank" rel="noopener noreferrer">AdGuard</a>).</p>
        <button type="button" class="tip-x" id="adTipX" aria-label="Закрыть подсказку">×</button>
      </div>
      <div class="player" id="player"><div class="player-empty"><div>Ищу «${esc(Api.title(m))}» в каталоге AniLibria…</div></div></div>
      <div class="watch-bar" id="navBar" hidden>
        <button class="btn" id="prevBtn" type="button">← Назад</button>
        <button class="btn primary" id="nextBtn" type="button">Следующая серия</button>
      </div>
      <div id="epsBox"></div>
    </div>`;

    const box = $("#player");
    const note = (html) => { if (box.isConnected) box.innerHTML = `<div class="player-empty"><div>${html}</div></div>`; };
    const overlay = (text) => { if (box.isConnected) box.insertAdjacentHTML("beforeend", `<div class="player-note">${esc(text)}</div>`); };

    const trailerId = m.trailer && String(m.trailer.site).toLowerCase() === "youtube" && /^[\w-]{6,20}$/.test(m.trailer.id) ? m.trailer.id : null;
    const R = cfg.RESERVE || {};
    const reserveOn = !!(R.enabled && m.idMal);
    const gateOn = !!(/^https:\/\//.test(cfg.WORKER_URL || "") && m.idMal);

    // ступень 1: AniLibria, прямой поток m3u8 (умный поиск и ручная карта внутри Libria.find)
    let found = null;
    let reason = `Серий «${esc(Api.title(m))}» нет в AniLibria.`;
    try {
      found = await Libria.find(m);
    } catch (e) {
      reason = `AniLibria не отвечает (${esc(e.message)}), <a href="#/diag" style="text-decoration:underline">что открывается у тебя</a>.`;
    }
    if (!box.isConnected) return; // пока искали, ушли на другую страницу
    if (found && found.blocked) {
      reason = "AniLibria закрыла это аниме от просмотра по требованию правообладателя или из-за региона.";
      found = null;
    } else if (found && !found.episodes.length) {
      reason = "У AniLibria пока нет загруженных серий этого аниме.";
      found = null;
    }

    const srcBar = $("#srcBar");
    const epsBox = $("#epsBox");
    let tab = 0;

    function drawTabs() {
      const tabs = [
        [1, "Источник 1 (AniLibria)", !found],
        [2, "Источник 2 (Kodik)", !gateOn],
        [3, "Источник 3 (EN)", !reserveOn],
        [4, "Трейлер", false],
      ];
      srcBar.hidden = false;
      srcBar.innerHTML = tabs
        .map(([n, label, off]) => `<button type="button" role="tab" class="chip ${n === tab ? "on" : ""} ${off ? "off" : ""}" data-t="${n}" aria-selected="${n === tab}">${label}${off ? " · нет" : ""}</button>`)
        .join("");
    }

    // ---- Источник 2: плеер по номеру MyAnimeList, серии и язык выбираются кнопками ----
    const total = Math.min(300, m.episodes || (m.nextAiringEpisode && m.nextAiringEpisode.episode - 1) || 12);
    let resEp = Math.max(1, Math.min(total, parseInt(epParam, 10) || 1));
    let resLang = "sub";
    function drawReserve() {
      $("#epTitle").textContent = "Источник 3 · серия " + resEp;
      const src = String(R.url).replace(/\{(\w+)\}/g, (_, k) => ({ mal: m.idMal, ep: resEp, lang: resLang }[k] ?? ""));
      // megaplay отказывает рамкам с sandbox («Sandboxed our player is not allowed») и без реферера (ошибка 410),
      // поэтому по умолчанию рамка без sandbox и с обычным referrer. Ограничения можно вернуть в config.js (RESERVE.sandbox).
      const sb = R.sandbox ? ` sandbox="${esc(R.sandbox)}"` : "";
      box.innerHTML = `<iframe src="${esc(src)}" title="Резервный плеер"${sb} allowfullscreen="true" allow="autoplay *; fullscreen *"></iframe>`;
      epsBox.innerHTML = `<div class="alt-links" role="group" aria-label="Язык">
          <button type="button" class="chip ${resLang === "sub" ? "on" : ""}" data-lang="sub">Английские субтитры</button>
          <button type="button" class="chip ${resLang === "dub" ? "on" : ""}" data-lang="dub">Английская озвучка</button>
        </div>
        ${section("Серии", `<div class="eps">${Array.from({ length: total }, (_, i) => `<button type="button" class="ep ${i + 1 === resEp ? "cur" : ""}" data-rep="${i + 1}">${i + 1}</button>`).join("")}</div>`)}
        <p class="muted" style="max-width:70ch;margin-top:12px">Резервный плеер без русской озвучки. Если серия не открывается, попробуй другой язык.</p>`;
      history.replaceState(null, "", "#/watch/" + m.id + "/" + resEp);
      if (Store.user) Store.addHistory(m, resEp).catch((err) => toast(err.message));
    }
    // ---- Источник 2: Kodik через шлюз на Cloudflare Workers ----
    const gateCache = (window.__gateCache = window.__gateCache || new Map());
    async function fetchGate() {
      if (gateCache.has(m.idMal)) return gateCache.get(m.idMal);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const base = cfg.WORKER_URL + (cfg.WORKER_URL.includes("?") ? "&" : "?") + "id=" + encodeURIComponent(m.idMal);
        const res = await fetch(base, { signal: ctrl.signal });
        if (!res.ok) return { err: res.status === 404 ? "Kodik не знает этого аниме" : "шлюз ответил ошибкой " + res.status };
        const text = (await res.text()).trim();
        let url = text;
        try { const j = JSON.parse(text); url = j && j.url; } catch (e) {}
        if (!url) return { err: "Kodik не знает этого аниме" };
        if (!/^https:\/\//.test(url)) return { err: "шлюз вернул ссылку в неожиданном виде" };
        if (cfg.KODIK_HOST && /^https:\/\//.test(cfg.KODIK_HOST)) url = url.replace(/^https:\/\/[^/]+\//, cfg.KODIK_HOST.replace(/\/?$/, "/"));
        gateCache.set(m.idMal, { url });
        return { url };
      } catch (e) {
        return { err: e.name === "AbortError" ? "шлюз не ответил за 12 с" : "шлюз недоступен" };
      } finally {
        clearTimeout(t);
      }
    }
    function drawGate() {
      $("#epTitle").textContent = "Источник 2 · Kodik";
      note("Ищу плеер…");
      fetchGate().then((r) => {
        if (tab !== 2 || !box.isConnected) return; // пока ждали, вкладку или страницу сменили
        if (!r.url) return note(`Плеер временно недоступен<div class="muted" style="font-size:12px;margin-top:8px">${esc(r.err)}</div>`);
        const sb = cfg.WORKER_SANDBOX ? ` sandbox="${esc(cfg.WORKER_SANDBOX)}"` : "";
        box.innerHTML = `<iframe src="${esc(r.url)}" title="Kodik"${sb} allowfullscreen="true" allow="autoplay *; fullscreen *"></iframe>`;
      });
    }

    epsBox.addEventListener("click", (ev) => {
      if (tab !== 3) return;
      const l = ev.target.closest("[data-lang]");
      const e = ev.target.closest("[data-rep]");
      if (l) { resLang = l.dataset.lang; drawReserve(); }
      else if (e) { resEp = Number(e.dataset.rep); drawReserve(); }
    });

    function setTab(n) {
      tab = n;
      stopPlayer();
      drawTabs();
      $("#qualitySel").hidden = true;
      $("#navBar").hidden = true;
      epsBox.innerHTML = "";
      // подсказка про рекламу видна только на «Источнике 2 (Kodik)» и пока её не закрыли
      $("#adTip").hidden = n !== 2 || store.get("tsukimi:adtip") === "closed";
      if (n === 1) {
        if (found) return startNative();
        $("#epTitle").textContent = "Источник 1";
        note(reason + (gateOn || reserveOn ? " Попробуй другой источник." : ""));
      } else if (n === 2) {
        if (!gateOn) { $("#epTitle").textContent = "Источник 2"; return note("Шлюз Kodik не настроен (WORKER_URL в config.js)."); }
        drawGate();
      } else if (n === 3) {
        if (!reserveOn) { $("#epTitle").textContent = "Источник 3"; return note("Резервный плеер не настроен."); }
        drawReserve();
      } else {
        $("#epTitle").textContent = "Трейлер";
        if (trailerId) {
          box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${trailerId}" title="Трейлер" allow="fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        } else {
          note("Трейлера у этого аниме нет.");
        }
      }
    }
    $("#adTipX").onclick = () => { $("#adTip").hidden = true; store.set("tsukimi:adtip", "closed"); };
    srcBar.onclick = (ev) => {
      const b = ev.target.closest("[data-t]");
      if (b && Number(b.dataset.t) !== tab) setTab(Number(b.dataset.t));
    };

    let curOrd = epParam;
    // сначала AniLibria, если не нашлось: резерв, если и его нет: трейлер со ссылками
    async function startNative() {
    const eps = found.episodes;
    $("#epTitle").textContent = "Серия";
    // 2) подключаем hls.js
    try {
      await loadHls();
    } catch (e) {
      return note(esc(e.message) + ".<br>Проверь интернет и обнови страницу.");
    }
    if (!box.isConnected) return;

    // 3) плеер и сетка серий
    box.innerHTML = `<video id="anime-player" class="anime-player" controls playsinline preload="metadata"></video>`;
    const video = $("#anime-player");
    const qSel = $("#qualitySel");
    const prevBtn = $("#prevBtn");
    const nextBtn = $("#nextBtn");
    $("#epsBox").innerHTML = section(
      "Серии",
      `<div class="eps">${eps.map((e, i) => `<button type="button" class="ep" data-i="${i}">${esc(e.ordinal)}</button>`).join("")}</div>`
    );

    let idx = Math.max(0, eps.findIndex((e) => String(e.ordinal) === String(curOrd)));
    let netRetries = 0;

    // запоминаем минуту просмотра (раз в несколько секунд); в конце серии позицию сбрасываем
    let lastSave = 0;
    video.addEventListener("timeupdate", () => {
      const now = Date.now();
      if (now - lastSave < 5000 || !video.currentTime || video.currentTime < 5) return;
      lastSave = now;
      if (video.duration && video.duration - video.currentTime < 30) return Pos.clear(m.id);
      Pos.set(m.id, eps[idx].ordinal, video.currentTime);
    });
    video.addEventListener("pause", () => { if (video.currentTime > 5 && !(video.duration && video.duration - video.currentTime < 30)) Pos.set(m.id, eps[idx].ordinal, video.currentTime); });
    video.addEventListener("ended", () => Pos.clear(m.id));
    function resumeBar(text, onRestart) {
      let bar = $("#resumeBar");
      if (!bar) { bar = document.createElement("div"); bar.id = "resumeBar"; bar.className = "resume"; box.parentNode.insertBefore(bar, box); }
      bar.innerHTML = `<span>${text}</span><button type="button" class="btn" id="resumeRestart">С начала</button>`;
      bar.querySelector("#resumeRestart").onclick = () => { onRestart(); bar.remove(); };
      setTimeout(() => bar.isConnected && bar.remove(), 12000);
    }

    // лучшее доступное качество не выше выбранного человеком (по умолчанию самое высокое)
    function pickQuality(e) {
      const want = Number(store.get("tsukimi:quality") || 1080);
      const avail = QUALITIES.map(([q]) => q).filter((q) => e.hls[q]);
      return avail.find((q) => Number(q) <= want) || avail[avail.length - 1];
    }

    // привязываем поток к <video>; hls.js, а в Safari — встроенная поддержка HLS
    function attach(url, startAt, autoplay) {
      stopPlayer();
      netRetries = 0;
      const begin = () => {
        if (startAt) video.currentTime = startAt;
        if (autoplay) video.play().catch(() => {});
      };
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ maxBufferLength: 40 });
        activeHls = hls;
        hls.on(window.Hls.Events.MANIFEST_PARSED, begin);
        hls.on(window.Hls.Events.ERROR, (_, d) => {
          if (!d.fatal) return;
          if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR && netRetries < 3) {
            netRetries++;
            hls.startLoad();
          } else if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && netRetries < 3) {
            netRetries++;
            hls.recoverMediaError();
          } else {
            overlay("Видео не загрузилось: сервер AniLibria (cache.libria.fun) недоступен из твоей сети или поток повреждён.");
          }
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.addEventListener("loadedmetadata", begin, { once: true });
      } else {
        overlay("Этот браузер не умеет воспроизводить потоковое видео HLS.");
      }
    }

    function select(i, { autoplay = false, startAt = 0, resume = false } = {}) {
      idx = i;
      const e = eps[i];
      const bar0 = $("#resumeBar"); if (bar0) bar0.remove();
      if (!startAt) { // продолжаем с запомненной минуты, если это та же серия
        const p = Pos.get(m.id);
        if (p && String(p.ep) === String(e.ordinal) && p.t > 10) {
          startAt = p.t;
          resumeBar("Продолжаем серию " + esc(e.ordinal) + " с " + mmss(p.t), () => { Pos.clear(m.id); video.currentTime = 0; });
        }
      }
      curOrd = e.ordinal;
      $("#epTitle").textContent = "Серия " + e.ordinal + (e.name ? ": " + e.name : "");
      $("#epsBox").querySelectorAll(".ep").forEach((b, j) => {
        b.classList.toggle("cur", j === i);
        b.classList.toggle("done", j < i);
      });

      const avail = QUALITIES.filter(([q]) => e.hls[q]);
      const q = pickQuality(e);
      qSel.innerHTML = avail.map(([v, label]) => `<option value="${v}">${label}</option>`).join("");
      qSel.value = q;
      qSel.hidden = avail.length < 2;

      const last = i === eps.length - 1;
      prevBtn.disabled = i === 0;
      nextBtn.textContent = last ? "Отметить просмотренным" : "Следующая серия";
      $("#navBar").hidden = false;

      // адрес в строке меняется без перезагрузки страницы
      history.replaceState(null, "", "#/watch/" + m.id + "/" + e.ordinal);
      attach(e.hls[q], startAt, autoplay);

      // история: последняя открытая серия; статус «смотрю», если ещё не задан
      if (Store.user && Number.isInteger(Number(e.ordinal))) {
        const lib = Store.get(m.id) || {};
        const patch = { episode: Number(e.ordinal) };
        if (!lib.status || lib.status === "planned") patch.status = "watching";
        Store.save(m, patch).catch((err) => toast(err.message));
        Store.addHistory(m, e.ordinal).catch((err) => toast(err.message));
      }
    }

    $("#epsBox").onclick = (ev) => {
      const b = ev.target.closest(".ep");
      if (b) select(Number(b.dataset.i), { autoplay: true });
    };
    prevBtn.onclick = () => idx > 0 && select(idx - 1, { autoplay: true });
    nextBtn.onclick = async () => {
      if (idx < eps.length - 1) return select(idx + 1, { autoplay: true });
      if (!Store.user) return toast("Сначала войди");
      await Store.save(m, { status: "completed", episode: Number(eps[idx].ordinal) }).catch((err) => toast(err.message));
      toast("Отмечено просмотренным");
    };
    qSel.onchange = () => {
      store.set("tsukimi:quality", qSel.value);
      const playing = !video.paused;
      attach(eps[idx].hls[qSel.value], video.currentTime, playing);
    };

    select(idx, { autoplay: true });
    }

    setTab(found ? 1 : gateOn ? 2 : reserveOn ? 3 : 4);
  }

  function pageLibrary(params) {
    if (!Store.user) return (location.hash = "#/login");
    const tab = params.get("tab") || "liked";
    const all = Store.all();
    const hist = Store.history();
    const tabs = [["liked", "Нравится"], ...Object.entries(STATUS), ["history", "История"]];
    const count = (k) => (k === "history" ? hist.length : all.filter((r) => (k === "liked" ? r.liked : r.status === k)).length);
    let body;
    if (tab === "history") {
      const fmt = (iso) => { try { return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
      body = hist.length
        ? `<div class="friend-list">${hist.map((h) => `<a class="friend" href="#/watch/${h.anime_id}/${h.episode}">
            ${h.poster ? `<img src="${esc(h.poster)}" alt="" loading="lazy">` : ""}
            <div><b>${esc(h.title || "Аниме")}</b><div class="muted">Серия ${esc(h.episode)} · ${esc(fmt(h.watched_at))}</div></div></a>`).join("")}</div>`
        : `<div class="empty">Ты пока ничего не смотрел. Открытые серии появятся здесь.</div>`;
    } else {
      const list = all
        .filter((r) => (tab === "liked" ? r.liked : r.status === tab))
        .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
      body = list.length
        ? `<div class="grid">${list.map((r) => libCard(r, r.episode ? "Серия " + r.episode : "")).join("")}</div>`
        : `<div class="empty">Здесь пока пусто. Найди аниме в <a href="#/search">каталоге</a> и добавь его в список.</div>`;
    }
    app.innerHTML = `<div class="wrap">
      <h1 style="font-size:26px">Моя библиотека</h1>
      <div class="chips">${tabs.map(([k, v]) => `<a class="chip ${k === tab ? "on" : ""}" href="#/library?tab=${k}">${v} · ${count(k)}</a>`).join("")}</div>
      <div style="margin-top:24px">${body}</div>
    </div>`;
  }

  async function pageFriends() {
    if (!Store.user) return (location.hash = "#/login");
    if (Store.mode !== "cloud") {
      app.innerHTML = `<div class="wrap"><div class="empty">Друзья появятся, когда подключишь облачный режим (Supabase). Пошаговая инструкция есть в README.</div></div>`;
      return;
    }
    loading();
    const rows = await Store.friends();
    const body = rows.length
      ? `<div class="friend-list">${rows.map((r) => `<a class="friend" href="#/anime/${r.anime_id}">
          ${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy">` : ""}
          <div><b>${esc(r.friend)}</b> ${r.liked ? "поставил(а) ♥" : r.episode ? "смотрит серию " + r.episode : STATUS[r.status] ? "добавил(а) в «" + STATUS[r.status] + "»" : "открыл(а)"}
          <div>${esc(r.title)}</div></div></a>`).join("")}</div>`
      : `<div class="empty">Друзья пока ничего не отметили.</div>`;
    app.innerHTML = `<div class="wrap"><h1 style="font-size:26px">Друзья</h1><div style="margin-top:20px">${body}</div></div>`;
  }

  // Вошёл через Google, но ещё не ввёл код приглашения
  function pageInvite() {
    app.innerHTML = `<div class="auth">
      <h1>Код приглашения</h1>
      <div class="muted">Привет, ${esc(Store.user.name)}! Сайт закрытый: введи код, который дал владелец, чтобы продолжить.</div>
      <form id="inviteForm">
        <label class="field"><span>Код приглашения</span><input name="invite" required autocomplete="off"></label>
        <button class="btn primary" type="submit">Продолжить</button>
        <div class="error" id="err" role="alert"></div>
      </form>
      <button class="btn" type="button" id="inviteOut" style="margin-top:10px">Выйти</button>
    </div>`;
    $("#inviteForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", e.target);
      btn.disabled = true;
      try {
        await Store.redeemInvite(new FormData(e.target).get("invite"));
        toast("Добро пожаловать!");
        location.hash = "#/";
        route();
      } catch (err) {
        $("#err").textContent = err.message;
        btn.disabled = false;
      }
    };
    $("#inviteOut").onclick = async () => { await Store.signOut(); location.hash = "#/"; route(); };
  }

  const OAUTH = (cfg.OAUTH_PROVIDERS || []).filter((p) => /^[a-z]+$/.test(p));
  const PROVIDER_NAME = { google: "Google", discord: "Discord", github: "GitHub" };

  function pageLogin() {
    if (Store.user) return (location.hash = "#/");
    const cloud = Store.mode === "cloud";
    let mode = cloud ? "in" : "local";
    const draw = () => {
      app.innerHTML = `<div class="auth">
        <h1>${mode === "up" ? "Регистрация" : "Вход"}</h1>
        <div class="muted">${cloud ? "Регистрация только по коду приглашения." : "Локальный режим: данные хранятся только в этом браузере."}</div>
        ${cloud ? `<div class="tabs"><button type="button" data-m="in" class="${mode === "in" ? "on" : ""}">Войти</button><button type="button" data-m="up" class="${mode === "up" ? "on" : ""}">Регистрация</button></div>` : ""}
        <form id="authForm">
          ${mode === "local" ? `<label class="field"><span>Имя</span><input name="name" required autocomplete="nickname"></label>` : ""}
          ${mode !== "local" ? `<label class="field"><span>Почта</span><input name="email" type="email" required autocomplete="email"></label>
          <label class="field"><span>Пароль</span><input name="password" type="password" minlength="6" required autocomplete="${mode === "up" ? "new-password" : "current-password"}"></label>` : ""}
          ${mode === "up" ? `<label class="field"><span>Имя на сайте</span><input name="name" required></label>
          <label class="field"><span>Код приглашения</span><input name="invite" required autocomplete="off"></label>` : ""}
          <button class="btn primary" type="submit">${mode === "up" ? "Создать аккаунт" : "Войти"}</button>
          <div class="error" id="err" role="alert"></div>
        </form>
        ${cloud && OAUTH.length ? `<div class="or"><span>или</span></div>${OAUTH.map((p) => `<button class="btn oauth ${p}" type="button" data-oauth="${p}">${p === "google" ? `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg> ` : ""}Продолжить с ${PROVIDER_NAME[p] || p}</button>`).join("")}` : ""}
        ${!cloud ? `<p class="note">Сейчас включён локальный режим: данные хранятся только в этом браузере. Вход по почте появится после подключения Supabase (инструкция в README).</p>` : ""}
      </div>`;
      $("#authForm").onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const btn = $("button[type=submit]", e.target);
        btn.disabled = true;
        try {
          if (mode === "local") Store.localLogin(f.name);
          else if (mode === "in") await Store.signIn(f.email.trim(), f.password);
          else await Store.signUp(f.email.trim(), f.password, f.name.trim(), f.invite.trim());
          location.hash = "#/";
        } catch (err) {
          $("#err").textContent = err.message;
          btn.disabled = false;
        }
      };
      app.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
      app.querySelectorAll("[data-oauth]").forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        try { await Store.signInWith(b.dataset.oauth); } catch (err) { $("#err").textContent = err.message; b.disabled = false; }
      }));
    };
    draw();
  }

  // Проверка, какие сервисы открываются из сети пользователя (для случаев с блокировками и VPN).
  async function pageDiag() {
    const checks = [
      ["Каталог AniList", "https://graphql.anilist.co/"],
      ["Постеры AniList", "https://s4.anilist.co/"],
      ["Русские названия (Shikimori)", "https://shikimori.one/"],
      ["Каталог видео AniLibria", "https://anilibria.top/"],
      ["Видеосервер AniLibria", "https://cache.libria.fun/"],
      ["Библиотека плеера hls.js (jsDelivr)", "https://cdn.jsdelivr.net/"],
      ["Шрифты Google", "https://fonts.googleapis.com/"],
      ["Резервный плеер (megaplay.buzz)", "https://megaplay.buzz/"],
    ];
    app.innerHTML = `<div class="wrap"><h1 style="font-size:26px">Проверка доступности</h1>
      <p class="muted">Показывает, какие сервисы открываются из твоей сети прямо сейчас. Открой эту страницу без VPN и с VPN и сравни.</p>
      <p class="muted">Этот сайт открыт по адресу: <b>${esc(location.host)}</b></p>
      <div class="friend-list" style="margin-top:16px">${checks.map(([n], i) => `<div class="friend" id="d${i}"><div><b>${esc(n)}</b> <span class="muted">проверяю…</span></div></div>`).join("")}</div>
      <p class="note">«Не открывается» значит, что соединение обрывается или блокируется до ответа сервиса.</p></div>`;
    checks.forEach(async ([name, url], i) => {
      const t0 = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let ok = false;
      try { await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal }); ok = true; } catch (e) {}
      clearTimeout(timer);
      const el = $("#d" + i);
      if (el) el.innerHTML = `<div><b>${esc(name)}</b> — ${ok ? `<span style="color:var(--moon)">открывается</span> <span class="muted">${Math.round(performance.now() - t0)} мс</span>` : `<span style="color:var(--rose)">не открывается</span>`}</div>`;
    });
  }

  // ---------- шапка и роутер ----------
  function drawNav() {
    const hash = location.hash || "#/";
    const link = (href, text) => `<a href="${href}" class="${hash.startsWith(href) && href !== "#/" ? "on" : ""}">${text}</a>`;
    $("#navLinks").innerHTML =
      link("#/search", "Каталог") +
      (Store.user
        ? link("#/library", "Библиотека") + link("#/friends", "Друзья") +
          `<div class="usermenu"><button id="userBtn" aria-haspopup="true" aria-expanded="false">${esc(Store.user.name)} ▾</button>
            <div class="menu" id="userMenu" hidden>
              <a href="#/library">Моя библиотека</a>
              <button type="button" id="addAnimeBtn">Добавить аниме</button>
              <hr>
              <button type="button" id="outBtn" class="danger">Выйти</button>
            </div></div>`
        : link("#/login", "Войти"));
    const ub = $("#userBtn"), menu = $("#userMenu");
    if (!ub) return;
    const close = () => { menu.hidden = true; ub.setAttribute("aria-expanded", "false"); };
    ub.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; ub.setAttribute("aria-expanded", String(!menu.hidden)); };
    menu.onclick = (e) => { e.stopPropagation(); if (e.target.closest("a")) close(); };
    document.addEventListener("click", close, { once: true });
    $("#addAnimeBtn").onclick = () => { close(); openAddAnime(); };
    $("#outBtn").onclick = async () => { close(); await Store.signOut(); location.hash = "#/"; route(); };
  }

  // окно «Добавить аниме»: отмечаем уже просмотренное, на этом строятся рекомендации
  function openAddAnime() {
    if (!Store.user) return;
    const old = $("#addModal"); if (old) old.remove();
    const el = document.createElement("div");
    el.id = "addModal";
    el.className = "modal";
    el.innerHTML = `<div class="modal-box" role="dialog" aria-label="Добавить аниме">
        <div class="modal-head"><h3>Добавить просмотренное аниме</h3><button type="button" class="x" id="addClose" aria-label="Закрыть">✕</button></div>
        <p class="muted" style="margin:0 0 10px">Ищи по-русски или по-английски и отмечай, что уже смотрел. По этому списку подбираются рекомендации.</p>
        <input class="select" id="addQ" placeholder="Название аниме…" style="width:100%" autocomplete="off">
        <div id="addRes" class="add-res"></div></div>`;
    document.body.appendChild(el);
    const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    el.onclick = (e) => { if (e.target === el) close(); };
    $("#addClose").onclick = close;
    const res = $("#addRes");
    let items = [], timer = null, seq = 0;
    const draw = () => {
      res.innerHTML = items.length ? items.map((m) => {
        const done = (Store.get(m.id) || {}).status === "completed";
        return `<div class="add-row"><img src="${esc(m.coverImage && m.coverImage.large)}" alt="" loading="lazy">
          <div class="add-info"><b>${esc(Api.title(m))}</b><span class="muted">${[m.seasonYear, STATUS_FORMAT[m.format] || m.format, m.episodes ? m.episodes + " эп." : ""].filter(Boolean).join(" · ")}</span></div>
          <button type="button" class="btn ${done ? "primary" : ""}" data-id="${m.id}">${done ? "✓ Просмотрено" : "Просмотрено"}</button></div>`;
      }).join("") : `<p class="muted">${$("#addQ").value.trim() ? "Ничего не найдено" : ""}</p>`;
    };
    res.onclick = async (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      const m = items.find((x) => String(x.id) === b.dataset.id);
      if (!m) return;
      const done = (Store.get(m.id) || {}).status === "completed";
      try {
        await Store.save(m, done ? { status: null } : { status: "completed", episode: m.episodes || null });
        draw();
        toast(done ? "Убрано из просмотренного" : "Добавлено: " + Api.title(m));
      } catch (err) { toast(err.message); }
    };
    $("#addQ").oninput = (e) => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      if (!q) { items = []; return draw(); }
      timer = setTimeout(async () => {
        const my = ++seq;
        res.innerHTML = `<p class="muted">Ищу…</p>`;
        try { const r = await Api.search({ q }); if (my === seq) { items = r.items.slice(0, 12); draw(); } }
        catch (err) { if (my === seq) res.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
      }, 350);
    };
    $("#addQ").focus();
  }

  async function route() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, query] = hash.split("?");
    const parts = path.split("/").filter(Boolean);
    const params = new URLSearchParams(query || "");
    stopPlayer();
    drawNav();
    window.scrollTo(0, 0);
    try {
      // вошёл через Google без кода приглашения: пускаем только на страницу ввода кода
      if (Store.user && Store.user.approved === false) pageInvite();
      else if (!parts.length) await pageHome();
      else if (parts[0] === "search") await pageSearch(params);
      else if (parts[0] === "anime") await pageAnime(parts[1]);
      else if (parts[0] === "watch") await pageWatch(parts[1], parts[2]);
      else if (parts[0] === "library") pageLibrary(params);
      else if (parts[0] === "friends") await pageFriends();
      else if (parts[0] === "login") pageLogin();
      else if (parts[0] === "diag") pageDiag();
      else app.innerHTML = `<div class="wrap"><div class="empty">Такой страницы нет. <a href="#/">На главную</a></div></div>`;
    } catch (e) {
      fail(e);
    }
  }

  $("#navSearch").onsubmit = (e) => {
    e.preventDefault();
    const q = $("#navQ").value.trim();
    location.hash = q ? "#/search?q=" + encodeURIComponent(q) : "#/search";
    $("#navQ").blur();
  };

  // заранее готовим описание, пока курсор над карточкой
  const warmed = new Set();
  const warm = (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/anime/"]');
    const id = a && (a.getAttribute("href").match(/#\/anime\/(\d+)/) || [])[1];
    if (!id || warmed.has(id)) return;
    warmed.add(id);
    Api.detail(id).then((d) => d && d.description && Api.translate(d.description, "d" + id)).catch(() => {});
  };
  document.addEventListener("mouseover", warm);
  document.addEventListener("touchstart", warm, { passive: true });

  window.addEventListener("hashchange", route);
  Store.init().catch((e) => toast(e.message)).finally(route);
})();
