// Хранилище пользователя: лайки, статусы, история.
// Облачный режим (Supabase) — если заполнены ключи в config.js, иначе локальный (localStorage).
(function () {
  const cfg = window.APP_CONFIG;
  // запись в localStorage не должна ронять сайт (приватный режим, переполнение)
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const cloud = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  // PKCE: после входа через Google код приходит в ?code=, а не в #…, который занят адресами страниц сайта
  const sb = cloud ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { flowType: "pkce" } }) : null;

  let rows = new Map(); // anime_id -> строка библиотеки текущего пользователя
  let hist = []; // история просмотра: [{anime_id, episode, title, poster, watched_at}], новые первыми
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn());

  // Фильмы и сериалы лежат в тех же таблицах, что и аниме. Чтобы id не пересекались: фильм = 10 000 000 + id TMDB, сериал = 20 000 000 + id TMDB.
  const KOFF = 10000000;
  const isK = (id) => Number(id) >= KOFF;

  const S = {
    mode: cloud ? "cloud" : "local",
    KOFF,
    isKino: isK,
    kid: (type, id) => (type === "tv" ? 2 * KOFF : KOFF) + Number(id),
    kparse: (aid) => { aid = Number(aid); return aid >= 2 * KOFF ? { type: "tv", id: aid - 2 * KOFF } : { type: "movie", id: aid - KOFF }; },
    user: null, // { id, name }
    onChange: (fn) => listeners.push(fn),

    all: () => [...rows.values()].filter((r) => !isK(r.anime_id)), // только аниме
    kinoAll: () => [...rows.values()].filter((r) => isK(r.anime_id)),
    get: (id) => rows.get(Number(id)) || null,
    history: () => hist.filter((h) => !isK(h.anime_id)),
    kinoHistory: () => hist.filter((h) => isK(h.anime_id)),

    // ---------- вход ----------
    async init() {
      if (cloud) {
        const { data } = await sb.auth.getSession();
        if (data.session) await S._afterLogin(data.session.user);
      } else {
        const name = localStorage.getItem("tsukimi:user");
        if (name) S._localLogin(name);
      }
    },

    async signUp(email, password, name, invite) {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { name, invite } },
      });
      if (error) throw new Error(S._authError(error));
      if (!data.session) throw new Error("Аккаунт создан. Подтверди почту по ссылке из письма и войди.");
      await S._afterLogin(data.session.user);
    },

    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(S._authError(error));
      await S._afterLogin(data.user);
    },

    // Вход через внешний сервис (google, discord, github): уводит на его страницу и возвращает на сайт, сессию подхватит init()
    async signInWith(provider) {
      const { error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: location.origin + location.pathname },
      });
      if (error) throw new Error(S._authError(error));
    },

    // Код приглашения для тех, кто вошёл через Google
    async redeemInvite(code) {
      const { data, error } = await sb.rpc("redeem_invite", { code: String(code || "").trim() });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Неверный код приглашения.");
      S.user.approved = true;
      await S._loadData();
    },

    localLogin(name) {
      name = (name || "").trim();
      if (!name) throw new Error("Введи имя.");
      lsSet("tsukimi:user", name);
      S._localLogin(name);
    },

    // профиль вкусов и рекомендации на аккаунте (облако); если таблицы ещё нет или режим локальный, просто возвращаем null
    async tasteLoad() {
      if (!cloud || !S.user) return null;
      try {
        const { data, error } = await sb.from("taste_profiles").select("fp,top_genres,weights,recs,updated_at").eq("user_id", S.user.id).maybeSingle();
        return error ? null : data;
      } catch (e) { return null; }
    },
    async tasteSave(p) {
      if (!cloud || !S.user) return;
      try { await sb.from("taste_profiles").upsert({ user_id: S.user.id, ...p, updated_at: new Date().toISOString() }, { onConflict: "user_id" }); } catch (e) {}
    },

    async signOut() {
      if (cloud) await sb.auth.signOut();
      else localStorage.removeItem("tsukimi:user");
      S.user = null;
      rows = new Map();
      hist = [];
      emit();
    },

    _authError(e) {
      const m = (e.message || "").toLowerCase();
      if (m.includes("invalid login")) return "Неверная почта или пароль.";
      if (m.includes("invite") || m.includes("database error")) return "Неверный код приглашения.";
      if (m.includes("already")) return "Эта почта уже зарегистрирована.";
      if (m.includes("password")) return "Пароль слишком короткий (нужно минимум 6 символов).";
      return e.message;
    },

    _localLogin(name) {
      S.user = { id: "local:" + name, name };
      S.user.approved = true;
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem("tsukimi:lib:" + name) || "[]"); } catch (e) {}
      rows = new Map(saved.map((r) => [r.anime_id, r]));
      hist = [];
      try { hist = JSON.parse(localStorage.getItem("tsukimi:hist:" + name) || "[]"); } catch (e) {}
      emit();
    },

    async _afterLogin(user) {
      const meta = user.user_metadata || {};
      const name = meta.name || meta.full_name || (user.email || "user").split("@")[0];
      S.user = { id: user.id, name, approved: true };
      const { data: prof, error: pe } = await sb.from("profiles").select("name, approved").eq("id", user.id).maybeSingle();
      if (pe) throw new Error("Не удалось загрузить профиль: " + pe.message);
      if (prof) {
        S.user.name = prof.name || name;
        S.user.approved = prof.approved !== false;
      }
      if (!S.user.approved) {
        // вошёл через Google, но не ввёл код приглашения: данные не грузим, сайт попросит код
        rows = new Map();
        hist = [];
        emit();
        return;
      }
      await S._loadData();
    },

    async _loadData() {
      const id = S.user.id;
      const { data, error } = await sb.from("library").select("*").eq("user_id", id);
      if (error) throw new Error("Не удалось загрузить данные: " + error.message);
      rows = new Map(data.map((r) => [Number(r.anime_id), r]));
      const h = await sb.from("history").select("*").eq("user_id", id).order("watched_at", { ascending: false }).limit(500);
      hist = h.error ? [] : h.data; // старая схема без таблицы history не должна ломать вход
      emit();
    },

    // ---------- запись ----------
    // anime — объект из AniList; patch — что изменить: { liked, status, episode }
    async save(anime, patch) {
      if (!S.user) throw new Error("Нужно войти.");
      const prev = rows.get(anime.id) || {};
      const row = {
        ...prev,
        anime_id: anime.id,
        mal_id: anime.idMal || prev.mal_id || null,
        title: window.Api.title(anime),
        poster: (anime.coverImage && anime.coverImage.large) || prev.poster || null,
        genres: anime.genres || prev.genres || [],
        score: anime.averageScore || prev.score || null,
        episodes: anime.episodes || prev.episodes || null,
        status: prev.status || null,
        liked: !!prev.liked,
        episode: prev.episode || null,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      rows.set(anime.id, row);
      emit();
      if (cloud) {
        const { error } = await sb.from("library").upsert({ ...row, user_id: S.user.id }, { onConflict: "user_id,anime_id" });
        if (error) throw new Error("Не удалось сохранить: " + error.message);
      } else {
        lsSet("tsukimi:lib:" + S.user.name, JSON.stringify([...rows.values()]));
      }
      return row;
    },

    // Фильм или сериал: item = { type, id, title, poster_path, genres:[имена], score(0..10) }; patch = { liked, status }
    async saveKino(item, patch) {
      if (!S.user) throw new Error("Нужно войти.");
      const aid = S.kid(item.type, item.id);
      const prev = rows.get(aid) || {};
      const row = {
        ...prev,
        anime_id: aid,
        mal_id: null,
        title: item.title || prev.title || "",
        poster: item.poster_path ? "tmdb:" + item.poster_path : prev.poster || null,
        genres: item.genres || prev.genres || [],
        score: item.score ? Math.round(item.score * 10) : prev.score || null,
        episodes: null,
        status: prev.status || null,
        liked: !!prev.liked,
        episode: prev.episode || null,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      rows.set(aid, row);
      emit();
      if (cloud) {
        const { error } = await sb.from("library").upsert({ ...row, user_id: S.user.id }, { onConflict: "user_id,anime_id" });
        if (error) throw new Error("Не удалось сохранить: " + error.message);
      } else {
        lsSet("tsukimi:lib:" + S.user.name, JSON.stringify([...rows.values()]));
      }
      return row;
    },
    // История фильмов: фильм = «серия» 1, сериал = сезон * 1000 + серия
    async addHistoryKino(item, season, episode) {
      if (!S.user || !S.user.approved) return;
      const aid = S.kid(item.type, item.id);
      const ep = item.type === "tv" ? Number(season) * 1000 + Number(episode) : 1;
      if (!Number.isInteger(ep)) return;
      const row = { anime_id: aid, episode: ep, title: item.title, poster: item.poster_path ? "tmdb:" + item.poster_path : null, watched_at: new Date().toISOString() };
      hist = [row, ...hist.filter((h) => !(Number(h.anime_id) === aid && Number(h.episode) === ep))].slice(0, 500);
      emit();
      if (cloud) {
        const { error } = await sb.from("history").upsert({ ...row, user_id: S.user.id }, { onConflict: "user_id,anime_id,episode" });
        if (error) throw new Error("Не удалось сохранить историю: " + error.message);
      } else lsSet("tsukimi:hist:" + S.user.name, JSON.stringify(hist));
    },

    // История: каждая открытая серия (одна строка на аниме и серию, время обновляется при повторном просмотре)
    async addHistory(anime, episode) {
      const ep = Number(episode);
      if (!S.user || !S.user.approved || !Number.isInteger(ep)) return;
      const row = {
        anime_id: anime.id,
        episode: ep,
        title: window.Api.title(anime),
        poster: (anime.coverImage && anime.coverImage.large) || null,
        watched_at: new Date().toISOString(),
      };
      const prevRow = hist.find((h) => Number(h.anime_id) === row.anime_id && Number(h.episode) === ep);
      if (prevRow && prevRow.position_sec) { row.position_sec = prevRow.position_sec; row.source = prevRow.source || null; }
      hist = [row, ...hist.filter((h) => !(Number(h.anime_id) === row.anime_id && Number(h.episode) === ep))].slice(0, 500);
      emit();
      if (cloud) {
        const dbRow = { anime_id: row.anime_id, episode: row.episode, title: row.title, poster: row.poster, watched_at: row.watched_at };
        const { error } = await sb.from("history").upsert({ ...dbRow, user_id: S.user.id }, { onConflict: "user_id,anime_id,episode" });
        if (error) throw new Error("Не удалось сохранить историю: " + error.message);
      } else {
        lsSet("tsukimi:hist:" + S.user.name, JSON.stringify(hist));
      }
    },

    // Минута просмотра: хранится в строке истории той серии, которую смотрим (колонки position_sec и source)
    position(animeId) {
      const r = hist.find((h) => Number(h.anime_id) === Number(animeId) && h.position_sec > 0);
      return r ? { ep: String(r.episode), t: r.position_sec, src: r.source || "", at: Date.parse(r.watched_at) || 0 } : null;
    },
    async savePosition(anime, episode, sec, source) {
      const ep = Number(episode);
      if (!S.user || !S.user.approved || !Number.isInteger(ep) || ep < 1) return;
      const now = new Date().toISOString();
      const prevRow = hist.find((h) => Number(h.anime_id) === anime.id && Number(h.episode) === ep) || {};
      const row = {
        anime_id: anime.id, episode: ep, title: prevRow.title || window.Api.title(anime),
        poster: prevRow.poster || (anime.coverImage && anime.coverImage.large) || null,
        watched_at: now, position_sec: sec == null ? null : Math.floor(sec), source: source || null,
      };
      hist = [row, ...hist.filter((h) => !(Number(h.anime_id) === row.anime_id && Number(h.episode) === ep))].slice(0, 500);
      if (cloud) {
        const { error } = await sb.from("history").upsert({ ...row, user_id: S.user.id }, { onConflict: "user_id,anime_id,episode" });
        if (error) throw new Error(error.message);
      } else {
        lsSet("tsukimi:hist:" + S.user.name, JSON.stringify(hist));
      }
    },
    async clearPosition(animeId) {
      const rows2 = hist.filter((h) => Number(h.anime_id) === Number(animeId) && h.position_sec > 0);
      for (const r of rows2) {
        r.position_sec = null;
        if (cloud) await sb.from("history").update({ position_sec: null }).eq("user_id", S.user.id).eq("anime_id", r.anime_id).eq("episode", r.episode);
      }
      if (!cloud && S.user) lsSet("tsukimi:hist:" + S.user.name, JSON.stringify(hist));
    },

    async remove(animeId) {
      rows.delete(Number(animeId));
      emit();
      if (cloud) await sb.from("library").delete().eq("user_id", S.user.id).eq("anime_id", animeId);
      else lsSet("tsukimi:lib:" + S.user.name, JSON.stringify([...rows.values()]));
    },

    // ---------- друзья (только облачный режим) ----------
    // Список связей: {ready, friends:[{id,name,fid}], incoming:[...], outgoing:[...]}
    async friendships() {
      if (!cloud || !S.user) return { ready: false, friends: [], incoming: [], outgoing: [] };
      const { data, error } = await sb.from("friendships").select("id,requester,addressee,status");
      if (error) return { ready: false, friends: [], incoming: [], outgoing: [] };
      const me = S.user.id;
      const ids = [...new Set(data.map((r) => (r.requester === me ? r.addressee : r.requester)))];
      const names = {};
      if (ids.length) {
        const pr = await sb.from("profiles").select("id,name").in("id", ids);
        (pr.data || []).forEach((p) => (names[p.id] = p.name));
      }
      const mk = (r) => { const id = r.requester === me ? r.addressee : r.requester; return { fid: r.id, id, name: names[id] || "Друг" }; };
      return {
        ready: true,
        friends: data.filter((r) => r.status === "accepted").map(mk),
        incoming: data.filter((r) => r.status === "pending" && r.addressee === me).map(mk),
        outgoing: data.filter((r) => r.status === "pending" && r.requester === me).map(mk),
      };
    },
    async findUsers(q) {
      if (!cloud || !S.user || !q.trim()) return [];
      const { data } = await sb.from("profiles").select("id,name").ilike("name", "%" + q.trim().replace(/[%_]/g, "") + "%").neq("id", S.user.id).limit(8);
      return data || [];
    },
    async friendRequest(uid) {
      const { error } = await sb.from("friendships").insert({ requester: S.user.id, addressee: uid });
      if (error) throw new Error(error.code === "23505" ? "Заявка уже отправлена" : error.message);
    },
    async friendAccept(fid) { const { error } = await sb.from("friendships").update({ status: "accepted" }).eq("id", fid); if (error) throw new Error(error.message); },
    async friendRemove(fid) { const { error } = await sb.from("friendships").delete().eq("id", fid); if (error) throw new Error(error.message); },
    async friends(ids, kino) {
      if (!cloud || !S.user || !ids || !ids.length) return [];
      const { data, error } = await sb
        .from("library")
        .select("*, profiles(name)")
        .in("user_id", ids)
        .order("updated_at", { ascending: false })
        .limit(80);
      if (error) throw new Error(error.message);
      return data.filter((r) => isK(r.anime_id) === !!kino).map((r) => ({ ...r, friend: (r.profiles && r.profiles.name) || "Друг" }));
    },
  };

  window.Store = S;
})();
