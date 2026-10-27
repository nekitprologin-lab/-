// Страницы и роутинг. Адреса вида #/anime/123, #/watch/123/4, #/search?q=...
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
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
    const gen = (m.genres || []).slice(0, 2).join(" · ");
    const col = (m.coverImage && m.coverImage.color) || "";
    return `<a class="card" href="#/anime/${m.id}"${col ? ` style="--c:${esc(col)}"` : ""}>
      <div class="poster" style="background:${esc(col || "var(--panel)")}">
        ${poster ? `<img src="${esc(poster)}" alt="" loading="lazy">` : ""}
        ${gen || m.episodes ? `<span class="gen">${gen ? `<b>${esc(gen)}</b>` : ""}${m.episodes ? `<em>${m.episodes} эп.</em>` : ""}</span>` : ""}
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

  // карточка с появлением по очереди (для результатов поиска и библиотеки)
  const stag = (html, i) => html.replace('<a class="card"', `<a class="card in" style="--i:${Math.min(i, 20)}"`);

  const section = (title, body, right = "") =>
    `<section class="section"><div class="section-head"><h2>${esc(title)}</h2>${right}</div>${body}</section>`;

  const loading = (t = "Загружаю…") => (app.innerHTML = `<div class="loading">${t}</div>`);
  const fail = (e) =>
    (app.innerHTML = `<div class="wrap"><div class="empty">Не получилось загрузить данные: ${esc(e.message || e)}.<br>Проверь интернет и <a href="javascript:location.reload()">обнови страницу</a>.</div></div>`);

  // ---------- рекомендации ----------
  // Вкус считается по жанрам с весами (лайк +3, просмотрено +2, смотрю +1, брошено −2; свежее важнее старого).
  // Кандидаты: популярное в сочетаниях любимых жанров + «похожее» от AniList к пяти самым весомым тайтлам.
  // Исключаем уже виденное, в том числе другие сезоны той же франшизы; разные жанры чередуем, слабые оценки отсеиваем.
  // Результат запоминается на 30 минут и пересчитывается, когда библиотека изменилась.
  async function recommend() {
    const lib = Store.all();
    const tw = Smart.taste(lib);
    const top = Object.entries(tw.weights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 4);
    if (!top.length) return [];

    const fp = lib.map((r) => [r.anime_id, r.status || "", r.liked ? 1 : 0].join(":")).sort().join("|");
    const ckey = "tsukimi:rec:" + ((Store.user && (Store.user.id || Store.user.name)) || "local");
    try {
      const c = JSON.parse(localStorage.getItem(ckey) || "null");
      if (c && c.fp === fp && Date.now() - c.t < 30 * 60000 && c.items && c.items.length) return c.items;
    } catch (e) {}
    // на аккаунте лежит готовый профиль: если библиотека не менялась, берём его (на любом устройстве, мгновенно)
    const cloud = await Store.tasteLoad();
    if (cloud && cloud.fp === fp && Array.isArray(cloud.recs) && cloud.recs.length && Date.now() - new Date(cloud.updated_at).getTime() < 12 * 3600e3) {
      try { localStorage.setItem(ckey, JSON.stringify({ fp, t: Date.now(), items: cloud.recs })); } catch (e) {}
      return cloud.recs;
    }

    const anchors = lib
      .filter((r) => r.liked || r.status === "completed")
      .map((r) => ({ r, w: (r.liked ? 3 : 0) + (r.status === "completed" ? 2 : 0) }))
      .sort((a, b) => b.w - a.w || (b.r.updated_at > a.r.updated_at ? 1 : -1))
      .slice(0, 5);

    const combos = [];
    if (top[1]) combos.push([top[0], top[1]]);
    if (top[2]) combos.push([top[0], top[2]]);
    if (top[1] && top[2]) combos.push([top[1], top[2]]);
    combos.push([top[0]]);
    if (top[3]) combos.push([top[3]]);

    const [byGenre, recs] = await Promise.all([
      Promise.all(combos.map((g) => Api.pick({ g, sc: 65 }))),
      Promise.all(anchors.map((a) => Api.recsById(a.r.anime_id))),
    ]);

    const pool = new Map();
    const add = (m, bonus) => {
      if (!m) return;
      const e = pool.get(m.id) || { m, bonus: 0 };
      e.bonus += bonus;
      pool.set(m.id, e);
    };
    byGenre.flat().forEach((m) => add(m, 0));
    recs.forEach((list, i) => list.forEach((m) => add(m, 4 + (anchors[i].w >= 5 ? 1.5 : 0))));

    const OK = ["TV", "TV_SHORT", "MOVIE", "ONA", "OVA"];
    const ranked = [...pool.values()]
      .filter((e) => !tw.seen.has(e.m.id) && OK.includes(e.m.format) && e.m.status !== "NOT_YET_RELEASED" && (e.m.averageScore || 70) >= 62 && !tw.bases.has(Smart.baseTitle(Api.title(e.m))))
      .map((e) => ({ m: e.m, s: Smart.tasteScore(e.m, tw) + e.bonus }))
      .sort((a, b) => b.s - a.s);

    // разнообразие: одна франшиза — один раз, а на каждый уже выбранный тайтл с тем же главным жанром — небольшой штраф
    const out = [], bases = new Set(), mainCount = {};
    while (out.length < 18 && ranked.length) {
      let bi = -1, bs = -1e9;
      ranked.forEach((c, i) => {
        const adj = c.s - 0.9 * (mainCount[(c.m.genres || [])[0]] || 0);
        if (adj > bs) { bs = adj; bi = i; }
      });
      const [c] = ranked.splice(bi, 1);
      const b = Smart.baseTitle(Api.title(c.m));
      if (bases.has(b)) continue;
      bases.add(b);
      const g0 = (c.m.genres || [])[0];
      mainCount[g0] = (mainCount[g0] || 0) + 1;
      out.push(c.m);
    }
    try { localStorage.setItem(ckey, JSON.stringify({ fp, t: Date.now(), items: out })); } catch (e) {}
    // сохраняем профиль на аккаунт (компактно: только то, что нужно для карточек)
    const slim = out.map((m) => ({ id: m.id, idMal: m.idMal || null, title: m.title, synonyms: (m.synonyms || []).slice(0, 3), coverImage: m.coverImage ? { large: m.coverImage.large, color: m.coverImage.color } : null, averageScore: m.averageScore || null, episodes: m.episodes || null, status: m.status || null, format: m.format || null, seasonYear: m.seasonYear || null, genres: (m.genres || []).slice(0, 4) }));
    const wTop = {}; top.forEach((g) => { wTop[g] = Math.round(tw.weights[g] * 10) / 10; });
    Store.tasteSave({ fp, top_genres: top, weights: wTop, recs: slim });
    return out;
  }

  // ---------- страницы ----------
  async function pageHome() {
    loading();
    const [trending, season] = await Promise.all([Api.trending(18), Api.thisSeason(18)]);
    // карусель: самые популярные сейчас тайтлы с широкой картинкой (если баннеров нет — обложка)
    let slides = trending.filter((m) => m.bannerImage).slice(0, 6);
    if (!slides.length) slides = trending.slice(0, 1);
    const lib = Store.all();

    let html = "";
    if (slides.length) {
      html += `<div class="hero" id="hero">${slides.map((hero, i) => `
        <div class="hero-slide ${i === 0 ? "on" : ""}" data-id="${hero.id}">
          <div class="bg" style="background-image:url('${esc(hero.bannerImage || (hero.coverImage && hero.coverImage.large))}')"></div>
          <div class="hero-in">
            <span class="hero-tag">Популярно сейчас</span>
            <h1>${esc(Api.title(hero))}</h1>
            <div class="meta"><span><b>${hero.averageScore ? (hero.averageScore / 10).toFixed(1) : "—"}</b> оценка</span>
            <span>${esc((hero.genres || []).slice(0, 3).map(Api.genreRu).join(", "))}</span></div>
            <p></p>
            <a class="btn primary" href="#/anime/${hero.id}">Открыть</a>
          </div>
        </div>`).join("")}
        ${slides.length > 1 ? `<div class="hero-dots">${slides.map((_, i) => `<button class="hd ${i === 0 ? "on" : ""}" data-i="${i}" aria-label="Слайд ${i + 1}"><i></i></button>`).join("")}</div>` : ""}
      </div>`;
    }
    html += `<div class="wrap">`;

    const cont = lib.filter((r) => r.episode && r.status !== "completed").sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 12);
    if (cont.length)
      html += section("Продолжить просмотр", `<div class="row">${cont.map((r) => libCard(r, "Серия " + r.episode)).join("")}</div>`);

    html += `<div id="recs"></div><div id="friendsBlock"></div>`;
    html += section("В тренде", `<div class="row ranked">${trending.map(card).join("")}</div>`);
    html += section("Этот сезон", `<div class="row">${season.map(card).join("")}</div>`);
    if (!Store.user)
      html += `<div class="empty" style="margin-top:40px"><a href="#/login">Войди</a>, чтобы сохранять лайки и историю и получать рекомендации.</div>`;
    html += `</div>`;
    app.innerHTML = html;

    // описание слайда подгружается, когда до него доходит очередь (и заранее для следующего), чтобы не нагружать AniList
    const heroEl = $("#hero");
    if (heroEl) {
      const filled = new Set();
      const fill = (slide) => {
        if (!slide || filled.has(slide.dataset.id)) return;
        filled.add(slide.dataset.id);
        Api.detail(Number(slide.dataset.id)).then((d) => {
          const p = $("p", slide);
          if (!p || !d) return;
          const en = (d.description || "").replace(/<[^>]*>/g, "");
          p.textContent = en;
          // в шапке влезает три строки: переводим только начало, это быстрее
          const head = en.length > 420 ? en.slice(0, 420).replace(/[^.!?…]*$/, "") || en.slice(0, 420) : en;
          Api.translate(head, "h" + d.id).then((ru) => { if (ru) p.textContent = ru; });
        }).catch(() => {});
      };
      const sl = $$(".hero-slide", heroEl), dots = $$(".hd", heroEl);
      let cur = 0;
      const go = (n) => {
        if (!sl.length) return;
        n = (n + sl.length) % sl.length;
        sl[cur].classList.remove("on"); dots[cur] && dots[cur].classList.remove("on");
        cur = n;
        sl[cur].classList.add("on");
        if (dots[cur]) { dots[cur].classList.remove("on"); void dots[cur].offsetWidth; dots[cur].classList.add("on"); }
        fill(sl[cur]); fill(sl[(cur + 1) % sl.length]);
      };
      // картинки получше: подменяем баннер AniList на широкую обложку Kitsu, когда она загрузилась (плавно, без прыжка)
      slides.forEach((m, i) => {
        Api.heroImg(m).then((u) => {
          if (!u) return;
          const img = new Image();
          img.onload = () => { const bg = $(".bg", sl[i]); if (bg) { bg.style.backgroundImage = "url('" + u + "')"; bg.classList.add("hq"); } };
          img.src = u;
        });
      });
      fill(sl[0]);
      setTimeout(() => fill(sl[1]), 1500);
      dots.forEach((d, i) => { d.onclick = () => go(i); });
      // таймер — это полоска прогресса у активной точки: по её окончанию листаем дальше; при наведении она на паузе
      heroEl.addEventListener("animationend", (e) => { if (e.target.parentNode && e.target.parentNode.classList.contains("hd") && e.target.parentNode.classList.contains("on")) go(cur + 1); });
      let x0 = null;
      heroEl.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
      heroEl.addEventListener("touchend", (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (Math.abs(dx) > 50) go(cur + (dx < 0 ? 1 : -1));
      }, { passive: true });
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
    app.innerHTML = `<div class="wrap cat">
      <div class="cat-head"><h1>Каталог</h1><p class="muted">Печатай название по-русски или по-английски, результаты появляются сразу.</p></div>
      <form class="filters" id="f" autocomplete="off">
        <label class="f-search"><input type="search" name="q" placeholder="Название аниме" value="${esc(state.q)}" aria-label="Название"></label>
        <select class="select" name="sort" aria-label="Сортировка">
          <option value="">${state.q ? "Совпадение" : "Популярные"}</option>
          <option value="SCORE_DESC">По оценке</option>
          <option value="TRENDING_DESC">В тренде</option>
          <option value="START_DATE_DESC">Новые</option>
        </select>
        <input type="number" name="year" placeholder="Год" min="1960" max="2100" value="${esc(state.year)}" aria-label="Год">
        <button class="btn" type="button" id="reset">Сбросить</button>
      </form>
      <div class="chips genre-row" id="genres">${Api.GENRES.map((g) => `<button type="button" class="chip ${g === state.genre ? "on" : ""}" data-genre="${esc(g)}">${esc(Api.genreRu(g))}</button>`).join("")}</div>
      <div id="results"></div>
      <div id="aiBox"></div>
    </div>`;
    $("select[name=sort]").value = state.sort;
    const results = $("#results");
    const input = $("input[name=q]");
    if (!state.q) input.focus();

    let seq = 0, timer = null, aiTimer = null, shown = "", shownIds = new Set(), aiSeq = 0, smartMode = false, aiEmpty = false;
    const aiBox = $("#aiBox");
    // второй слой: ИИ разбирает запрос (опечатки, смысл, жанры) и подбирает из всего каталога AniList
    async function runAI(q, mySeq) {
      const my = ++aiSeq;
      aiBox.innerHTML = `<div class="ai-wait"><i></i>Подбираю по смыслу…</div>`;
      const r = await Api.aiSearch(q).catch(() => null);
      if (my !== aiSeq || mySeq !== seq) return;
      const items = r ? r.items.filter((m) => !shownIds.has(m.id)) : [];
      aiEmpty = !items.length;
      if (!items.length) {
        aiBox.innerHTML = "";
        if (!results.querySelector(".card:not(.sk)")) results.innerHTML = `<div class="empty">Ничего не нашлось. Попробуй часть названия, жанр или опиши иначе.</div>`;
        return;
      }
      const pl = r.plan;
      const chips = [...(pl.genres || []).map(Api.genreRu), ...(pl.tags || []), pl.year ? String(pl.year) : "", pl.format === "MOVIE" ? "фильм" : "", pl.similar_to ? "похоже на " + pl.similar_to : ""].filter(Boolean);
      // если обычный поиск по названию ничего не дал, подборка и есть главный результат
      const lead = !results.querySelector(".card:not(.sk)");
      if (lead) results.innerHTML = "";
      aiBox.innerHTML = `<section class="ai-block"><div class="ai-head"><h2>${lead || pl.src === "rules" || pl.src === "similar" ? "Подобрано по запросу" : "Возможно, ты искал"}</h2>${chips.length ? `<div class="ai-tags">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}</div>
        <div class="grid">${items.map((m, i) => stag(card(m), i)).join("")}</div></section>`;
    }
    const words = (q) => q.split(/\s+/).filter(Boolean).length;
    const skeleton = () => `<div class="grid">${Array.from({ length: 12 }, () => `<div class="card sk"><div class="poster"></div><div class="name"></div><div class="sub"></div></div>`).join("")}</div>`;
    // не перерисовываем, если список тот же (иначе карточки мигают)
    function paint(items, hasNext) {
      const key = items.map((m) => m.id).join(",");
      if (key === shown && !results.querySelector(".sk")) return;
      shown = key;
      shownIds = new Set(items.map((m) => m.id));
      results.classList.remove("busy");
      if (!items.length) { results.innerHTML = smartMode && !aiEmpty ? "" : `<div class="empty">Ничего не нашлось. Попробуй часть названия или сними фильтры.</div>`; return; }
      results.innerHTML = `<div class="grid">${items.map((m, i) => stag(card(m), i)).join("")}</div>`;
      if (hasNext) {
        results.insertAdjacentHTML("beforeend", `<button class="btn more">Показать ещё</button>`);
        $(".more", results).onclick = () => { state.page++; run(true); };
      }
    }
    // мгновенный показ из локального индекса, пока идёт запрос в сеть
    function paintLocal() {
      if (!state.q || state.sort) return false;
      const loc = Api.localSearch(state.q, { genre: state.genre, year: state.year });
      if (!loc.length) return false;
      paint(loc, false);
      results.classList.add("busy");
      return true;
    }
    async function run(append) {
      const my = ++seq;
      let aiStarted = false;
      if (!append) {
        aiSeq++; aiEmpty = false; aiBox.innerHTML = "";
        // длинный запрос, похожий на описание: ИИ стартует сразу, параллельно с обычным поиском
        clearTimeout(aiTimer);
        const pr = window.Smart ? Smart.parse(state.q) : {};
        smartMode = !!(pr.descriptive || pr.similar);
        if (state.q.length >= 3 && (smartMode || words(state.q) >= 3 || /[А-Яа-яЁё]/.test(state.q)) && !state.genre && !state.year && !state.sort) {
          aiStarted = true;
          // правила работают в браузере без сети — для них пауза короткая; ИИ ждёт чуть дольше, чтобы не дёргаться на каждой букве
          aiTimer = setTimeout(() => runAI(state.q, my), smartMode ? 120 : 320);
        }
      }
      if (!append && !paintLocal()) {
        if (!results.querySelector(".grid .card:not(.sk)")) results.innerHTML = skeleton(); else results.classList.add("busy");
        shown = "";
      }
      try {
        const r = await Api.search({ q: state.q, genres: state.genre ? [state.genre] : [], year: state.year ? Number(state.year) : null, sort: state.sort, page: state.page });
        if (my !== seq) return;
        if (append) {
          const grid = $(".grid", results);
          const old = $(".more", results); if (old) old.remove();
          grid.insertAdjacentHTML("beforeend", r.items.map((m, i) => stag(card(m), i)).join(""));
          if (r.hasNext) { results.insertAdjacentHTML("beforeend", `<button class="btn more">Показать ещё</button>`); $(".more", results).onclick = () => { state.page++; run(true); }; }
        } else {
          paint(r.items, r.hasNext);
          // обычный поиск почти ничего не нашёл: подключаем ИИ
          if (!aiStarted && state.q.length >= 3 && r.items.length < 3 && !state.genre && !state.year && !state.sort) runAI(state.q, my);
        }
      } catch (e) {
        if (my !== seq) return;
        results.classList.remove("busy");
        if (!results.querySelector(".card:not(.sk)")) results.innerHTML = `<div class="empty">Не получилось загрузить: ${esc(e.message)}</div>`;
      }
    }
    const sync = () => {
      const p = new URLSearchParams();
      Object.entries({ q: state.q, genre: state.genre, sort: state.sort, year: state.year }).forEach(([k, v]) => v && p.set(k, v));
      history.replaceState(null, "", "#/search" + (p.toString() ? "?" + p : ""));
    };
    const change = (delay) => { state.page = 1; sync(); clearTimeout(timer); if (!delay) return run(false); paintLocal(); timer = setTimeout(() => run(false), delay); };
    $("#f").onsubmit = (e) => e.preventDefault();
    input.addEventListener("input", () => { state.q = input.value.trim(); change(state.q ? 200 : 0); });
    $("select[name=sort]").onchange = (e) => { state.sort = e.target.value; change(0); };
    $("input[name=year]").addEventListener("input", (e) => { state.year = e.target.value; change(350); });
    $("#genres").onclick = (e) => {
      const b = e.target.closest("[data-genre]");
      if (!b) return;
      state.genre = state.genre === b.dataset.genre ? "" : b.dataset.genre;
      $$("#genres .chip").forEach((c) => c.classList.toggle("on", c.dataset.genre === state.genre));
      change(0);
    };
    $("#reset").onclick = () => {
      state.q = state.genre = state.sort = state.year = "";
      $("#f").reset(); input.value = ""; $("select[name=sort]").value = "";
      $$("#genres .chip").forEach((c) => c.classList.remove("on"));
      change(0); input.focus();
    };
    run(false);
  }

  async function pageAnime(id) {
    loading();
    const m = await Api.detail(id);
    if (!m) return fail("Аниме не найдено");
    setTitle(Api.title(m));
    const lib = Store.get(m.id) || {};
    // показываем только вышедшие серии: у анонсов серий нет, у идущих — до последней вышедшей
    const unreleased = m.status === "NOT_YET_RELEASED";
    const total = unreleased ? 0 : m.nextAiringEpisode ? Math.max(0, m.nextAiringEpisode.episode - 1) : m.episodes || 0;
    const when = (() => {
      if (m.nextAiringEpisode && m.nextAiringEpisode.airingAt) return new Date(m.nextAiringEpisode.airingAt * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
      const d = m.startDate || {};
      if (d.year && d.month && d.day) return new Date(d.year, d.month - 1, d.day).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
      if (d.year && d.month) return new Date(d.year, d.month - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
      return d.year ? String(d.year) : "";
    })();
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
            ${unreleased ? `<span class="btn soon" aria-disabled="true">Скоро${when ? ": выйдет " + esc(when) : ""}</span>` : `<a class="btn primary" href="#/watch/${m.id}/${startEp}">${cur ? "Продолжить: серия " + cur + ((Pos.get(m.id) && String(Pos.get(m.id).ep) === String(cur) && Pos.get(m.id).t > 10) ? " · " + mmss(Pos.get(m.id).t) : "") : "Смотреть"}</a>`}
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
    const famP = ["TV", "TV_SHORT", "ONA"].includes(m.format) ? Api.seasons(m.id).catch(() => []) : Promise.resolve([]);
    // статус («Просмотрено», «Брошено»…) относится ко всему произведению, а не к одному сезону:
    // если у этого сезона статуса нет, берём тот, что уже стоит у соседних сезонов
    famP.then((list) => {
      if (!Store.user || !list.length || (Store.get(m.id) || {}).status) return;
      const sib = list.filter((n) => n.id !== m.id).map((n) => Store.get(n.id)).filter((r) => r && r.status)
        .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))[0];
      const sel = $("#statusSel");
      if (sib && sel && !sel.value) { sel.value = sib.status; Store.save(m, { status: sib.status }).catch(() => {}); }
    });
    if (["TV", "TV_SHORT", "ONA"].includes(m.format)) {
      famP.then((list) => {
        const box = $("#seasons");
        if (!box || !list.length) return;
        const labels = seasonLabels(list);
        box.innerHTML = section("Сезоны", `<div class="seasons">${list.map((n, i) =>
          `<a class="season ${n.id === m.id ? "cur" : ""}" href="#/anime/${n.id}"><b>${esc(labels[i])}</b><span data-mal="${n.idMal || ""}">${esc(Api.title(n))}</span>${n.status === "NOT_YET_RELEASED" ? `<small>Скоро${n.seasonYear || (n.startDate && n.startDate.year) ? " · " + (n.seasonYear || n.startDate.year) : ""}</small>` : n.seasonYear || (n.startDate && n.startDate.year) ? `<small>${n.seasonYear || n.startDate.year}</small>` : ""}</a>`).join("")}</div>`);
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
      const st = e.target.value || null;
      await Store.save(m, { status: st }).catch((err) => toast(err.message));
      toast("Сохранено");
      // тот же статус для всех остальных сезонов этого произведения
      const fam = await famP;
      fam.filter((n) => n.id !== m.id && !(st === "completed" && n.status === "NOT_YET_RELEASED"))
        .forEach((n) => Store.save(n, { status: st }).catch(() => {}));
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
    local(id) { try { return JSON.parse(localStorage.getItem(Pos.key(id)) || "null"); } catch (e) { return null; } },
    // берём более свежую из двух: сохранённую в браузере или в аккаунте (с другого устройства)
    get(id) {
      const l = Pos.local(id), c = Store.user ? Store.position(id) : null;
      return l && c ? (c.at > l.at ? c : l) : l || c;
    },
    _cloudAt: {},
    set(id, ep, t, src, anime) {
      const rec = { ep: String(ep), t: Math.floor(t), at: Date.now() };
      if (src) rec.src = src;
      try { localStorage.setItem(Pos.key(id), JSON.stringify(rec)); } catch (e) {}
      if (anime && Store.user && Date.now() - (Pos._cloudAt[id] || 0) > 20000) {
        Pos._cloudAt[id] = Date.now();
        Store.savePosition(anime, ep, t, src || "native").catch(() => {});
      }
    },
    clear(id) {
      try { localStorage.removeItem(Pos.key(id)); } catch (e) {}
      if (Store.user) Store.clearPosition(id).catch(() => {});
    },
  };
  const mmss = (t) => { t = Math.floor(t); const h = Math.floor(t / 3600), m2 = Math.floor((t % 3600) / 60), s2 = t % 60; return (h ? h + ":" + String(m2).padStart(2, "0") : m2) + ":" + String(s2).padStart(2, "0"); };

  // Подписи сезонов: номер сезона и часть берём из названия («3rd Season Part 2» -> «Сезон 3 · часть 2»);
  // если номера в названии нет, это следующий сезон после предыдущего.
  function seasonLabels(list) {
    const roman = { II: 2, III: 3, IV: 4, V: 5, VI: 6 };
    let season = 0;
    return list.map((n, i) => {
      const name = (n.title && (n.title.english || n.title.romaji)) || "";
      const alt = (n.title && n.title.romaji) || "";
      const txt = name + " | " + alt;
      let sm = txt.match(/(\d+)(?:st|nd|rd|th)\s+season/i) || txt.match(/season\s+(\d+)/i);
      let num = sm ? Number(sm[1]) : 0;
      if (!num) { const r = name.match(/\s(II|III|IV|V|VI)(?:\s|$|:)/); if (r) num = roman[r[1]]; }
      const pm = txt.match(/part\s+(\d+)/i) || txt.match(/(\d+)(?:st|nd|rd|th)?\s+cour/i);
      const part = pm ? Number(pm[1]) : 0;
      if (num) season = num;
      else if (i === 0) season = 1;
      else if (part > 1) { /* вторая часть того же сезона */ }
      else season += 1;
      return "Сезон " + season + (part ? " · часть " + part : "");
    });
  }

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
    setTitle("Смотреть: " + Api.title(m));

    app.innerHTML = `<div class="watch-bg" id="watchBg" aria-hidden="true" style="--glow:${esc((m.coverImage && m.coverImage.color) || '#6f6af8')}"></div><div class="wrap watch">
      <div class="watch-bar">
        <a class="btn" href="#/anime/${m.id}">← ${esc(Api.title(m))}</a>
        <div class="grow"><h1 id="epTitle">Серия</h1></div>
        <select class="select" id="qualitySel" aria-label="Качество" hidden></select>
        <button type="button" class="btn auto-skip" id="autoSkipBtn" title="Опенинг и эндинг пропускаются сами, в том числе на весь экран"></button>
      </div>
      <div class="srcbar" id="srcBar" role="tablist" aria-label="Источник видео" hidden></div>
      <div class="tip" id="adTip" role="note" hidden>
        <span class="tip-ico" aria-hidden="true">ⓘ</span>
        <p>В плеере Kodik есть встроенная видеореклама. Чтобы смотреть без неё, рекомендуем использовать <a href="https://ublockorigin.com/" target="_blank" rel="noopener noreferrer">uBlock Origin</a> или браузер со встроенным блоком (<a href="https://brave.com/" target="_blank" rel="noopener noreferrer">Brave</a> / <a href="https://adguard.com/" target="_blank" rel="noopener noreferrer">AdGuard</a>).</p>
        <button type="button" class="tip-x" id="adTipX" aria-label="Закрыть подсказку">×</button>
      </div>
      <div class="player-wrap" id="playerWrap">
        <div class="player" id="player"><div class="player-empty"><div>Ищу «${esc(Api.title(m))}» в каталоге AniLibria…</div></div></div>
        <button type="button" class="skip-btn" id="skipBtn" hidden></button>
      </div>
      <div class="watch-bar" id="navBar" hidden>
        <button class="btn" id="prevBtn" type="button">← Назад</button>
        <button class="btn primary" id="nextBtn" type="button">Следующая серия</button>
      </div>
      <div id="epsBox"></div>
    </div>`;

    const box = $("#player");

    // ---------- пропуск опенинга и эндинга ----------
    // Тайминги: AniLibria (точные, у части релизов) или AniSkip (по номеру MyAnimeList и серии, сверяется длина серии).
    // Кнопка появляется над плеером, пока идёт заставка; «Авто-пропуск» делает это сам (работает и на весь экран, где кнопки не видно).
    const skipBtn = $("#skipBtn"), autoBtn = $("#autoSkipBtn");
    const autoOn = () => store.get("tsukimi:autoskip") === "1";
    const drawAuto = () => { autoBtn.textContent = "Авто-пропуск заставок: " + (autoOn() ? "вкл" : "выкл"); autoBtn.classList.toggle("on", autoOn()); };
    const sk = { known: { op: null, ed: null }, raw: null, set: null, done: { op: false, ed: false }, seek: null, next: null, kind: null, iv: null, toEnd: false, t: 0, dur: 0 };
    function skipReset(known, rawPromise, seek, next) {
      sk.known = known || { op: null, ed: null }; sk.raw = null; sk.set = null; sk.done = { op: false, ed: false }; sk.kind = null; sk.t = 0;
      sk.seek = seek || null; sk.next = next || null; sk.ep = null;
      skipBtn.hidden = true;
      if (rawPromise) { const mine = rawPromise; sk.pending = mine; mine.then((raw) => { if (sk.pending === mine) { sk.raw = raw; sk.set = null; } }); }
    }
    function skipTick(t, dur) {
      sk.t = t; if (dur && isFinite(dur)) sk.dur = dur;
      if (!sk.set && (sk.known.op || sk.known.ed || (sk.raw && sk.dur))) {
        // известные тайминги берём как есть, недостающие добираем из AniSkip по длине серии
        sk.set = {
          op: sk.known.op ? { ...sk.known.op, exact: true } : sk.raw && sk.dur ? Api.pickSkip(sk.raw.op, sk.dur) : null,
          ed: sk.known.ed ? { ...sk.known.ed, exact: true } : sk.raw && sk.dur ? Api.pickSkip(sk.raw.ed, sk.dur) : null,
        };
        if (!(sk.known.op && sk.known.ed) && !(sk.raw && sk.dur)) sk.set = { ...sk.set, partial: true }; // AniSkip ещё не пришёл: пересоберём позже
      }
      if (sk.set && sk.set.partial && sk.raw && sk.dur) sk.set = null; // пришли данные AniSkip — соберём заново на следующем тике
      const set = sk.set;
      if (!set) { if (!skipBtn.hidden) skipBtn.hidden = true; sk.kind = null; return; }
      let kind = null, iv = null;
      if (set.op && t >= set.op.s - 1 && t < set.op.e - 1.5) { kind = "op"; iv = set.op; }
      else if (set.ed && t >= set.ed.s - 1 && t < set.ed.e - 1.5) { kind = "ed"; iv = set.ed; }
      if (!kind) { if (!skipBtn.hidden) skipBtn.hidden = true; sk.kind = null; return; }
      sk.kind = kind; sk.iv = iv;
      sk.toEnd = kind === "ed" && (!sk.dur || iv.e >= sk.dur - 8);
      const label = kind === "op" ? "Пропустить опенинг" : sk.toEnd && sk.next ? "Следующая серия" : "Пропустить эндинг";
      if (skipBtn.textContent !== label) skipBtn.textContent = label;
      skipBtn.hidden = false;
      if (autoOn() && !sk.done[kind] && iv.exact) { sk.done[kind] = true; skipAct(true); }
    }
    function skipAct(auto) {
      if (!sk.kind || !sk.iv) return;
      const kind = sk.kind;
      if (kind === "ed" && sk.toEnd && sk.next) { skipBtn.hidden = true; sk.next(); if (auto) toast("Эндинг пропущен"); return; }
      const target = kind === "ed" && sk.dur ? Math.min(sk.iv.e, sk.dur - 1) : sk.iv.e;
      if (sk.seek) sk.seek(target);
      skipBtn.hidden = true;
      sk.done[kind] = true;
      if (auto) toast(kind === "op" ? "Опенинг пропущен" : "Эндинг пропущен");
    }
    skipBtn.onclick = () => skipAct(false);
    autoBtn.onclick = () => { store.set("tsukimi:autoskip", autoOn() ? "0" : "1"); drawAuto(); toast(autoOn() ? "Опенинг и эндинг будут пропускаться сами" : "Автопропуск выключен"); skipTick(sk.t, sk.dur); };
    drawAuto();

    const note = (html) => { if (box.isConnected) box.innerHTML = `<div class="player-empty"><div>${html}</div></div>`; };
    const overlay = (text) => { if (box.isConnected) box.insertAdjacentHTML("beforeend", `<div class="player-note">${esc(text)}</div>`); };

    const trailerId = m.trailer && String(m.trailer.site).toLowerCase() === "youtube" && /^[\w-]{6,20}$/.test(m.trailer.id) ? m.trailer.id : null;
    const R = cfg.RESERVE || {};
    const reserveOn = !!(R.enabled && m.idMal);
    const gateOn = !!(/^https:\/\//.test(cfg.WORKER_URL || "") && m.idMal); // Kodik: сначала напрямую, затем через шлюз

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
      if (Store.user) {
        Store.addHistory(m, resEp).catch((err) => toast(err.message));
        const lib0 = Store.get(m.id) || {};
        if (!lib0.status || lib0.status === "planned") Store.save(m, { status: "watching", episode: resEp }).catch(() => {});
      }
    }
    // ---- Источник 2: Kodik через шлюз на Cloudflare Workers ----
    const gateCache = (window.__gateCache = window.__gateCache || new Map());
    // Сначала спрашиваем Kodik напрямую: его API открыт для браузера и доступен без VPN, а адрес workers.dev у части провайдеров закрыт.
    // Если напрямую не вышло — идём через наш шлюз.
    async function kodikDirect() {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch("https://kodik-api.com/get-player?token=447d179e875efe44217f20d1ee2146be&shikimoriID=" + encodeURIComponent(m.idMal), { signal: ctrl.signal });
        if (!res.ok) return null;
        const j = await res.json();
        if (!j || !j.link || !(j.found || j.allowed)) return null;
        return String(j.link).replace(/^(https?:)?\/\/[^/]+\//, "https://aniqit.com/");
      } catch (e) { return null; } finally { clearTimeout(t); }
    }
    async function fetchGate() {
      if (gateCache.has(m.idMal)) return gateCache.get(m.idMal);
      const direct = await kodikDirect();
      if (direct) {
        let url = direct;
        if (cfg.KODIK_HOST && /^https:\/\//.test(cfg.KODIK_HOST)) url = url.replace(/^https:\/\/[^/]+\//, cfg.KODIK_HOST.replace(/\/?$/, "/"));
        gateCache.set(m.idMal, { url });
        return { url };
      }
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
    let kodikFrame = null, kodikEp = null, kodikSave = 0, kodikStartEp = null;
    function resumeNote(text, onRestart) {
      const old = $("#resumeBar"); if (old) old.remove();
      const bar = document.createElement("div");
      bar.id = "resumeBar"; bar.className = "resume";
      bar.innerHTML = `<span>${text}</span><button type="button" class="btn" id="resumeRestart">С начала</button>`;
      box.parentNode.insertBefore(bar, box);
      bar.querySelector("#resumeRestart").onclick = () => { bar.remove(); onRestart(); };
      setTimeout(() => bar.isConnected && bar.remove(), 12000);
    }
    const onKodikMsg = (ev) => {
      if (tab !== 2 || !kodikFrame || ev.source !== kodikFrame.contentWindow) return;
      const d = typeof ev.data === "string" ? (() => { try { return JSON.parse(ev.data); } catch (e) { return null; } })() : ev.data;
      if (!d || !d.key) return;
      // заставки: серия берётся из событий Kodik, а пока их нет — та, с которой мы открыли плеер (обычно первая)
      const kodikSkipFor = (ep) => {
        if (String(sk.ep) === String(ep)) return;
        skipReset(null, Api.skipTimes(m.idMal, ep), (t) => { if (kodikFrame && kodikFrame.contentWindow) kodikFrame.contentWindow.postMessage({ key: "kodik_player_api", value: { method: "seek", seconds: t } }, "*"); }, null);
        sk.ep = String(ep);
      };
      if (d.key === "kodik_player_duration_update" && Number(d.value) > 0) {
        sk.dur = Number(d.value);
        kodikSkipFor(kodikEp || kodikStartEp || 1);
      } else if (d.key === "kodik_player_time_update") {
        kodikSkipFor(kodikEp || kodikStartEp || 1);
        skipTick(Number(d.value) || 0, sk.dur);
      }
      if (d.key === "kodik_player_current_episode" && d.value) {
        const prevEp = kodikEp;
        kodikEp = d.value.episode || kodikEp;
        if (String(kodikEp) !== String(prevEp)) {
          if (String(sk.ep) !== String(kodikEp)) sk.dur = 0;
          kodikSkipFor(kodikEp);
        }
        if (Store.user && kodikEp) {
          const lib = Store.get(m.id) || {};
          const patch = { episode: Number(kodikEp) };
          if (!lib.status || lib.status === "planned") patch.status = "watching";
          Store.save(m, patch).catch(() => {});
          Store.addHistory(m, kodikEp).catch(() => {});
        }
      } else if (d.key === "kodik_player_time_update" && Number(d.value) > 5) {
        const now = Date.now();
        if (now - kodikSave < 5000) return;
        kodikSave = now;
        Pos.set(m.id, kodikEp || "", d.value, "kodik", m);
      }
    };
    window.addEventListener("message", onKodikMsg);
    window.addEventListener("hashchange", () => window.removeEventListener("message", onKodikMsg), { once: true });
    function drawGate() {
      $("#epTitle").textContent = "Источник 2 · Kodik";
      note("Ищу плеер…");
      fetchGate().then((r) => {
        if (tab !== 2 || !box.isConnected) return; // пока ждали, вкладку или страницу сменили
        if (!r.url) return note(`Плеер временно недоступен<div class="muted" style="font-size:12px;margin-top:8px">${esc(r.err)}</div>`);
        const sb = cfg.WORKER_SANDBOX ? ` sandbox="${esc(cfg.WORKER_SANDBOX)}"` : "";
        // Kodik сам сообщает странице минуту и серию через postMessage — по ним запоминаем место и продолжаем
        const saved = Pos.get(m.id);
        let src = r.url;
        kodikStartEp = saved && saved.src === "kodik" && saved.ep ? saved.ep : null;
        if (saved && saved.src === "kodik" && saved.t > 10) {
          src += (src.includes("?") ? "&" : "?") + (saved.ep ? "episode=" + encodeURIComponent(saved.ep) + "&" : "") + "start_from=" + saved.t;
          resumeNote("Продолжаем " + (saved.ep ? "серию " + esc(saved.ep) + " " : "") + "с " + mmss(saved.t), () => { Pos.clear(m.id); drawGate(); });
        } else if (parseInt(epParam, 10) > 1 && (m.episodes || 2) !== 1) {
          // открыли конкретную серию по ссылке (из истории, «Продолжить»): просим Kodik начать с неё
          src += (src.includes("?") ? "&" : "?") + "episode=" + parseInt(epParam, 10);
        }
        box.innerHTML = `<iframe src="${esc(src)}" title="Kodik"${sb} allowfullscreen="true" allow="autoplay *; fullscreen *"></iframe>`;
        kodikFrame = box.querySelector("iframe");
        if (Store.user) {
          const lib0 = Store.get(m.id) || {};
          if (!lib0.status || lib0.status === "planned") Store.save(m, { status: "watching" }).catch(() => {});
        }
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
      skipReset(null, null, null, null);
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
      Pos.set(m.id, eps[idx].ordinal, video.currentTime, "native", m);
    });
    video.addEventListener("pause", () => { if (video.currentTime > 5 && !(video.duration && video.duration - video.currentTime < 30)) Pos.set(m.id, eps[idx].ordinal, video.currentTime, "native", m); });
    video.addEventListener("ended", () => Pos.clear(m.id));
    video.addEventListener("timeupdate", () => skipTick(video.currentTime, video.duration));
    video.addEventListener("loadedmetadata", () => skipTick(video.currentTime || 0, video.duration));
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
      // заставки: свои тайминги серии от AniLibria, недостающие — из AniSkip
      sk.dur = Number(e.duration) || 0;
      skipReset({ op: e.op || null, ed: e.ed || null }, e.op && e.ed ? null : Api.skipTimes(m.idMal, e.ordinal), (t) => { video.currentTime = t; }, last ? null : () => nextBtn.click());
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
    const fmt = (iso) => { try { return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
    const stagger = stag;
    const emptyText = {
      liked: "Нажми «♡ Нравится» на странице аниме, и оно появится здесь.",
      watching: "Здесь будет то, что ты смотришь сейчас. Откроешь серию, и аниме добавится само.",
      planned: "Сюда попадает то, что ты собираешься посмотреть. Выбери «В планах» на странице аниме.",
      completed: "Отметь уже просмотренное, и по нему подберутся рекомендации.",
      dropped: "Пока ничего не брошено.",
      history: "Открытые серии появятся здесь.",
    };
    let body;
    if (tab === "history") {
      body = hist.length
        ? `<div class="grid lib-grid">${hist.map((h, i) => stagger(`<a class="card" href="#/watch/${h.anime_id}/${h.episode}">
            <div class="poster">${h.poster ? `<img src="${esc(h.poster)}" alt="" loading="lazy">` : ""}</div>
            <div class="name">${esc(h.title || "Аниме")}</div>
            <div class="sub">Серия ${esc(h.episode)}${h.position_sec > 10 ? " · " + mmss(h.position_sec) : ""}</div>
            <div class="sub">${esc(fmt(h.watched_at))}</div></a>`, i)).join("")}</div>`
        : "";
    } else {
      const list = all.filter((r) => (tab === "liked" ? r.liked : r.status === tab)).sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
      body = list.length ? `<div class="grid lib-grid">${list.map((r, i) => stagger(libCard(r, r.episode ? "Серия " + r.episode : ""), i)).join("")}</div>` : "";
    }
    if (!body) {
      body = `<div class="lib-empty"><div class="moon"></div><p>${esc(emptyText[tab] || "Пока пусто.")}</p>
        <div class="actions" style="justify-content:center"><a class="btn primary" href="#/search">Открыть каталог</a>${tab === "completed" ? `<button class="btn" type="button" id="libAdd">Добавить просмотренное</button>` : ""}</div></div>`;
    }
    // «продолжить»: последняя открытая серия
    const last = hist[0];
    const lp = last && Store.position(last.anime_id);
    const cont = last ? `<a class="lib-cont" href="#/watch/${last.anime_id}/${last.episode}">
        ${last.poster ? `<img src="${esc(last.poster)}" alt="">` : ""}
        <div><span class="muted">Продолжить просмотр</span><b>${esc(last.title || "Аниме")}</b>
        <span class="muted">Серия ${esc(last.episode)}${lp && lp.ep === String(last.episode) ? " · с " + mmss(lp.t) : ""}</span></div><i>▶</i></a>` : "";
    app.innerHTML = `<div class="wrap lib">
      <div class="lib-head"><h1>Библиотека</h1>
        <div class="lib-stats">
          <span title="Сколько тайтлов с отметкой статуса или «Нравится». Каждый сезон считается отдельно."><b>${all.filter((r) => r.status || r.liked).length}</b> в библиотеке</span>
          <span title="Тайтлы со статусом «Просмотрено»"><b>${all.filter((r) => r.status === "completed").length}</b> просмотрено</span>
          <span title="Тайтлы, которым ты поставил «Нравится»"><b>${all.filter((r) => r.liked).length}</b> нравится</span>
          <span title="Сколько серий открыто за всё время"><b>${hist.length}</b> серий в истории</span>
        </div></div>
      ${cont}
      <div class="lib-tabs" role="tablist">${tabs.map(([k, v]) => `<a role="tab" class="${k === tab ? "on" : ""}" href="#/library?tab=${k}">${v}<em>${count(k)}</em></a>`).join("")}</div>
      <div class="lib-body">${body}</div>
    </div>`;
    const add = $("#libAdd"); if (add) add.onclick = openAddAnime;
  }

  async function pageFriends() {
    if (!Store.user) return (location.hash = "#/login");
    if (Store.mode !== "cloud") {
      app.innerHTML = `<div class="wrap"><div class="empty">Друзья появятся, когда подключишь облачный режим (Supabase). Пошаговая инструкция есть в README.</div></div>`;
      return;
    }
    loading();
    const render = async () => {
      const fs = await Store.friendships();
      if (!fs.ready) {
        app.innerHTML = `<div class="wrap"><h1 style="font-size:26px">Друзья</h1><div class="empty" style="margin-top:20px">Друзья ещё настраиваются на сервере. Загляни чуть позже.</div></div>`;
        return;
      }
      const rows = await Store.friends(fs.friends.map((f) => f.id)).catch(() => []);
      const person = (p, btns) => `<div class="fr-row"><span class="fr-av">${esc((Array.from(p.name)[0] || "?").toUpperCase())}</span><b>${esc(p.name)}</b><span class="fr-btns">${btns}</span></div>`;
      const incoming = fs.incoming.length ? `<h2 class="fr-h">Заявки в друзья</h2><div class="fr-list">${fs.incoming.map((p) => person(p, `<button class="btn primary" data-acc="${p.fid}">Принять</button><button class="btn" data-del="${p.fid}">Отклонить</button>`)).join("")}</div>` : "";
      const mine = fs.friends.length ? `<h2 class="fr-h">Мои друзья · ${fs.friends.length}</h2><div class="fr-list">${fs.friends.map((p) => person(p, `<button class="btn" data-del="${p.fid}">Удалить</button>`)).join("")}</div>` : "";
      const out = fs.outgoing.length ? `<div class="muted" style="margin-top:12px">Ждут ответа: ${fs.outgoing.map((p) => esc(p.name) + ` <a href="#" data-del="${p.fid}">отменить</a>`).join(", ")}</div>` : "";
      const feed = !fs.friends.length
        ? `<div class="empty">Добавь друга по имени — и тут появится, что он смотрит.</div>`
        : rows.length
          ? `<div class="friend-list">${rows.map((r) => `<a class="friend" href="#/anime/${r.anime_id}">
          ${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy">` : ""}
          <div><b>${esc(r.friend)}</b> ${r.liked ? "поставил(а) ♥" : r.episode ? "смотрит серию " + esc(r.episode) : STATUS[r.status] ? "добавил(а) в «" + STATUS[r.status] + "»" : "открыл(а)"}
          <div>${esc(r.title)}</div></div></a>`).join("")}</div>`
          : `<div class="empty">Друзья пока ничего не отметили.</div>`;
      app.innerHTML = `<div class="wrap"><h1 style="font-size:26px">Друзья</h1>
        <div class="fr-add"><input id="frQ" placeholder="Найти друга по имени" autocomplete="off"><div id="frRes" class="fr-list"></div></div>
        ${incoming}${mine}${out}
        <h2 class="fr-h">Активность друзей</h2>${feed}</div>`;
      const act = async (fn, msg) => { try { await fn(); } catch (e) { toast(e.message || msg); } render(); };
      app.querySelectorAll("[data-acc]").forEach((b) => (b.onclick = () => act(() => Store.friendAccept(b.dataset.acc))));
      app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); act(() => Store.friendRemove(b.dataset.del)); }));
      let t; const q = $("#frQ");
      q.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
        const known = new Set([...fs.friends, ...fs.incoming, ...fs.outgoing].map((p) => p.id));
        const res = (await Store.findUsers(q.value)).filter((p) => !known.has(p.id));
        $("#frRes").innerHTML = res.length ? res.map((p) => person(p, `<button class="btn primary" data-add="${p.id}">Добавить</button>`)).join("") : q.value.trim() ? `<div class="muted">Никого не нашлось</div>` : "";
        $("#frRes").querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => act(async () => { await Store.friendRequest(b.dataset.add); toast("Заявка отправлена"); })));
      }, 250); };
    };
    await render();
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
      <p class="note">«Не открывается» значит, что соединение обрывается или блокируется до ответа сервиса.</p>
      <h2 style="margin-top:34px">Реальные запросы сайта</h2>
      <p class="muted">Те же запросы, которые делает сайт. Здесь видно, чем именно они заканчиваются (код ответа или ошибка).</p>
      <div class="friend-list" id="apiChecks" style="margin-top:16px"></div></div>`;
    // реальные запросы с кодом ответа
    const W = (window.APP_CONFIG || {}).WORKER_URL || "";
    const wk = (q) => W.replace(/\/$/, "") + "/" + q;
    const probe = async (label, fn) => {
      const row = document.createElement("div");
      row.className = "friend";
      row.innerHTML = `<div><b>${esc(label)}</b> <span class="muted">проверяю…</span></div>`;
      const box = $("#apiChecks");
      if (!box) return;
      box.appendChild(row);
      const t0 = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let res = null, err = "";
      try { res = await fn(ctrl.signal); } catch (e) { err = e.name === "AbortError" ? "нет ответа за 10 секунд" : e.message; }
      clearTimeout(timer);
      const ms = Math.round(performance.now() - t0);
      const ok = res && res.ok;
      row.innerHTML = `<div><b>${esc(label)}</b> — ${ok ? `<span style="color:var(--moon)">работает</span>` : `<span style="color:var(--rose)">${esc(res ? "ответ " + res.status : err || "ошибка")}</span>`} <span class="muted">${ms} мс</span></div>`;
    };
    const gq = "query{Media(id:16498,type:ANIME){title{english}}}";
    probe("AniList напрямую (запрос каталога)", (sg) => fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: gq }), signal: sg }));
    probe("Kitsu (поиск по началу слова)", (sg) => fetch("https://kitsu.io/api/edge/anime?filter[text]=torad&page[limit]=2", { signal: sg }));
    probe("Jikan / MyAnimeList (поиск)", (sg) => fetch("https://api.jikan.moe/v4/anime?q=torad&limit=2", { signal: sg }));
    probe("AniLibria (поиск)", (sg) => fetch("https://anilibria.top/api/v1/app/search/releases?query=torad", { signal: sg }));
    if (W) {
      probe("Worker: перевод описаний", (sg) => fetch(wk("?tr=Attack%20on%20Titan&sl=en&tl=ru"), { signal: sg }));
      probe("Worker: умный поиск (ИИ)", (sg) => fetch(wk("?ai=" + encodeURIComponent("торадора")), { signal: sg }));
      probe("Worker: плеер Kodik", (sg) => fetch(wk("?id=16498"), { signal: sg }));
    }
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
      (document.documentElement.dataset.mode === "kino" ? link("#/kfind", "Каталог") : link("#/search", "Каталог")) +
      (Store.user
        ? link("#/library", "Библиотека") + link("#/friends", "Друзья") +
          `<div class="usermenu"><button id="userBtn" aria-haspopup="true" aria-expanded="false"><span class="av">${esc((Array.from(Store.user.name || "?")[0] || "?").toUpperCase())}</span><span class="un">${esc(Store.user.name)}</span><span class="car">▾</span></button>
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
    // два слоя: 1) по буквам, мгновенно (локальный индекс + подсказки каталога); 2) умный подбор по смыслу (опечатки, описание, жанры)
    let items = [], smart = [], smartState = "", timer = null, aiTimer = null, seq = 0;
    const row = (m) => {
      const done = (Store.get(m.id) || {}).status === "completed";
      return `<div class="add-row"><img src="${esc(m.coverImage && (m.coverImage.medium || m.coverImage.large))}" alt="" loading="lazy">
          <div class="add-info"><b>${esc(Api.title(m))}</b><span class="muted">${[m.seasonYear, STATUS_FORMAT[m.format] || m.format, m.episodes ? m.episodes + " эп." : ""].filter(Boolean).join(" · ")}</span></div>
          <button type="button" class="btn ${done ? "primary" : ""}" data-id="${m.id}">${done ? "✓ Просмотрено" : "Просмотрено"}</button></div>`;
    };
    const all = () => [...items, ...smart];
    const draw = () => {
      const q = $("#addQ").value.trim();
      let h = items.map(row).join("");
      if (smartState === "wait") h += `<div class="add-sec"><i class="ai-dot"></i>Подбираю по смыслу…</div>`;
      else if (smart.length) h += `<div class="add-sec">Подобрано по смыслу</div>` + smart.map(row).join("");
      if (!h) h = `<p class="muted">${q ? (smartState === "wait" ? "Ищу…" : "Ничего не найдено. Попробуй часть названия или опиши словами.") : ""}</p>`;
      res.innerHTML = h;
    };
    res.onclick = async (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      const m = all().find((x) => String(x.id) === b.dataset.id);
      if (!m) return;
      const done = (Store.get(m.id) || {}).status === "completed";
      try {
        await Store.save(m, done ? { status: null } : { status: "completed", episode: m.episodes || null });
        draw();
        toast(done ? "Убрано из просмотренного" : "Добавлено: " + Api.title(m));
      } catch (err) { toast(err.message); }
    };
    $("#addQ").oninput = (e) => {
      clearTimeout(timer); clearTimeout(aiTimer);
      const q = e.target.value.trim();
      const my = ++seq;
      smart = []; smartState = "";
      if (!q) { items = []; return draw(); }
      // слой 1: на каждую букву сразу, из локального индекса
      items = Api.localSearch(q, { limit: 12 });
      draw();
      timer = setTimeout(async () => {
        // дополняем ответом каталога
        try {
          const net = await Api.suggest(q);
          if (my !== seq) return;
          const seen = new Set(items.map((m) => m.id));
          items = [...items, ...net.filter((m) => !seen.has(m.id))].slice(0, 12);
          draw();
        } catch (err) {}
      }, 220);
      // слой 2: умный подбор, когда обычных совпадений мало или запрос описательный
      aiTimer = setTimeout(async () => {
        if (my !== seq) return;
        const S = window.Smart; const desc = S && S.parse(q).descriptive;
        if (items.length >= 6 && !desc) return;
        smartState = "wait"; draw();
        const r = await Api.aiSearch(q).catch(() => null);
        if (my !== seq) return;
        const seen = new Set(items.map((m) => m.id));
        smart = r ? r.items.filter((m) => !seen.has(m.id)).slice(0, 8) : [];
        smartState = ""; draw();
      }, 650);
    };
    $("#addQ").focus();
  }

  const setTitle = (t) => { document.title = t ? t + " · " + cfg.SITE_NAME : cfg.SITE_NAME; };
  async function route() {
    // на главной показываем чистый адрес без «#/»
    if (location.hash === "#/") { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} }
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, query] = hash.split("?");
    const parts = path.split("/").filter(Boolean);
    const params = new URLSearchParams(query || "");
    stopPlayer();
    // режим сайта: фильмы/сериалы или аниме; общие страницы (библиотека, друзья, вход) сохраняют текущий
    const KR = (window.Kino && window.Kino.ROUTES) || [];
    let mode = KR.includes(parts[0]) ? "kino" : ["anime", "watch", "search"].includes(parts[0]) || !parts.length ? "anime" : null;
    if (mode) { try { localStorage.setItem("tsukimi:mode", mode); } catch (e) {} }
    else { try { mode = localStorage.getItem("tsukimi:mode") || "anime"; } catch (e) { mode = "anime"; } }
    document.documentElement.dataset.mode = mode;
    $("#logo").textContent = mode === "kino" ? "Киноман" : cfg.SITE_NAME;
    $("#logo").setAttribute("href", mode === "kino" ? "#/kino" : "#/");
    $("#navQ").placeholder = mode === "kino" ? "Найти фильм или сериал" : "Найти аниме";
    $$("#modeSw a").forEach((a) => a.classList.toggle("on", a.dataset.m === mode));
    drawNav();
    const TITLES = { search: "Каталог", kfind: "Каталог фильмов", library: "Библиотека", friends: "Друзья", login: "Вход", diag: "Диагностика" };
    setTitle(TITLES[parts[0]] || "");
    window.scrollTo(0, 0);
    // плавное появление новой страницы (только при смене адреса, не при перерисовке)
    app.classList.add("enter");
    clearTimeout(route._t);
    route._t = setTimeout(() => app.classList.remove("enter"), 900);
    try {
      // вошёл через Google без кода приглашения: пускаем только на страницу ввода кода
      if (Store.user && Store.user.approved === false) pageInvite();
      else if (parts[0] === "kino") await window.Kino.home(app);
      else if (parts[0] === "kfind") await window.Kino.find(app, params);
      else if (parts[0] === "movie" || parts[0] === "tv") await window.Kino.detail(app, parts[0], parts[1]);
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

  // ---------- живой поиск в шапке ----------
  const form = $("#navSearch"), qIn = $("#navQ");
  const sgBox = document.createElement("div");
  sgBox.id = "suggest"; sgBox.className = "suggest"; sgBox.hidden = true;
  sgBox.setAttribute("role", "listbox");
  form.appendChild(sgBox);
  let sgSeq = 0, sgTimer = null, sgItems = [], sgSel = -1, sgQ = "";
  const hl = (text, q) => {
    const safe = esc(text);
    const words = q.split(/\s+/).filter((w) => w.length > 0).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return safe;
    try { return safe.replace(new RegExp("(" + words.map((w) => esc(w)).join("|") + ")", "ig"), "<mark>$1</mark>"); } catch (e) { return safe; }
  };
  const sgClose = () => { sgBox.hidden = true; sgSel = -1; };
  const sgPaint = (loading) => {
    const q = qIn.value.trim();
    if (!q) return sgClose();
    sgBox.hidden = false;
    sgBox.classList.toggle("busy", !!loading);
    if (!sgItems.length) {
      sgBox.innerHTML = loading
        ? [0, 1, 2].map(() => `<div class="sg-row sk"><i></i><div><b></b><span></span></div></div>`).join("")
        : `<div class="sg-empty">Ничего не нашлось по «${esc(q)}». Попробуй другое написание или часть названия.</div>`;
      return;
    }
    sgBox.innerHTML = sgItems.map((m, i) => `<a class="sg-row ${i === sgSel ? "sel" : ""}" role="option" href="#/anime/${m.id}" data-i="${i}" style="animation-delay:${i * 28}ms">
        <img src="${esc(m.coverImage && (m.coverImage.medium || m.coverImage.large))}" alt="" loading="lazy">
        <div class="sg-t"><b>${hl(Api.title(m), q)}</b><span>${esc([m.seasonYear, STATUS_FORMAT[m.format] || m.format, m.episodes ? m.episodes + " эп." : "", m.averageScore ? "★ " + (m.averageScore / 10).toFixed(1) : ""].filter(Boolean).join(" · "))}</span></div></a>`).join("")
      + `<a class="sg-all" href="#/search?q=${encodeURIComponent(q)}">Все результаты по «${esc(q)}»</a>`;
  };
  const isKino = () => document.documentElement.dataset.mode === "kino";
  // подсказки режима «Киноман»: фильмы и сериалы из TMDB
  const sgKino = async () => {
    const q = qIn.value.trim();
    if (!q) { sgItems = []; return sgClose(); }
    const my = ++sgSeq;
    sgBox.hidden = false;
    try {
      const items = await window.Kino.suggest(q);
      if (my !== sgSeq) return;
      sgItems = items.map((m) => ({ kino: true, ...m }));
      sgSel = -1;
      sgBox.innerHTML = items.length
        ? items.map((m, i) => `<a class="sg-row" role="option" href="${m.href}" data-i="${i}" style="animation-delay:${i * 28}ms"><img src="${esc(m.img)}" alt="" loading="lazy"><div class="sg-t"><b>${hl(m.title, q)}</b><span>${esc(m.sub)}</span></div></a>`).join("") + `<a class="sg-all" href="#/kfind?q=${encodeURIComponent(q)}">Все результаты по «${esc(q)}»</a>`
        : `<div class="sg-empty">Ничего не нашлось по «${esc(q)}». Попробуй другое написание.</div>`;
    } catch (e) {
      if (my !== sgSeq) return;
      sgItems = [];
      sgBox.innerHTML = `<div class="sg-empty">Каталог сейчас не отвечает. Подожди пару секунд.</div>`;
    }
  };
  const sgRun = async () => {
    if (isKino()) return sgKino();
    const q = qIn.value.trim();
    if (!q) { sgItems = []; return sgClose(); }
    sgQ = q;
    const my = ++sgSeq;
    // сначала мгновенно из локального индекса, потом дополняем ответом из сети
    const loc = Api.localSearch(q, { limit: 8 });
    if (loc.length) { sgItems = loc; sgSel = -1; sgPaint(true); } else sgPaint(true);
    // локальный индекс уже дал достаточно подсказок: не нагружаем сеть (у AniList лимит запросов)
    if (loc.length >= 6) { sgPaint(false); return; }
    try {
      const net = await Api.suggest(q);
      if (my !== sgSeq) return;
      const seen = new Set(loc.map((m) => m.id));
      sgItems = [...loc, ...net.filter((m) => !seen.has(m.id))].slice(0, 8);
      sgSel = -1; sgPaint(false);
    } catch (e) {
      if (my !== sgSeq) return;
      sgItems = [];
      sgBox.hidden = false;
      sgBox.innerHTML = `<div class="sg-empty">Каталог сейчас не отвечает. Подожди пару секунд и продолжи ввод.</div>`;
    }
  };
  qIn.addEventListener("input", () => {
    clearTimeout(sgTimer);
    const q = qIn.value.trim();
    if (!q) { sgSeq++; sgItems = []; return sgClose(); }
    if (isKino()) { sgTimer = setTimeout(sgRun, 280); return; }
    // локальные подсказки показываем на каждую букву сразу, запрос в сеть — с небольшой паузой
    const loc = Api.localSearch(q, { limit: 8 });
    if (loc.length) { sgItems = loc; sgSel = -1; sgPaint(true); }
    sgTimer = setTimeout(sgRun, 220);
  });
  qIn.addEventListener("focus", () => { if (qIn.value.trim() && sgItems.length && !isKino()) sgPaint(false); });
  qIn.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { sgClose(); qIn.blur(); }
    else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !sgBox.hidden && sgItems.length) {
      e.preventDefault();
      sgSel = (sgSel + (e.key === "ArrowDown" ? 1 : -1) + sgItems.length) % sgItems.length;
      sgPaint(false);
      const el = sgBox.querySelector(".sg-row.sel"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }
  });
  sgBox.addEventListener("click", (e) => { if (e.target.closest("a")) { sgClose(); qIn.blur(); } });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) sgClose(); });
  window.addEventListener("hashchange", sgClose);
  form.onsubmit = (e) => {
    e.preventDefault();
    const q = qIn.value.trim();
    if (sgSel >= 0 && sgItems[sgSel]) { location.hash = sgItems[sgSel].kino ? sgItems[sgSel].href : "#/anime/" + sgItems[sgSel].id; sgClose(); qIn.blur(); return; }
    if (isKino()) { location.hash = q ? "#/kfind?q=" + encodeURIComponent(q) : "#/kfind"; sgClose(); qIn.blur(); return; }
    location.hash = q ? "#/search?q=" + encodeURIComponent(q) : "#/search";
    sgClose();
    qIn.blur();
  };

  // ---------- ряды: перетаскивание мышью и стрелки ----------
  function enhanceRows() {
    app.querySelectorAll(".row:not(.enh)").forEach((row) => {
      row.classList.add("enh");
      const wrap = document.createElement("div");
      wrap.className = "row-wrap";
      row.parentNode.insertBefore(wrap, row);
      wrap.appendChild(row);
      wrap.insertAdjacentHTML("beforeend", `<button type="button" class="row-btn prev" aria-label="Назад">‹</button><button type="button" class="row-btn next" aria-label="Дальше">›</button>`);
      const prev = wrap.querySelector(".prev"), next = wrap.querySelector(".next");
      const upd = () => {
        prev.classList.toggle("off", row.scrollLeft < 8);
        next.classList.toggle("off", row.scrollLeft + row.clientWidth >= row.scrollWidth - 8);
        wrap.classList.toggle("at-end", row.scrollLeft + row.clientWidth >= row.scrollWidth - 8);
      };
      // картинки в ряду грузим сразу (иначе при пролистывании на секунду видны пустые заглушки-полосы)
      row.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = "eager"; im.decoding = "async"; });
      // пока ряд листается, отключаем эффекты наведения: карточки под курсором не мигают
      let stT = null;
      row.addEventListener("scroll", () => { row.classList.add("scrolling"); clearTimeout(stT); stT = setTimeout(() => row.classList.remove("scrolling"), 180); }, { passive: true });
      row.addEventListener("scroll", upd, { passive: true });
      setTimeout(upd, 60); setTimeout(upd, 600);
      const step = () => Math.max(240, row.clientWidth * 0.85);
      prev.onclick = () => row.scrollBy({ left: -step(), behavior: "smooth" });
      next.onclick = () => row.scrollBy({ left: step(), behavior: "smooth" });
      // перетаскивание мышью (на сенсорных экранах работает обычная прокрутка пальцем)
      let down = false, sx = 0, sl = 0, moved = 0;
      row.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        down = true; moved = 0; sx = e.clientX; sl = row.scrollLeft;
      });
      // обработчики на window снимаем, когда ряд уже убран со страницы (иначе они копились бы при каждом переходе)
      const onMove = (e) => {
        if (!row.isConnected) return cleanup();
        if (!down) return;
        const dx = e.clientX - sx;
        moved = Math.max(moved, Math.abs(dx));
        if (moved > 5) { row.classList.add("dragging"); row.scrollLeft = sl - dx; }
      };
      const up = () => { if (!row.isConnected) return cleanup(); if (down) { down = false; setTimeout(() => row.classList.remove("dragging"), 0); } };
      const cleanup = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      // после перетаскивания клик по карточке не должен открывать аниме
      row.addEventListener("click", (e) => { if (moved > 5) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, true);
      row.addEventListener("dragstart", (e) => e.preventDefault());
    });
  }
  new MutationObserver(enhanceRows).observe(app, { childList: true, subtree: true });

  // заранее готовим описание, пока курсор над карточкой
  const warmed = new Set();
  const warm = (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/anime/"]');
    const id = a && (a.getAttribute("href").match(/#\/anime\/(\d+)/) || [])[1];
    if (!id || warmed.has(id)) return;
    warmed.add(id);
    // не нагружаем AniList: готовим описание, только если курсор задержался на карточке
    setTimeout(() => {
      if (!a.matches(":hover")) { warmed.delete(id); return; }
      Api.detail(id).then((d) => d && d.description && Api.translate(d.description, "d" + id)).catch(() => {});
    }, 350);
  };
  document.addEventListener("mouseover", warm);
  document.addEventListener("touchstart", warm, { passive: true });

  setTimeout(() => Api.idxWarm(), 1200); // индекс для мгновенного поиска грузится в фоне

  // у загруженного постера останавливаем анимацию заглушки (меньше нагрузка при прокрутке)
  document.addEventListener("load", (e) => { const t = e.target; if (t && t.tagName === "IMG") { const p = t.closest && t.closest(".poster"); if (p) p.classList.add("ld"); } }, true);

  // шапка становится стеклянной, когда страница прокручена
  const navEl = $("#nav");
  let lastY = 0;
  const onScroll = () => {
    const y = window.scrollY;
    navEl.classList.toggle("scrolled", y > 24);
    // на телефоне шапка уходит при прокрутке вниз и возвращается при прокрутке вверх (но не пока открыт поиск)
    // на ПК тоже: вниз — шапка прячется, вверх — возвращается; так она не наезжает на контент
    const mobile = document.documentElement.getAttribute("data-device") === "mobile";
    const typing = document.activeElement && navEl.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
    const menuOpen = !!document.querySelector("#userMenu:not([hidden])");
    if (!typing && !menuOpen && y > 120 && y > lastY + 6) navEl.classList.add("hide");
    else if (y < lastY - 6 || y <= 120 || typing || menuOpen) navEl.classList.remove("hide");
    if (Math.abs(y - lastY) > 6) lastY = y;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  window.addEventListener("hashchange", route);
  Store.init().catch((e) => toast(e.message)).finally(route);
})();
