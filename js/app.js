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
      <div class="name">${esc(Api.title(m))}</div>
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
      <div class="name">${esc(r.title)}</div>
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
        if (p && d) p.textContent = (d.description || "").replace(/<[^>]*>/g, "");
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
          <h1>${esc(Api.title(m))}</h1>
          <div class="alt" id="ru">${m.title.romaji !== Api.title(m) ? esc(m.title.romaji) : ""}</div>
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
            <a class="btn primary" href="#/watch/${m.id}/${startEp}">${cur ? "Продолжить: серия " + cur : "Смотреть"}</a>
            <button class="btn ${lib.liked ? "liked" : ""}" id="likeBtn">${lib.liked ? "♥ Нравится" : "♡ Нравится"}</button>
            <select class="select" id="statusSel" aria-label="Статус">
              <option value="">Не в списке</option>
              ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${lib.status === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </div>
          <div class="desc" id="desc">${esc((m.description || "Описания пока нет.").replace(/<[^>]*>/g, ""))}</div>
        </div>
      </div>
      <div class="wrap" style="padding-top:0">
        ${total ? section("Серии", `<div class="eps">${epsHtml}</div>`) : ""}
        ${relations.length ? section("Связанное", `<div class="row">${relations.map((e) => card({ ...e.node, genres: [], averageScore: null, episodes: null })).join("")}</div>`) : ""}
        ${recs.length ? section("Похожее", `<div class="row">${recs.map(card).join("")}</div>`) : ""}
      </div>
    </div>`;

    // русское название и описание подтягиваются, если Shikimori доступен
    Api.russian(m.idMal).then((r) => {
      if (!r || !$("#ru")) return;
      if (r.name) $("#ru").textContent = r.name;
      if (r.description) $("#desc").textContent = r.description;
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

  // ---------- Kinobox ----------
  const KINOBOX_JS = "https://on.kinohub.vip/kinobox.min.js"; // по умолчанию; у источника можно задать свой script

  function kinoboxError(box) {
    box.innerHTML = `<div class="player-empty"><div>Kinobox не загрузился. Либо адрес скрипта недоступен из твоей сети, либо сервис изменил свой код.<br>Попробуй источник «Kinobox (напрямую)» или открой <a href="#/diag" style="text-decoration:underline">проверку доступности</a>.</div></div>`;
  }

  // Режим «напрямую»: скрипт Kinobox подключается в саму страницу (так, как описано в его инструкции).
  function mountKinoboxDirect(box, id, scriptUrl = KINOBOX_JS) {
    box.innerHTML = `<div class="kinobox_div"></div>`;
    const el = $(".kinobox_div", box);
    const opts = { search: { shikimori: String(id) } };
    const start = () => {
      if (!el.isConnected || el.dataset.inited) return;
      el.dataset.inited = "1";
      try {
        if (typeof window.kbox === "function") window.kbox(".kinobox_div", opts);
        else if (typeof window.Kinobox === "function") new window.Kinobox(".kinobox_div", opts).init();
        else throw new Error("Kinobox API не найден");
      } catch (e) {
        return kinoboxError(box);
      }
      setTimeout(() => {
        if (el.isConnected && !el.children.length)
          box.insertAdjacentHTML("beforeend", `<div class="player-note">Kinobox открылся, но за 8 секунд ничего не показал. Плееры внутри него, скорее всего, недоступны из твоей сети.</div>`);
      }, 8000);
    };
    let s = document.querySelector("script[data-kinobox]");
    if (s && s.dataset.state === "loaded") return start();
    if (s && s.dataset.state === "error") return kinoboxError(box);
    if (!s) {
      s = document.createElement("script");
      s.src = scriptUrl;
      s.async = true;
      s.dataset.kinobox = "1";
      s.dataset.state = "loading";
      s.addEventListener("load", () => (s.dataset.state = "loaded"));
      s.addEventListener("error", () => (s.dataset.state = "error"));
      document.head.appendChild(s);
    }
    s.addEventListener("load", start, { once: true });
    s.addEventListener("error", () => kinoboxError(box), { once: true });
  }

  // Режим «изолированно»: виджет живёт в рамке без доступа к странице, твоим аккаунтам и данным сайта.
  // Внутри рамки видны сообщения, если скрипт не загрузился, упал или ничего не показал.
  function mountKinoboxIsolated(box, id, scriptUrl = KINOBOX_JS) {
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;color:#aaa;font:14px sans-serif}.kinobox_div{width:100%;height:100%}
#kb_log{position:absolute;left:8px;right:8px;bottom:8px;padding:10px 12px;background:#1b1a3a;color:#f3e3a1;border-radius:8px;line-height:1.4}</style>
<script>
function kbLog(t){var d=document.getElementById("kb_log");if(!d){d=document.createElement("div");d.id="kb_log";document.body.appendChild(d);}d.textContent=t;}
window.onerror=function(m){kbLog("Ошибка в скрипте Kinobox: "+m);};
<\/script></head>
<body><div class="kinobox_div"></div>
<script src="${scriptUrl}" onerror="kbLog('Скрипт Kinobox не загрузился: адрес скрипта недоступен из твоей сети или больше не существует.')"><\/script>
<script>
(function () {
  var o = { search: { shikimori: ${JSON.stringify(String(id))} } };
  function go() {
    try {
      if (typeof kbox === "function") kbox(".kinobox_div", o);
      else if (typeof Kinobox === "function") new Kinobox(".kinobox_div", o).init();
      else { kbLog("Скрипт Kinobox загрузился, но нужной функции в нём нет: сервис мог поменять код."); return; }
    } catch (e) { kbLog("Kinobox выдал ошибку: " + e.message); return; }
    setTimeout(function () {
      if (!document.querySelector(".kinobox_div").children.length) kbLog("Kinobox открылся, но за 8 секунд ничего не показал. Плееры внутри него, скорее всего, недоступны из твоей сети.");
    }, 8000);
  }
  if (document.readyState === "complete") go(); else window.addEventListener("load", go);
})();
<\/script></body></html>`;
    box.innerHTML = `<iframe sandbox="allow-scripts allow-presentation allow-forms" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Kinobox"></iframe>`;
    $("iframe", box).srcdoc = doc;
  }

  async function pageWatch(id, ep) {
    loading();
    const m = await Api.detail(id);
    if (!m) return fail("Аниме не найдено");
    ep = Math.max(1, Number(ep) || 1);
    const total = m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : 0);

    // запись в историю: последняя открытая серия; статус «смотрю», если ещё не задан
    if (Store.user) {
      const lib = Store.get(m.id) || {};
      const patch = { episode: ep };
      if (!lib.status || lib.status === "planned") patch.status = "watching";
      if (m.episodes && ep >= m.episodes && lib.status !== "completed") patch.status = "watching";
      Store.save(m, patch).catch((e) => toast(e.message));
    }

    // свой плеер (если задан) идёт первым, дальше источники из config.js
    let custom = "";
    try { custom = localStorage.getItem("tsukimi:player") || ""; } catch (e) {}
    const players = [...(custom ? [{ name: "Мой плеер", url: custom }] : []), ...(cfg.PLAYERS || [])];
    const src = (p) => (p.url || "").replace("{mal_id}", m.idMal || "").replace("{episode}", ep);
    const hasNext = !total || ep < total;

    let eps = "";
    for (let i = 1; i <= Math.min(total, 500); i++)
      eps += `<a class="ep ${i === ep ? "cur" : i < ep ? "done" : ""}" href="#/watch/${m.id}/${i}">${i}</a>`;

    app.innerHTML = `<div class="wrap watch">
      <div class="watch-bar">
        <a class="btn" href="#/anime/${m.id}">← ${esc(Api.title(m))}</a>
        <div class="grow"><h1>Серия ${ep}</h1></div>
        ${players.length > 1 ? `<select class="select" id="playerSel" aria-label="Источник">${players.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("")}</select>` : ""}
      </div>
      <div class="player" id="player"></div>
      <div class="watch-bar">
        ${ep > 1 ? `<a class="btn" href="#/watch/${m.id}/${ep - 1}">← Назад</a>` : ""}
        ${hasNext ? `<a class="btn primary" href="#/watch/${m.id}/${ep + 1}">Следующая серия</a>` : `<button class="btn primary" id="doneBtn">Отметить просмотренным</button>`}
        <a class="btn" id="newTab" target="_blank" rel="noopener noreferrer">Открыть в новой вкладке</a>
      </div>
      <details class="help">
        <summary>Плеер не открывается?</summary>
        <p>Ошибка «сайт неожиданно разорвал соединение» значит, что сайт плеера недоступен из твоей сети. Его может блокировать провайдер, или он не пускает через VPN. Сайт Tsukimi тут ни при чём.</p>
        <ol>
          <li>Переключи «Источник» над видео: «Kinobox» и «Kinobox (напрямую)» работают по-разному.</li>
          <li>Включи или выключи VPN и обнови страницу.</li>
          <li>Вставь ссылку другого плеера ниже. В ссылке можно использовать <code>{mal_id}</code> и <code>{episode}</code>, они подставятся сами.</li>
        </ol>
        <form id="customPlayer" class="custom-player">
          <input name="url" type="url" placeholder="https://…{mal_id}…{episode}" value="${esc(custom)}" aria-label="Ссылка плеера">
          <button class="btn" type="submit">Сохранить</button>
          ${custom ? `<button class="btn" type="button" id="resetPlayer">Сбросить</button>` : ""}
        </form>
        <p class="muted">Ссылка сохраняется только в этом браузере. <a href="#/diag" style="text-decoration:underline">Проверить, какие сервисы открываются у тебя</a></p>
      </details>
      ${total ? section("Серии", `<div class="eps">${eps}</div>`) : ""}
    </div>`;

    function mount(i) {
      const p = players[i];
      const box = $("#player");
      const tab = $("#newTab");
      if (!p || !m.idMal) {
        box.innerHTML = `<div class="player-empty"><div>${!m.idMal ? "Для этого аниме нет номера MyAnimeList, плеер подключить нельзя." : "Источники видео не настроены. Добавь плеер в js/config.js."}</div></div>`;
        tab.style.display = "none";
        return;
      }
      if (p.type === "kinobox") {
        tab.style.display = "none"; // у виджета нет одной ссылки, которую можно открыть отдельно
        return p.mode === "direct" ? mountKinoboxDirect(box, m.idMal, p.script || KINOBOX_JS) : mountKinoboxIsolated(box, m.idMal, p.script || KINOBOX_JS);
      }
      tab.style.display = "";
      box.innerHTML = `<iframe src="${esc(src(p))}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="origin" title="Серия ${ep}"></iframe>`;
      tab.href = src(p);
    }
    mount(0);
    const sel = $("#playerSel");
    if (sel) sel.onchange = () => mount(Number(sel.value));

    $("#customPlayer").onsubmit = (e) => {
      e.preventDefault();
      const url = new FormData(e.target).get("url").trim();
      if (url && !/^https:\/\//i.test(url)) return toast("Ссылка должна начинаться с https://");
      try { url ? localStorage.setItem("tsukimi:player", url) : localStorage.removeItem("tsukimi:player"); } catch (err) {}
      route();
    };
    const reset = $("#resetPlayer");
    if (reset) reset.onclick = () => {
      try { localStorage.removeItem("tsukimi:player"); } catch (err) {}
      route();
    };

    const done = $("#doneBtn");
    if (done) done.onclick = async () => {
      if (!Store.user) return toast("Сначала войди");
      await Store.save(m, { status: "completed", episode: ep }).catch((e) => toast(e.message));
      toast("Отмечено просмотренным");
    };
  }

  function pageLibrary(params) {
    if (!Store.user) return (location.hash = "#/login");
    const tab = params.get("tab") || "liked";
    const all = Store.all();
    const tabs = [["liked", "Нравится"], ...Object.entries(STATUS)];
    const list = all
      .filter((r) => (tab === "liked" ? r.liked : r.status === tab))
      .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
    app.innerHTML = `<div class="wrap">
      <h1 style="font-size:26px">Моя библиотека</h1>
      <div class="chips">${tabs.map(([k, v]) => `<a class="chip ${k === tab ? "on" : ""}" href="#/library?tab=${k}">${v} · ${all.filter((r) => (k === "liked" ? r.liked : r.status === k)).length}</a>`).join("")}</div>
      <div style="margin-top:24px">${list.length ? `<div class="grid">${list.map((r) => libCard(r, r.episode ? "Серия " + r.episode : "")).join("")}</div>` : `<div class="empty">Здесь пока пусто. Найди аниме в <a href="#/search">каталоге</a> и добавь его в список.</div>`}</div>
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
    };
    draw();
  }

  // Проверка, какие сервисы открываются из сети пользователя (для случаев с блокировками и VPN).
  async function pageDiag() {
    const checks = [
      ["Каталог AniList", "https://graphql.anilist.co/"],
      ["Постеры AniList", "https://s4.anilist.co/"],
      ["Русские названия (Shikimori)", "https://shikimori.one/"],
      ["Плеер Kinobox (on.kinohub.vip)", "https://on.kinohub.vip/"],
      ["Плеер Kodik (один из источников Kinobox)", "https://kodik.info/"],
      ["Шрифты Google", "https://fonts.googleapis.com/"],
      ["Библиотека входа (jsDelivr)", "https://cdn.jsdelivr.net/"],
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
        ? link("#/library", "Библиотека") + link("#/friends", "Друзья") + `<button id="outBtn" title="Выйти">${esc(Store.user.name)} · выйти</button>`
        : link("#/login", "Войти"));
    const out = $("#outBtn");
    if (out) out.onclick = async () => { await Store.signOut(); location.hash = "#/"; route(); };
  }

  async function route() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, query] = hash.split("?");
    const parts = path.split("/").filter(Boolean);
    const params = new URLSearchParams(query || "");
    drawNav();
    window.scrollTo(0, 0);
    try {
      if (!parts.length) await pageHome();
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

  window.addEventListener("hashchange", route);
  Store.init().catch((e) => toast(e.message)).finally(route);
})();
