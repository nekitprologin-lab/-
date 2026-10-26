// Хранилище пользователя: лайки, статусы, история.
// Облачный режим (Supabase) — если заполнены ключи в config.js, иначе локальный (localStorage).
(function () {
  const cfg = window.APP_CONFIG;
  const cloud = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  // PKCE: после входа через Google код приходит в ?code=, а не в #…, который занят адресами страниц сайта
  const sb = cloud ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { flowType: "pkce" } }) : null;

  let rows = new Map(); // anime_id -> строка библиотеки текущего пользователя
  let hist = []; // история просмотра: [{anime_id, episode, title, poster, watched_at}], новые первыми
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn());

  const S = {
    mode: cloud ? "cloud" : "local",
    user: null, // { id, name }
    onChange: (fn) => listeners.push(fn),

    all: () => [...rows.values()],
    get: (id) => rows.get(Number(id)) || null,
    history: () => hist,

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

    // Вход через Google: уводит на страницу Google и возвращает на сайт, сессию подхватит init()
    async signInWithGoogle() {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
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
      localStorage.setItem("tsukimi:user", name);
      S._localLogin(name);
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
      hist = [row, ...hist.filter((h) => !(Number(h.anime_id) === row.anime_id && Number(h.episode) === ep))].slice(0, 500);
      emit();
      if (cloud) {
        const { error } = await sb.from("history").upsert({ ...row, user_id: S.user.id }, { onConflict: "user_id,anime_id,episode" });
        if (error) throw new Error("Не удалось сохранить историю: " + error.message);
      } else {
        localStorage.setItem("tsukimi:hist:" + S.user.name, JSON.stringify(hist));
      }
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
