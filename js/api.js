// Каталог аниме: AniList GraphQL (бесплатно, без ключа, работает из браузера).
// Номер idMal совпадает с id на Shikimori, поэтому по нему же подключаются плееры.
(function () {
  const URL = "https://graphql.anilist.co";
  const cache = new Map();

  const GENRES = [
    "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mahou Shoujo", "Mecha",
    "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports",
    "Supernatural", "Thriller",
  ];
  const GENRES_RU = {
    "Action": "Экшен", "Adventure": "Приключения", "Comedy": "Комедия", "Drama": "Драма",
    "Fantasy": "Фэнтези", "Horror": "Ужасы", "Mahou Shoujo": "Махо-сёдзё", "Mecha": "Меха",
    "Music": "Музыка", "Mystery": "Детектив", "Psychological": "Психология", "Romance": "Романтика",
    "Sci-Fi": "Фантастика", "Slice of Life": "Повседневность", "Sports": "Спорт",
    "Supernatural": "Сверхъестественное", "Thriller": "Триллер", "Ecchi": "Эччи",
  };

  const LITE = `id idMal synonyms title{romaji english} coverImage{large color} averageScore episodes status format seasonYear genres bannerImage`;
  const FULL = `${LITE} description(asHtml:false) season startDate{year month day} nextAiringEpisode{episode airingAt}
    studios(isMain:true){nodes{name}} trailer{id site}`;


  // ---------- русские названия и перевод ----------
  // Русское название берём по очереди: официальное с AniLibria/Shikimori (запоминается в браузере),
  // затем русский «синоним» из самого AniList, потом английское и ромадзи.
  const RU_KEY = "tsukimi:ru";
  const ruMap = new Map();
  try { JSON.parse(localStorage.getItem(RU_KEY) || "[]").forEach(([k, v]) => ruMap.set(Number(k), v)); } catch (e) {}
  const hasCyr = (t) => /[А-Яа-яЁё]/.test(t || "");
  function setRu(mal, name) {
    mal = Number(mal);
    if (!mal || !name || !hasCyr(name) || ruMap.get(mal) === name) return;
    ruMap.set(mal, name);
    try { localStorage.setItem(RU_KEY, JSON.stringify([...ruMap].slice(-2000))); } catch (e) {}
  }
  const ruByMal = (mal) => ruMap.get(Number(mal)) || null;
  const ruName = (m) => ruByMal(m.idMal) || (m.synonyms || []).find(hasCyr) || null;

  async function timed(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  // Поиск по неполному слову: AniList ищет только по целым словам («torad» ничего не находит), а Kitsu и MyAnimeList (Jikan) ищут и по началу слова.
  // Оба источника спрашиваем одновременно, берём номера MyAnimeList и достаём сами аниме из AniList.
  const jkCache = new Map();
  const srcDown = { kitsu: 0, jikan: 0 };
  async function viaKitsu(k) {
    const j = await timed("https://kitsu.io/api/edge/anime?filter[text]=" + encodeURIComponent(k) + "&page[limit]=8&include=mappings&fields[anime]=canonicalTitle,mappings&fields[mappings]=externalSite,externalId", 4500);
    const map = new Map((j.included || []).map((x) => [x.id, x.attributes || {}]));
    return (j.data || []).map((a) => {
      const ids = ((a.relationships && a.relationships.mappings && a.relationships.mappings.data) || []).map((d) => map.get(d.id)).filter((x) => x && x.externalSite === "myanimelist/anime");
      return ids[0] ? Number(ids[0].externalId) : 0;
    }).filter(Boolean);
  }
  async function viaJikan(k) {
    const j = await timed("https://api.jikan.moe/v4/anime?sfw=true&limit=10&q=" + encodeURIComponent(k), 4500);
    return (j.data || []).map((x) => Number(x.mal_id)).filter(Boolean);
  }
  async function jikanMals(q) {
    const k = q.trim().toLowerCase();
    if (k.length < 2 || hasCyr(k)) return [];
    if (jkCache.has(k)) return jkCache.get(k);
    const run = (name, fn) => (Date.now() < srcDown[name] ? Promise.resolve([]) : fn(k).catch(() => { srcDown[name] = Date.now() + 60000; return []; }));
    const [a, b2] = await Promise.all([run("kitsu", viaKitsu), run("jikan", viaJikan)]);
    const ids = [...new Set([...a, ...b2])];
    if (ids.length) jkCache.set(k, ids);
    return ids;
  }

  // Shikimori иногда закрыт провайдером: после первой неудачи пару минут к нему не обращаемся
  let shikiDownUntil = 0;
  async function shiki(path, ms = 3000) {
    if (Date.now() < shikiDownUntil) return null;
    const w = (window.APP_CONFIG || {}).WORKER_URL;
    if (w) { // сначала через наш Worker: он работает и там, где Shikimori закрыт провайдером
      try { return await timed(w.replace(/\/$/, "") + "/?shiki=" + encodeURIComponent(path).replace(/%2F/g, "/").replace(/%3F/g, "?").replace(/%3D/g, "=").replace(/%26/g, "&").replace(/%2C/g, ","), Math.max(ms, 5000)); } catch (e) {}
    }
    try { return await timed("https://shikimori.one/api" + path, ms); } catch (e) { shikiDownUntil = Date.now() + 120000; return null; }
  }

  // русский запрос -> номера MyAnimeList из AniLibria и Shikimori (AniList сам ищет только по английским названиям и синонимам)
  async function ruSearchMals(q) {
    const libria = (window.APP_CONFIG.LIBRIA_API || "https://anilibria.top/api/v1") + "/app/search/releases?query=" + encodeURIComponent(q);
    const [a, b] = await Promise.all([
      timed(libria, 5000).catch(() => []),
      shiki("/animes?limit=12&order=popularity&search=" + encodeURIComponent(q)),
    ]);
    const out = [];
    (Array.isArray(a) ? a : a.data || []).forEach((r) => {
      const mal = Number((r.mal && r.mal.id) || (r.shikimori && r.shikimori.id));
      if (mal) { out.push(mal); setRu(mal, r.name && r.name.main); }
    });
    (Array.isArray(b) ? b : []).forEach((r) => { out.push(Number(r.id)); setRu(r.id, r.russian); });
    return [...new Set(out.filter(Boolean))].slice(0, 30);
  }

  // Запрос к сервису перевода: сначала через наш Worker (работает и там, где Google закрыт), потом напрямую
  let trDownUntil = 0;
  async function trFetch(sl, tl, q) {
    const w = (window.APP_CONFIG || {}).WORKER_URL;
    if (w) { try { const j = await timed(w.replace(/\/$/, "") + "/?tr=" + encodeURIComponent(q) + "&sl=" + sl + "&tl=" + tl, 6000); if (Array.isArray(j)) return j; } catch (e) {} }
    // напрямую Google у части провайдеров закрыт: после неудачи пять минут туда не ходим, чтобы не ждать
    if (Date.now() < trDownUntil) throw new Error("translate down");
    try { return await timed("https://translate.googleapis.com/translate_a/single?client=gtx&sl=" + sl + "&tl=" + tl + "&dt=t&q=" + encodeURIComponent(q), 3000); }
    catch (e) { trDownUntil = Date.now() + 300000; throw e; }
  }

  // Описания у AniList только английские: переводим (сервис перевода Google), результат запоминаем в браузере
  const TR_KEY = "tsukimi:tr:";
  async function translate(text, key) {
    text = String(text || "").replace(/<[^>]*>/g, "").trim();
    if (!text) return null;
    if (hasCyr(text)) return text;
    try { const c = localStorage.getItem(TR_KEY + key); if (c) return c; } catch (e) {}
    const parts = [];
    let cur = "";
    for (const sent of text.split(/(?<=[.!?…])\s+/)) {
      if ((cur + " " + sent).length > 1400 && cur) { parts.push(cur); cur = sent; } else cur = cur ? cur + " " + sent : sent;
    }
    if (cur) parts.push(cur);
    try {
      const out = await Promise.all(parts.slice(0, 4).map(async (part) => {
        const j = await trFetch("en", "ru", part);
        return (j[0] || []).map((x) => x[0]).join("");
      }));
      const res = out.join(" ").replace(/([.!?…»])(?=[А-ЯЁA-Z])/g, "$1 ").trim();
      if (!res) return null;
      try { localStorage.setItem(TR_KEY + key, res); } catch (e) {}
      return res;
    } catch (e) {
      return null;
    }
  }

  // Запасной вариант, когда русского названия нигде нет: машинный перевод английского (кэш в браузере)
  const TT_KEY = "tsukimi:trt:";
  async function translateTitles(texts) {
    const out = {};
    const need = [];
    [...new Set(texts.map((t) => String(t || "").trim()).filter((t) => t && !hasCyr(t)))].forEach((t) => {
      let c = null;
      try { c = localStorage.getItem(TT_KEY + t); } catch (e) {}
      if (c) out[t] = c; else need.push(t);
    });
    for (let i = 0; i < need.length; i += 15) {
      const chunk = need.slice(i, i + 15);
      try {
        const j = await trFetch("en", "ru", chunk.join("\n"));
        const res = (j[0] || []).map((x) => x[0]).join("").split("\n").map((x) => x.trim());
        if (res.length === chunk.length) chunk.forEach((t, k) => { if (res[k]) { out[t] = res[k]; try { localStorage.setItem(TT_KEY + t, res[k]); } catch (e) {} } });
      } catch (e) { break; }
    }
    return out;
  }

  // пачка русских названий с Shikimori для карточек (если он доступен)
  const triedRu = new Set();
  async function ruBatch(mals) {
    const todo = mals.map(Number).filter((m) => m && !ruMap.has(m) && !triedRu.has(m)).slice(0, 50);
    if (!todo.length) return;
    todo.forEach((m) => triedRu.add(m));
    const r = await shiki("/animes?limit=50&ids=" + todo.join(","));
    (Array.isArray(r) ? r : []).forEach((x) => setRu(x.id, x.russian));
  }

  async function gql(query, variables) {
    const key = JSON.stringify([query, variables]);
    if (cache.has(key)) return cache.get(key);
    let lastErr;
    // AniList ограничивает число запросов (429) и иногда отвечает медленно: ждём и повторяем, а не сдаёмся сразу
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch(URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query, variables }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          const wait = Math.min(8, Number(res.headers && res.headers.get && res.headers.get("Retry-After")) || 2 * (attempt + 1));
          lastErr = new Error("AniList перегружен (" + res.status + "), повторяю…");
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || json.errors) {
          const detail = json && json.errors && json.errors[0] && json.errors[0].message;
          throw new Error("AniList вернул ошибку " + res.status + (detail ? ": " + detail : ""));
        }
        cache.set(key, json.data);
        return json.data;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e.name === "AbortError" ? new Error("AniList долго не отвечает") : e;
        if (/вернул ошибку/.test(lastErr.message)) throw lastErr; // ошибка запроса повторять бессмысленно
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    throw lastErr || new Error("AniList недоступен");
  }

  // ---------- локальный индекс: поиск по буквам без ожидания сети ----------
  // Скачиваем ~300 самых популярных аниме один раз (хранится в браузере 3 дня) и ищем по ним мгновенно.
  const IDX_KEY = "tsukimi:idx:v2";
  let index = [];
  let idxHay = null;
  let idxPromise = null;
  const norm = (t) => String(t || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-z0-9а-я\s]/g, " ").replace(/\s+/g, " ").trim();
  function idxLoad() {
    try {
      const j = JSON.parse(localStorage.getItem(IDX_KEY) || "null");
      if (j && Array.isArray(j.items)) { index = j.items; idxHay = null; return Date.now() - j.t < 3 * 864e5; }
    } catch (e) {}
    return false;
  }
  const IDX_Q = `query($page:Int){Page(page:$page,perPage:50){media(type:ANIME,isAdult:false,sort:POPULARITY_DESC){ id idMal synonyms title{romaji english} coverImage{large} format seasonYear averageScore episodes genres status }}}`;
  function idxBuild() {
    if (idxPromise) return idxPromise;
    idxPromise = (async () => {
      const items = [];
      for (let p = 1; p <= 6; p += 2) {
        const parts = await Promise.all([p, p + 1].map((n) => gql(IDX_Q, { page: n }).then((d) => d.Page.media).catch(() => [])));
        parts.flat().forEach((m) => items.push({ ...m, synonyms: [...(m.synonyms || []).filter(hasCyr), ...(m.synonyms || []).filter((x) => !hasCyr(x))].slice(0, 8) }));
        if (!parts.flat().length) break;
      }
      if (items.length > 50) {
        index = items; idxHay = null;
        try { localStorage.setItem(IDX_KEY, JSON.stringify({ t: Date.now(), items })); } catch (e) {}
      }
    })().finally(() => { idxPromise = null; });
    return idxPromise;
  }
  function idxWarm() { if (!idxLoad()) idxBuild(); }
  // поиск по индексу: начало названия важнее начала слова, слово важнее подстроки
  function localSearch(q, { genre, year, limit = 24 } = {}) {
    const nq = norm(q);
    if (!nq || !index.length) return [];
    if (!idxHay) idxHay = index.map((m) => [m.title && m.title.english, m.title && m.title.romaji, ...(m.synonyms || []), ruByMal(m.idMal)].filter(Boolean).map(norm));
    const toks = nq.split(" ");
    const out = [];
    index.forEach((m, i) => {
      if (genre && !(m.genres || []).includes(genre)) return;
      if (year && Number(m.seasonYear) !== Number(year)) return;
      let best = 0;
      for (const h of idxHay[i]) {
        let sc = 0;
        if (h.startsWith(nq)) sc = 4;
        else if (toks.every((t) => h.split(" ").some((w) => w.startsWith(t)))) sc = 3;
        else if (h.includes(nq)) sc = 2;
        if (sc > best) best = sc;
        if (best === 4) break;
      }
      if (best) out.push([best, i, m]);
    });
    out.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    return out.slice(0, limit).map((x) => x[2]);
  }
  idxLoad();

  // ---------- умный поиск ----------
  // Сначала правила в браузере (js/smart.js): жанры, теги, год, формат, «как X» — мгновенно и без выдумок.
  // ИИ (Worker) спрашиваем только там, где правила бессильны: опечатки, русские названия, непонятные запросы.
  // Планы ИИ запоминаются в браузере на неделю: повторный запрос не ждёт сеть.
  const aiCache = new Map();
  const AIP_KEY = "tsukimi:aip:v1";
  let aipStore = {};
  try { aipStore = JSON.parse(localStorage.getItem(AIP_KEY) || "{}"); } catch (e) {}
  function aipSave(k, plan) {
    aipStore[k] = { p: plan, t: Date.now() };
    const keys = Object.keys(aipStore);
    if (keys.length > 160) keys.sort((a, b) => aipStore[a].t - aipStore[b].t).slice(0, keys.length - 160).forEach((x) => delete aipStore[x]);
    try { localStorage.setItem(AIP_KEY, JSON.stringify(aipStore)); } catch (e) {}
  }
  async function aiPlan(q) {
    const k = q.trim().toLowerCase();
    const w = (window.APP_CONFIG || {}).WORKER_URL;
    if (!k) return null;
    if (aiCache.has(k)) return aiCache.get(k);
    const st = aipStore[k];
    if (st && Date.now() - st.t < 7 * 864e5) { aiCache.set(k, st.p); return st.p; }
    if (!w) return null;
    try {
      const plan = await timed(w.replace(/\/$/, "") + "/?ai=" + encodeURIComponent(q.trim()), 8000);
      if (!plan || plan.error) return null;
      aiCache.set(k, plan);
      aipSave(k, plan);
      return plan;
    } catch (e) { return null; }
  }
  const AI_Q = `query($s:String,$g:[String],$t:[String],$y:Int,$f:MediaFormat,$sc:Int,$tr:Int){Page(perPage:30){media(type:ANIME,isAdult:false,search:$s,genre_in:$g,tag_in:$t,minimumTagRank:$tr,seasonYear:$y,format:$f,averageScore_greater:$sc,sort:POPULARITY_DESC){ ${LITE} }}}`;
  const titleOf = (m) => (m && m.title && (m.title.english || m.title.romaji)) || "";

  // подбор по жанрам/тегам/году: если ничего не нашлось, по шагам ослабляем условия (начинаем с самых «лишних»: формата, года)
  async function byPlan(plan) {
    const g = plan.genres || [], t = plan.tags || [];
    const tries = [
      { g, t, y: plan.year, f: plan.format, sc: 60 },
      { g, t, y: plan.year, sc: 60 },
      { g, t, sc: 60 },
      { t, y: plan.year, sc: 60 },          // конкретные теги («путешествия во времени») информативнее общих жанров
      { g: g.slice(0, 2), t: t.slice(0, 1), sc: 60 },
      { t: t.slice(0, 2), sc: 60 },
      { g: g.slice(0, 2), y: plan.year, sc: 60 },
      { g: g.slice(0, 1), t: t.slice(0, 1), sc: 55, tr: 30 },
      { t: t.slice(0, 1), sc: 55, tr: 30 },
      { g: g.slice(0, 1), sc: 60 },
    ];
    // Запросы идут волнами (параллельно внутри волны, чтобы было быстро): точные совпадения — первыми, слабые условия добирают до нужного количества.
    const run = (v) => {
      const vars = { g: v.g && v.g.length ? v.g : undefined, t: v.t && v.t.length ? v.t : undefined, y: v.y || undefined, f: v.f || undefined, sc: v.sc || undefined };
      if (!vars.g && !vars.t && !vars.y) return Promise.resolve([]);
      // тег должен быть выражен в аниме сильно (иначе «еда» находит всё, где один раз поели)
      if (vars.t) vars.tr = v.tr || 50;
      return gql(AI_Q, vars).then((d) => d.Page.media).catch(() => []);
    };
    const acc = [], seen = new Set();
    for (const wave of [[0, 3, 4], [1, 2, 5, 6], [7, 8, 9]]) {
      const lists = await Promise.all(wave.map((i) => run(tries[i])));
      lists.map((l, k) => [wave[k], l]).sort((a, b) => a[0] - b[0]).forEach(([, l]) => l.forEach((m) => { if (!seen.has(m.id)) { seen.add(m.id); acc.push(m); } }));
      if (acc.length >= 14) break;
    }
    return acc;
  }
  const recsOf = (name) =>
    gql(`query($s:String){Media(search:$s,type:ANIME){ id recommendations(sort:RATING_DESC,perPage:18){nodes{mediaRecommendation{ ${LITE} }}}}}`, { s: name })
      .then((d) => (d.Media.recommendations.nodes || []).map((n) => n.mediaRecommendation).filter(Boolean)).catch(() => []);

  async function aiSearch(q) {
    const S = window.Smart;
    const rules = S ? S.parse(q) : { genres: [], tags: [], descriptive: false, similar: null };
    const nWords = q.split(/\s+/).filter(Boolean).length;
    let plan = null, items = [];
    const extras = rules.genres.length || rules.tags.length || rules.year || rules.format;

    if (rules.similar) {
      // «как X»: название берём из локального индекса (быстро), латиницей — как есть, иначе спрашиваем ИИ
      let name = null;
      if (!hasCyr(rules.similar)) name = rules.similar;
      else {
        const loc = localSearch(rules.subjectStem || rules.similar, { limit: 1 })[0];
        if (loc) name = titleOf(loc);
      }
      if (!name) {
        const ai = await aiPlan(q);
        name = ai && (ai.similar_to || (ai.titles || [])[0]);
      }
      if (name) {
        plan = { titles: [], similar_to: name, genres: rules.genres, tags: rules.tags, year: rules.year, format: rules.format, src: "similar" };
        const [recs, more] = await Promise.all([recsOf(name), extras ? byPlan({ genres: rules.genres, tags: rules.tags, year: rules.year, format: rules.format }) : Promise.resolve([])]);
        // «как X, но про Y»: подборка по Y идёт вперемешку с рекомендациями к X
        const mixed = [];
        for (let i = 0; i < Math.max(recs.length, more.length) && mixed.length < 40; i++) { if (more[i]) mixed.push(more[i]); if (recs[i]) mixed.push(recs[i]); }
        items = mixed;
      }
    } else if (rules.descriptive) {
      plan = { titles: [], similar_to: null, genres: rules.genres, tags: rules.tags, year: rules.year, format: rules.format, src: "rules" };
      items = await byPlan(plan);
    }

    if (!plan || !items.length) {
      // правила не сработали (или ничего не нашли): разбор запроса ИИ
      const ai = await aiPlan(q);
      if (!ai) return plan ? { plan, items: [] } : null;
      plan = { ...ai, tags: S ? S.fixTags(ai.tags) : ai.tags, src: "ai" };
      const jobs = [];
      if (ai.similar_to) jobs.push(recsOf(ai.similar_to));
      else if ((ai.titles || []).length && nWords <= 3)
        // назвали конкретное аниме (с опечаткой или по-русски): ищем по исправленному названию
        ai.titles.slice(0, 3).forEach((tt) => jobs.push(gql(AI_Q, { s: tt }).then((d) => d.Page.media.slice(0, 6)).catch(() => [])));
      else if ((ai.genres || []).length || (ai.tags || []).length || ai.year) jobs.push(byPlan(ai));
      items = (await Promise.all(jobs)).flat();
    }
    const seen = new Set();
    items = items.filter((m) => m && !seen.has(m.id) && seen.add(m.id));
    // порядок: популярность + совпадение с запросом + вкус человека (просмотренное уходит вниз)
    try {
      const tw = window.Store && window.Store.user && S ? S.taste(window.Store.all()) : null;
      if (S && plan && plan.src !== "ai") items = S.rank(items, plan, tw);
      else if (S && tw && plan && !(plan.titles || []).length) items = S.rank(items, plan, tw);
    } catch (e) {}
    return { plan, items: items.slice(0, 18) };
  }

  const PAGE_Q = `query($page:Int,$perPage:Int,$search:String,$genres:[String],$year:Int,$sort:[MediaSort],$season:MediaSeason,$ids:[Int],$mals:[Int]){
    Page(page:$page,perPage:$perPage){
      pageInfo{hasNextPage}
      media(type:ANIME,isAdult:false,search:$search,genre_in:$genres,seasonYear:$year,season:$season,sort:$sort,id_in:$ids,idMal_in:$mals){ ${LITE} }
    }}`;

  async function page(vars) {
    const d = await gql(PAGE_Q, { page: 1, perPage: 24, ...vars });
    return { items: d.Page.media, hasNext: d.Page.pageInfo.hasNextPage };
  }

  function currentSeason() {
    const d = new Date(), m = d.getMonth();
    return { season: ["WINTER", "SPRING", "SUMMER", "FALL"][Math.floor(m / 3)], year: d.getFullYear() };
  }

  // Качественный широкий баннер: у Kitsu обложки до 3360×800, у AniList около 1900×400 (на большом экране мылятся).
  // Ищем по номеру MyAnimeList; найденное адрес запоминаем навсегда, «нет» — на сутки.
  const heroMem = new Map();
  async function heroImg(m) {
    const mal = m && m.idMal;
    if (!mal) return null;
    if (heroMem.has(mal)) return heroMem.get(mal);
    const key = "tsukimi:hero:" + mal;
    try {
      const c = JSON.parse(localStorage.getItem(key) || "null");
      if (c && (c.u || Date.now() - c.t < 864e5)) { heroMem.set(mal, c.u || null); return c.u || null; }
    } catch (e) {}
    let u = null;
    try {
      const j = await timed("https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=" + mal + "&include=item&fields[anime]=coverImage", 5000);
      const ci = (((j.included || [])[0] || {}).attributes || {}).coverImage;
      u = ci && (ci.large || ci.original) || null;
    } catch (e) { heroMem.set(mal, null); return null; }
    heroMem.set(mal, u);
    try { localStorage.setItem(key, JSON.stringify({ u, t: Date.now() })); } catch (e) {}
    return u;
  }

  window.Api = {
    heroImg,
    GENRES,
    genreRu: (g) => GENRES_RU[g] || g,
    // название остаётся английским (чтобы было понятно, о чём речь), русское — как подпись
    title: (m) => (m.title && (m.title.english || m.title.romaji)) || "Без названия",
    // запасное (не русское) название, чтобы показать его под русским
    altTitle: (m) => ruName(m) || "",
    hasCyrillic: hasCyr,
    ruByMal,
    setRu,
    ruBatch,
    translate,
    translateTitles,

    trending: (perPage = 18) => page({ perPage, sort: ["TRENDING_DESC"] }).then((r) => r.items),
    thisSeason: (perPage = 18) => {
      const s = currentSeason();
      return page({ perPage, sort: ["POPULARITY_DESC"], season: s.season, year: s.year }).then((r) => r.items);
    },
    async search({ q, genres, year, sort, page: p }) {
      const vars = {
        genres: genres && genres.length ? genres : undefined,
        year: year || undefined,
      };
      const wantJk = q && !hasCyr(q) && (p || 1) === 1;
      const [base, jk] = await Promise.all([
        page({
          page: p || 1,
          search: q || undefined,
          ...vars,
          sort: [q && !sort ? "SEARCH_MATCH" : sort || "POPULARITY_DESC"],
        }),
        wantJk ? jikanMals(q) : Promise.resolve([]),
      ]);
      if (wantJk && jk.length) {
        const known0 = new Set(base.items.map((m) => Number(m.idMal)));
        const miss = jk.filter((x) => !known0.has(x));
        if (miss.length) {
          const more0 = await page({ perPage: 24, mals: miss, ...vars, sort: ["POPULARITY_DESC"] }).catch(() => ({ items: [] }));
          const seen0 = new Set(base.items.map((m) => m.id));
          const add0 = more0.items.filter((m) => !seen0.has(m.id));
          // то, что нашлось по началу слова, показываем первым, если по целым словам почти ничего нет
          return { items: base.items.length < 4 ? [...add0, ...base.items] : [...base.items, ...add0], hasNext: base.hasNext };
        }
      }
      // русский запрос: добавляем то, что нашли AniLibria и Shikimori
      if (!q || !hasCyr(q) || (p || 1) > 1) return base;
      const mals = await ruSearchMals(q).catch(() => []);
      const known = new Set(base.items.map((m) => Number(m.idMal)));
      const extra = mals.filter((x) => !known.has(x));
      // запасной путь, не зависящий от Shikimori: переводим запрос на английский и ищем в AniList
      let en = null;
      try { const j = await trFetch("ru", "en", q); en = (j[0] || []).map((x) => x[0]).join("").trim(); } catch (e) {}
      const byEn = en && en.toLowerCase() !== q.toLowerCase()
        ? await page({ search: en, ...vars, sort: ["SEARCH_MATCH"] }).catch(() => ({ items: [] })) : { items: [] };
      const more = extra.length ? await page({ perPage: 24, mals: extra, ...vars, sort: ["POPULARITY_DESC"] }).catch(() => ({ items: [] })) : { items: [] };
      const seen = new Set(base.items.map((m) => m.id));
      const add = [...more.items, ...byEn.items].filter((m) => !seen.has(m.id) && seen.add(m.id));
      if (!add.length) return base;
      // найденное по русскому названию показываем первым
      return { items: [...more.items.filter((m) => add.includes(m)), ...base.items, ...byEn.items.filter((m) => add.includes(m))], hasNext: base.hasNext };
    },
    localSearch,
    aiSearch,
    idxWarm,
    // подсказки при вводе: короткий запрос, результат запоминается по тексту
    _sg: new Map(),
    async suggest(q) {
      const k = q.trim().toLowerCase();
      if (!k) return [];
      if (this._sg.has(k)) return this._sg.get(k);
      let items;
      if (hasCyr(k)) items = (await this.search({ q })).items.slice(0, 8);
      else {
        const [a, jk] = await Promise.all([
          gql(`query($s:String){Page(perPage:8){media(search:$s,type:ANIME,isAdult:false,sort:SEARCH_MATCH){ id idMal synonyms title{romaji english} coverImage{medium} format seasonYear averageScore episodes }}}`, { s: q.trim() }).then((d) => d.Page.media).catch(() => []),
          jikanMals(q),
        ]);
        items = a;
        const miss = jk.filter((x) => !a.some((m) => Number(m.idMal) === x));
        if (miss.length) {
          const more = await gql(`query($m:[Int]){Page(perPage:8){media(idMal_in:$m,type:ANIME,isAdult:false,sort:POPULARITY_DESC){ id idMal synonyms title{romaji english} coverImage{medium} format seasonYear averageScore episodes }}}`, { m: miss.slice(0, 8) }).then((d) => d.Page.media).catch(() => []);
          // порядок Jikan (по релевантности) сохраняем
          more.sort((x, y) => jk.indexOf(Number(x.idMal)) - jk.indexOf(Number(y.idMal)));
          items = a.length < 4 ? [...more, ...a] : [...a, ...more];
        }
        items = items.filter((m, i, arr) => arr.findIndex((z) => z.id === m.id) === i).slice(0, 8);
        if (!items.length && !a.length) { /* оба источника пусты */ }
      }
      this._sg.set(k, items);
      return items;
    },
    // подборка по жанрам/тегам с отсевом слабых оценок и рекомендации AniList к одному тайтлу (для личных рекомендаций)
    pick: ({ g, t, sc }) => gql(AI_Q, { g: g && g.length ? g : undefined, t: t && t.length ? t : undefined, sc: sc || undefined }).then((d) => d.Page.media).catch(() => []),
    recsById: (id) =>
      gql(`query($id:Int){Media(id:$id,type:ANIME){ recommendations(sort:RATING_DESC,perPage:14){nodes{mediaRecommendation{ ${LITE} }}}}}`, { id: Number(id) })
        .then((d) => (d.Media.recommendations.nodes || []).map((n) => n.mediaRecommendation).filter(Boolean)).catch(() => []),
    byGenre: (genre, perPage = 25) =>
      page({ perPage, genres: [genre], sort: ["POPULARITY_DESC"] }).then((r) => r.items),

    async detail(id) {
      const d = await gql(
        `query($id:Int){Media(id:$id,type:ANIME){ ${FULL}
          relations{edges{relationType node{ id idMal synonyms type title{romaji english} coverImage{large} format seasonYear }}}
          recommendations(sort:RATING_DESC,perPage:12){nodes{mediaRecommendation{ ${LITE} }}}
        }}`,
        { id: Number(id) }
      );
      return d.Media;
    },

    // Сезоны одной франшизы: идём по цепочке PREQUEL/SEQUEL (через фильмы тоже),
    // оставляем только сериалы. Если сезонов меньше двух — возвращаем [].
    async seasons(id) {
      const KEEP = ["TV", "TV_SHORT", "ONA"];
      const seen = new Map();
      let queue = [Number(id)];
      for (let depth = 0; depth < 8 && queue.length && seen.size < 20; depth++) {
        const q = queue.filter((x) => !seen.has(x)).slice(0, 10);
        if (!q.length) break;
        const body = q.map((x, i) => `a${i}:Media(id:${x},type:ANIME){ id idMal synonyms format status seasonYear startDate{year month day} title{romaji english} coverImage{large}
          relations{edges{relationType node{ id type }}}}`).join(" ");
        const d = await gql(`query{ ${body} }`, {}).catch(() => null);
        if (!d) break;
        queue = [];
        q.forEach((x, i) => {
          const n = d["a" + i];
          if (!n) return;
          seen.set(x, n);
          (n.relations.edges || []).forEach((e) => {
            if ((e.relationType === "PREQUEL" || e.relationType === "SEQUEL") && e.node.type === "ANIME" && !seen.has(e.node.id)) queue.push(e.node.id);
          });
        });
      }
      const key = (n) => { const s = n.startDate || {}; return (s.year || n.seasonYear || 9999) * 10000 + (s.month || 0) * 100 + (s.day || 0); };
      const list = [...seen.values()].filter((n) => KEEP.includes(n.format)).sort((a, b) => key(a) - key(b));
      if (list.length < 2 || !list.some((n) => n.id === Number(id))) return [];
      return list;
    },

    // Русское название и описание с Shikimori. Если сервис недоступен — просто null.
    async russian(malId) {
      if (!malId) return null;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const w = (window.APP_CONFIG || {}).WORKER_URL;
        let j = null;
        if (w) { try { const r = await fetch(w.replace(/\/$/, "") + "/?shiki=/animes/" + malId, { signal: ctrl.signal }); if (r.ok) j = await r.json(); } catch (e) {} }
        if (!j) {
          const res = await fetch(`https://shikimori.one/api/animes/${malId}`, { signal: ctrl.signal });
          if (!res.ok) { clearTimeout(t); return null; }
          j = await res.json();
        }
        clearTimeout(t);
        const text = (j.description || "")
          .replace(/\[\/?[a-z_]+(=[^\]]*)?\]/gi, "")
          .replace(/\s+\n/g, "\n")
          .trim();
        setRu(malId, j.russian);
        return { name: j.russian || null, description: text || null };
      } catch (e) {
        return null;
      }
    },
  };
})();

// Видео: AniLibria API v1 (публичное, без ключа). Старое v3 закрыто (ошибка 410).
// Релиз ищем по названию из AniList и сверяем по номеру MyAnimeList/Shikimori, чтобы не перепутать похожие названия.
(function () {
  const base = () => window.APP_CONFIG.LIBRIA_API || "https://anilibria.top/api/v1";
  const cache = new Map();

  async function json(path) {
    const res = await fetch(base() + path, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("AniLibria вернул ошибку " + res.status);
    return res.json();
  }

  // в ответе mal и shikimori — объекты вида {id, url, ...}; у части релизов заполнено только одно из полей
  const idsOf = (r) => ["mal", "shikimori"].map((k) => r[k] && r[k].id).filter(Boolean).map(Number);

  // Отрезаем всё после двоеточия или дефиса, номер сезона, части и скобки: «Блич: Тысячелетняя война» -> «Блич»
  function clean(n) {
    return n
      .replace(/\(.*?\)/g, " ")
      .replace(/\b(season\s*\d+|\d+(st|nd|rd|th)\s+season|part\s*\d+)\b/gi, " ")
      .replace(/(\d+\s*[-–]?\s*й?\s*сезон|сезон\s*\d+|часть\s*\d+)/gi, " ")
      .replace(/\s*[:\-–—].*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // порядок: русское название целиком, русское очищенное, потом английское и ромадзи (целиком и очищенные)
  function queries(m, ru) {
    const out = [];
    if (ru) out.push(ru, clean(ru));
    [m.title.english, m.title.romaji].forEach((n) => {
      if (!n) return;
      out.push(n, clean(n));
    });
    return [...new Set(out.filter((q) => q && q.length > 2))];
  }

  function buildOut(rel) {
    if (rel.is_blocked_by_geo || rel.is_blocked_by_copyrights) return { blocked: true };
    const episodes = (rel.episodes || [])
      .map((e) => ({
        ordinal: e.ordinal,
        name: e.name,
        duration: e.duration,
        hls: { 1080: e.hls_1080, 720: e.hls_720, 480: e.hls_480 },
      }))
      .filter((e) => e.hls[1080] || e.hls[720] || e.hls[480])
      .sort((a, b) => a.ordinal - b.ordinal);
    return { release: { id: rel.id, name: rel.name && rel.name.main }, episodes };
  }

  window.Libria = {
    // -> null (нет в каталоге) | {blocked:true} | {release, episodes:[{ordinal, name, duration, hls:{1080,720,480}}]}
    async find(m) {
      const mal = Number(m.idMal);
      if (!mal) return null;
      if (cache.has(mal)) return cache.get(mal);

      let out = null;
      const mapped = (window.APP_CONFIG.LIBRIA_MAP || {})[mal];
      if (mapped) {
        // ручное соответствие из config.js: берём релиз напрямую
        out = buildOut(await json("/anime/releases/" + encodeURIComponent(mapped)));
      } else {
        // русское название с Shikimori, но не дольше 2,5 с: без VPN этот сайт может не открываться
        const ru = await Promise.race([
          Api.russian(mal).then((r) => r && r.name).catch(() => null),
          new Promise((r) => setTimeout(() => r(null), 2500)),
        ]);
        let hit = null;
        for (const q of queries(m, ru)) {
          const r = await json("/app/search/releases?query=" + encodeURIComponent(q));
          const list = Array.isArray(r) ? r : r.data || [];
          list.forEach((x) => idsOf(x).forEach((id) => window.Api.setRu(id, x.name && x.name.main)));
          hit = list.find((x) => idsOf(x).includes(mal));
          if (hit) break;
        }
        if (hit) out = buildOut(hit.is_blocked_by_geo || hit.is_blocked_by_copyrights ? hit : await json("/anime/releases/" + hit.id));
      }
      cache.set(mal, out); // ошибки сети не кэшируем: они вылетают выше
      return out;
    },
  };
})();
