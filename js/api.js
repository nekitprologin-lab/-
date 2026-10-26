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
