// Хранилище пользователя: лайки, статусы, история.
// Облачный режим (Supabase) — если заполнены ключи в config.js, иначе локальный (localStorage).
(function () {
  const cfg = window.APP_CONFIG;
  const cloud = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = cloud ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  let rows = new Map(); // anime_id -> строка библиотеки текущего пользователя
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn());

  const S = {
    mode: cloud ? "cloud" : "local",
    user: null, // { id, name }
    onChange: (fn) => listeners.push(fn),

    all: () => [...rows.values()],
    get: (id) => rows.get(Number(id)) || null,

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

    localLogin(name) {
      name = (name || "").trim();
      if (!name) throw new Error("Введи имя.");
      localStorage.setItem("tsukimi:user", name);
      S._localLogin(name);
    },

    async signOut() {
      if (cloud) await sb.auth.signOut();
      else localStorage.removeItem("tsukimi:user");
      S.user = null;
      rows = new Map();
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
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem("tsukimi:lib:" + name) || "[]"); } catch (e) {}
      rows = new Map(saved.map((r) => [r.anime_id, r]));
      emit();
    },

    async _afterLogin(user) {
      const name = (user.user_metadata && user.user_metadata.name) || user.email.split("@")[0];
      S.user = { id: user.id, name };
      const { data, error } = await sb.from("library").select("*").eq("user_id", user.id);
      if (error) throw new Error("Не удалось загрузить данные: " + error.message);
      rows = new Map(data.map((r) => [Number(r.anime_id), r]));
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
        mal_id: anime.idMal || null,
        title: window.Api.title(anime),
        poster: anime.coverImage && anime.coverImage.large,
        genres: anime.genres || [],
        score: anime.averageScore || null,
        episodes: anime.episodes || null,
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
        localStorage.setItem("tsukimi:lib:" + S.user.name, JSON.stringify(S.all()));
      }
      return row;
    },

    async remove(animeId) {
      rows.delete(Number(animeId));
      emit();
      if (cloud) await sb.from("library").delete().eq("user_id", S.user.id).eq("anime_id", animeId);
      else localStorage.setItem("tsukimi:lib:" + S.user.name, JSON.stringify(S.all()));
    },

    // ---------- друзья (только облачный режим) ----------
    async friends() {
      if (!cloud || !S.user) return [];
      const { data, error } = await sb
        .from("library")
        .select("*, profiles(name)")
        .neq("user_id", S.user.id)
        .order("updated_at", { ascending: false })
        .limit(80);
      if (error) throw new Error(error.message);
      return data.map((r) => ({ ...r, friend: (r.profiles && r.profiles.name) || "Друг" }));
    },
  };

  window.Store = S;
})();
