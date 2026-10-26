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
  const FULL = `${LITE} description(asHtml:false) season nextAiringEpisode{episode airingAt}
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

  // Shikimori иногда закрыт провайдером: после первой неудачи пару минут к нему не обращаемся
  let shikiDownUntil = 0;
  async function shiki(path, ms = 3000) {
    if (Date.now() < shikiDownUntil) return null;
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
      const out = [];
      for (const part of parts.slice(0, 4)) {
        const j = await timed("https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=" + encodeURIComponent(part), 7000);
        out.push((j[0] || []).map((x) => x[0]).join(""));
      }
      const res = out.join(" ").trim();
      if (!res) return null;
      try { localStorage.setItem(TR_KEY + key, res); } catch (e) {}
      return res;
    } catch (e) {
      return null;
    }
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
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.errors) {
      const detail = json && json.errors && json.errors[0] && json.errors[0].message;
      throw new Error("AniList вернул ошибку " + res.status + (detail ? ": " + detail : ""));
    }
    cache.set(key, json.data);
    return json.data;
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

  window.Api = {
    GENRES,
    genreRu: (g) => GENRES_RU[g] || g,
    title: (m) => ruName(m) || (m.title && (m.title.english || m.title.romaji)) || "Без названия",
    // запасное (не русское) название, чтобы показать его под русским
    altTitle: (m) => (m.title && (m.title.english || m.title.romaji)) || "",
    hasCyrillic: hasCyr,
    ruByMal,
    setRu,
    ruBatch,
    translate,

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
      const base = await page({
        page: p || 1,
        search: q || undefined,
        ...vars,
        sort: [q && !sort ? "SEARCH_MATCH" : sort || "POPULARITY_DESC"],
      });
      // русский запрос: добавляем то, что нашли AniLibria и Shikimori
      if (!q || !hasCyr(q) || (p || 1) > 1) return base;
      const mals = await ruSearchMals(q).catch(() => []);
      const known = new Set(base.items.map((m) => Number(m.idMal)));
      const extra = mals.filter((x) => !known.has(x));
      if (!extra.length) return base;
      const more = await page({ perPage: 24, mals: extra, ...vars, sort: ["POPULARITY_DESC"] }).catch(() => ({ items: [] }));
      const seen = new Set(base.items.map((m) => m.id));
      return { items: [...base.items, ...more.items.filter((m) => !seen.has(m.id))], hasNext: base.hasNext };
    },
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

    // Русское название и описание с Shikimori. Если сервис недоступен — просто null.
    async russian(malId) {
      if (!malId) return null;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`https://shikimori.one/api/animes/${malId}`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const j = await res.json();
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
