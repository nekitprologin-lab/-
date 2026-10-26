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

  const LITE = `id idMal title{romaji english} coverImage{large color} averageScore episodes status format seasonYear genres bannerImage`;
  const FULL = `${LITE} description(asHtml:false) season nextAiringEpisode{episode airingAt}
    studios(isMain:true){nodes{name}} trailer{id site}`;

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

  const PAGE_Q = `query($page:Int,$perPage:Int,$search:String,$genres:[String],$year:Int,$sort:[MediaSort],$season:MediaSeason,$ids:[Int]){
    Page(page:$page,perPage:$perPage){
      pageInfo{hasNextPage}
      media(type:ANIME,isAdult:false,search:$search,genre_in:$genres,seasonYear:$year,season:$season,sort:$sort,id_in:$ids){ ${LITE} }
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
    title: (m) => (m.title && (m.title.english || m.title.romaji)) || "Без названия",

    trending: (perPage = 18) => page({ perPage, sort: ["TRENDING_DESC"] }).then((r) => r.items),
    thisSeason: (perPage = 18) => {
      const s = currentSeason();
      return page({ perPage, sort: ["POPULARITY_DESC"], season: s.season, year: s.year }).then((r) => r.items);
    },
    search: ({ q, genres, year, sort, page: p }) =>
      page({
        page: p || 1,
        search: q || undefined,
        genres: genres && genres.length ? genres : undefined,
        year: year || undefined,
        sort: [q && !sort ? "SEARCH_MATCH" : sort || "POPULARITY_DESC"],
      }),
    byGenre: (genre, perPage = 25) =>
      page({ perPage, genres: [genre], sort: ["POPULARITY_DESC"] }).then((r) => r.items),

    async detail(id) {
      const d = await gql(
        `query($id:Int){Media(id:$id,type:ANIME){ ${FULL}
          relations{edges{relationType node{ id type title{romaji english} coverImage{large} format seasonYear }}}
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

  // варианты запроса: английское и ромадзи-название, плюс без «Season 2», скобок и подзаголовка
  function queries(m) {
    const out = [];
    [m.title.english, m.title.romaji].forEach((n) => {
      if (!n) return;
      out.push(n);
      const short = n
        .replace(/\(.*?\)/g, " ")
        .replace(/\b(season\s*\d+|\d+(st|nd|rd|th)\s+season|part\s*\d+)\b/gi, " ")
        .replace(/[:\-–].*$/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (short.length > 2) out.push(short);
    });
    return [...new Set(out)];
  }

  window.Libria = {
    // -> null (нет в каталоге) | {blocked:true} | {release, episodes:[{ordinal, name, duration, hls:{1080,720,480}}]}
    async find(m) {
      const mal = Number(m.idMal);
      if (!mal) return null;
      if (cache.has(mal)) return cache.get(mal);

      let hit = null;
      for (const q of queries(m)) {
        const r = await json("/app/search/releases?query=" + encodeURIComponent(q));
        const list = Array.isArray(r) ? r : r.data || [];
        hit = list.find((x) => idsOf(x).includes(mal));
        if (hit) break;
      }

      let out = null;
      if (hit) {
        if (hit.is_blocked_by_geo || hit.is_blocked_by_copyrights) {
          out = { blocked: true };
        } else {
          const rel = await json("/anime/releases/" + hit.id);
          const episodes = (rel.episodes || [])
            .map((e) => ({
              ordinal: e.ordinal,
              name: e.name,
              duration: e.duration,
              hls: { 1080: e.hls_1080, 720: e.hls_720, 480: e.hls_480 },
            }))
            .filter((e) => e.hls[1080] || e.hls[720] || e.hls[480])
            .sort((a, b) => a.ordinal - b.ordinal);
          out = { release: { id: rel.id, name: rel.name && rel.name.main }, episodes };
        }
      }
      cache.set(mal, out); // ошибки сети не кэшируем: они вылетают выше
      return out;
    },
  };
})();
