// Умный разбор запросов и вкусов — всё считается прямо в браузере, без сети, поэтому мгновенно и без «выдумок» модели.
// ИИ (Worker) подключается только там, где правила бессильны: опечатки, русские названия, «похоже на X».
(function () {
  const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

  // [жанры, теги, основы слов (префиксы слов) или фразы]. Названия жанров и тегов — ровно как в AniList.
  const LEX = [
    [["Action"], [], ["боевик", "экшен", "экшн", "сражен", "битв", "драк", "бои ", "action", "fight", "эпичн"]],
    [["Adventure"], [], ["приключен", "adventure"]],
    [["Comedy"], [], ["комед", "смешн", "юмор", "весел", "ржач", "угар", "comedy", "funny"]],
    [["Drama"], [], ["драм", "drama"]],
    [["Drama"], ["Tragedy"], ["грустн", "печальн", "трагич", "трагед", "слезн", "до слез", "sad", "tragic"]],
    [["Ecchi"], [], ["эччи", "ecchi", "фансервис"]],
    [["Fantasy"], [], ["фэнтез", "фентез", "фантази", "fantasy", "сказочн"]],
    [["Fantasy"], ["Magic"], ["магия", "магии", "магию", "магией", "магическ", "волшебств", "колдов", "magic"]],
    [["Horror"], [], ["ужас", "хоррор", "страшн", "жутк", "horror", "scary"]],
    [["Mahou Shoujo"], [], ["махо", "волшебн девочк", "magical girl"]],
    [["Mecha"], [], ["меха", "mecha", "гигантск"]],
    [["Mecha"], ["Robots"], ["робот", "robot"]],
    [["Music"], [], ["музык", "music"]],
    [["Mystery"], [], ["детектив", "тайн", "загадоч", "загадк", "расследован", "mystery"]],
    [[], ["Detective"], ["детектив", "расследован", "detective"]],
    [["Psychological"], [], ["психолог", "психо", "psycholog"]],
    [["Romance"], [], ["романт", "романс", "любов", "love", "romance", "отношен"]],
    [["Sci-Fi"], [], ["фантастик", "научн", "sci fi", "scifi", "sci-fi", "будущ"]],
    [["Sci-Fi"], ["Space"], ["космос", "космич", "space"]],
    [["Sci-Fi"], ["Cyberpunk"], ["киберпанк", "cyberpunk"]],
    [["Slice of Life"], [], ["повседнев", "slice of life", "будни"]],
    [["Slice of Life"], ["Iyashikei"], ["уютн", "спокойн", "расслабл", "умиротвор", "iyashikei", "релакс"]],
    [["Sports"], [], ["спорт", "sports"]],
    [["Sports"], ["Football"], ["футбол"]],
    [["Sports"], ["Basketball"], ["баскетбол"]],
    [["Sports"], ["Volleyball"], ["волейбол"]],
    [["Sports"], ["Tennis"], ["теннис"]],
    [["Sports"], ["Swimming"], ["плаван", "бассейн"]],
    [["Supernatural"], [], ["сверхъестеств", "мистик", "supernatural"]],
    [["Supernatural"], ["Ghost"], ["призрак", "привидени", "ghost"]],
    [["Thriller"], [], ["триллер", "напряжен", "thriller"]],
    [[], ["School"], ["школ", "учени", "урок", "школьн", "school", "академи"]],
    [[], ["Isekai"], ["исекай", "другой мир", "другом мире", "другой мире", "isekai", "попал в мир", "попаданц"]],
    [[], ["Time Manipulation"], ["путешествия во времени", "путешествие во времени", "путешествий во времени", "машина времени", "машины времени", "time travel", "временн", "про время"]],
    [[], ["Time Loop"], ["петля времени", "петли времени", "петлю времени", "time loop", "временная петля", "временной петл"]],
    [[], ["Military"], ["военн", "армия", "армии", "солдат", "military"]],
    [[], ["Vampire"], ["вампир", "vampire"]],
    [[], ["Demons"], ["демон", "demon"]],
    [[], ["Gore"], ["кровав", "жестк", "расчлен", "gore", "бескомпромисс"]],
    [[], ["Parody"], ["пародия", "пародии", "parody"]],
    [[], ["Love Triangle"], ["любовный треугольник", "любовного треугольника", "love triangle"]],
    [[], ["Female Protagonist"], ["главная героиня", "главной героиней", "женский персонаж", "female protagonist", "девушка гг", "сильная героиня"]],
    [[], ["Super Power"], ["суперсил", "суперспособност", "сверхспособност", "сверхсил", "super power", "супер сил"]],
    [[], ["Samurai"], ["самура", "samurai"]],
    [[], ["Survival"], ["выжива", "survival"]],
    [[], ["Reincarnation"], ["реинкарнац", "перерожден", "reincarnation"]],
    [[], ["Post-Apocalyptic"], ["постапокалип", "пост апокалип", "апокалипсис", "post apocalyptic"]],
    [[], ["Politics"], ["политик", "politics"]],
    [[], ["War"], ["войн", " war"]],
    [[], ["Idol"], ["идол", "idol"]],
    [[], ["Food"], ["кулинар", "готовк", "повар", "cooking", "рестора", "еда", "еде", "food"]],
    [[], ["Coming of Age"], ["взросление", "взрослени", "coming of age"]],
    [[], ["Anti-Hero"], ["антигер", "anti hero", "antihero"]],
    [[], ["Office"], ["офис", "workplace"]],
    [[], ["Martial Arts"], ["боевые искусства", "боевых искусств", "кунг-фу", "кунг фу", "карате", "martial arts"]],
    [[], ["Swordplay"], ["мечник", "мечами", "мечей", "фехтован", "swordplay"]],
    [[], ["Video Games"], ["видеоигр", "компьютерн игр", "video game"]],
    [[], ["Virtual World"], ["виртуальн", "virtual"]],
    [[], ["Philosophy"], ["философ", "philosoph"]],
    [[], ["Dystopian"], ["антиутоп", "дистопи", "dystop"]],
    [[], ["Mythology"], ["мифолог", "mytholog", "боги", "богов"]],
    [[], ["Historical"], ["историческ", "historical", "средневеков"]],
    [[], ["Shounen"], ["сенен", "сёнэн", "сёнен", "shounen", "shonen"]],
    [[], ["Seinen"], ["сейнен", "сэйнэн", "seinen"]],
    [[], ["Josei"], ["дзёсэй", "дзесей", "josei"]],
    [[], ["Shoujo"], ["сёдзё", "седзе", "shoujo", "shojo"]],
    [[], ["Monster Girl"], ["монстр девуш", "monster girl"]],
    [[], ["Pirates"], ["пират", "pirate"]],
    [[], ["Ninja"], ["ниндзя", "ninja"]],
    [[], ["Superhero"], ["супергеро", "superhero"]],
    [[], ["Boys' Love"], ["яой", "бой лав", "boys love", "boys' love"]],
    [[], ["Yuri"], ["юри", "yuri"]],
    [[], ["Female Harem"], ["гарем", "harem"]],
    [[], ["Revenge"], ["месть", "мести", "мстит", "revenge"]],
    
    [[], ["Family Life"], ["семейн", "семья", "семье", "семьи", "family"]],
    [[], ["Bullying"], ["буллинг", "травля", "травли", "bullying"]],
    [[], ["Conspiracy"], ["заговор", "conspiracy"]],
    [[], ["Crime"], ["ограблен", "heist", "преступлен", "криминал", "мафи", "gangster", "гангстер", "crime"]],
    [[], ["Dragons"], ["дракон", "dragon"]],
    [[], ["Zombie"], ["зомби", "zombie"]],
    [[], ["Alchemy"], ["алхими", "alchemy"]],
    [[], ["Band"], ["музыкальная групп", "рок групп", "band"]],
    [[], ["Board Game"], ["шахмат", "настольн игр", "board game", "chess"]],
    [[], ["Shogi"], ["сёги", "шоги", "shogi"]],
    [[], ["Mahjong"], ["маджонг", "mahjong"]],
    [["Sports"], ["Baseball"], ["бейсбол", "baseball"]],
    [["Sports"], ["Boxing"], ["бокс", "boxing"]],
    [["Sports"], ["Golf"], ["гольф", "golf"]],
    [["Sports"], ["Wrestling"], ["рестлинг", "борьб"]],
    [["Sports"], ["Ice Sports"], ["хоккей", "фигурное катание", "фигурного катания", "ice skating"]],
    [["Sports"], ["Table Tennis"], ["настольный теннис", "настольного тенниса", "пинг-понг", "table tennis"]],
    [[], ["E-Sports"], ["киберспорт", "esports", "e-sports"]],
    [[], ["Card Battle"], ["карточн", "card battle"]],
    [[], ["Crime"], ["криминал"]],
    [[], ["Cute Girls Doing Cute Things"], ["милые девочки", "милых девочек", "моэ", "кавайн", "moe", "cute girls"]],
    [[], ["Tsundere"], ["цундере", "tsundere"]],
    [[], ["Yandere"], ["яндере", "yandere"]],
    [[], ["Kids"], ["детск", "для детей", "kids"]],
    [[], ["Steampunk"], ["стимпанк", "steampunk"]],
    [[], ["Aliens"], ["инопланетян", "пришельц", "alien"]],
    [[], ["Chuunibyou"], ["тюнибё", "чуунибё", "чунибё", "chuunibyou"]],
    [[], ["Death Game"], ["смертельн игр", "игра на выживание", "игры на выживание", "death game"]],
    [[], ["Space Opera"], ["космоопер", "space opera"]],
    [[], ["Unrequited Love"], ["безответн", "unrequited"]],
    [[], ["Cars"], ["гонки", "гонок", "автомобил", "racing"]],
    [[], ["Steampunk"], ["паропанк"]],
  ];

  const FORMATS = [
    ["MOVIE", ["фильм", "полнометраж", "movie", "film"]],
    ["OVA", ["ова", "ova", "спешл"]],
    ["TV_SHORT", ["короткометраж", "коротк", "short anime", "tv short"]],
    ["TV", ["сериал", "многосерийн"]],
  ];

  const hasStem = (text, toks, stem) => {
    if (stem.includes(" ") || stem.endsWith(" ") || stem.startsWith(" ")) return (" " + text + " ").includes(stem.startsWith(" ") ? stem : " " + stem);
    return toks.some((t) => t.startsWith(stem));
  };

  const FILLER = new Set("аниме anime и в во на с со к по для мне хочу хотел хотела посоветуй посоветуйте найди покажи что то нибудь либо какое какой какую какие интересное интересный хорошее хороший хорошие крутое крутой крутая классное классный нужно надо смотреть посмотреть где есть бы чтоб чтобы очень немного такое такой про о об a an the about with some want something recommend me i of for".split(" "));
  const FILLER_PRE = ["крут", "сильн", "интересн", "хорош", "лучш", "популярн", "нов", "стар", "классн", "добр", "легк", "необычн", "оригинальн", "красив", "дажн"];
  FILLER.add("гг"); FILLER.add("мс"); FILLER.add("mc"); FILLER.add("gg"); FILLER.add("overpowered"); FILLER.add("cool"); FILLER.add("good");
  const MARKER = new Set("про о об аниме anime хочу посоветуй посоветуйте найди покажи about with recommend want something".split(" "));

  // «как X», «похоже на X», «вроде X», «like X»: достаём X (это название) и остаток запроса («но про пиратов»)
  const SIM = /(?:^|\s)(?:похож\S*(?:\s+на)?|подобн\S*(?:\s+на)?|вроде|типа|наподобие|в стиле|аналог\S*(?:\s+на)?|как у|как|like|similar to|similar)\s+(.+)$/;

  // грубое снятие русских окончаний: «атаки титанов» -> «атак титан» (чтобы найти «Атака титанов» по началу слов)
  const stem = (w) => (w.length > 4 ? w.replace(/(ами|ями|ов|ев|ей|ой|ом|ем|ах|ях|ий|ый|ая|ое|ые|ию|ью|а|я|у|ю|е|ы|и|й|ь)$/, "") : w);

  function parse(q) {
    const text = norm(q);
    const out = { genres: [], tags: [], year: null, format: null, similar: null, rest: "", matched: 0 };
    if (!text) return out;
    let body = text;
    const m = text.match(SIM);
    if (m) {
      let subject = m[1];
      let extra = "";
      const cut = subject.match(/^(.+?)\s+(?:но|только|зато|однако|и чтоб|и чтобы|но с|но про|but)\s+(.+)$/);
      if (cut) { subject = cut[1]; extra = cut[2]; }
      subject = subject.replace(/^(?:на|что то|что нибудь|аниме)\s+/, "").trim();
      if (subject && subject.split(" ").length <= 6) {
        out.similar = subject;
        body = extra || "";
      }
    }
    const toks = body.split(" ").filter(Boolean);
    const covered = new Set();
    const cover = (stemStr) => {
      if (/\s/.test(stemStr.trim()) || stemStr !== stemStr.trim()) stemStr.trim().split(" ").forEach((w) => toks.forEach((t, i) => w && t.startsWith(w) && covered.add(i)));
      else toks.forEach((t, i) => t.startsWith(stemStr) && covered.add(i));
    };
    let n = 0;
    for (const [g, t, stems] of LEX) {
      const hit = stems.filter((s) => hasStem(body, toks, s));
      if (hit.length) {
        g.forEach((x) => !out.genres.includes(x) && out.genres.push(x));
        t.forEach((x) => !out.tags.includes(x) && out.tags.push(x));
        hit.forEach(cover);
        n++;
      }
    }
    const y = body.match(/(?:^|\s)((?:19[6-9]|20[0-3])\d)(?:\s|$|г)/);
    if (y) { out.year = Number(y[1]); toks.forEach((t, i) => (t.startsWith(y[1]) || t === "года" || t === "год" || t === "г") && covered.add(i)); }
    else if (/прошл\S*\s+год/.test(body)) { out.year = new Date().getFullYear() - 1; toks.forEach((t, i) => /^(прошл|год)/.test(t) && covered.add(i)); }
    for (const [f, stems] of FORMATS) if (stems.some((s) => hasStem(body, toks, s))) { out.format = f; stems.forEach(cover); break; }
    // запрос похож на описание, если есть слова-маркеры («про», «аниме», «хочу»…) или все слова — это жанры/теги/филлеры.
    // Названия вроде «Sword Art Online» или «My Hero Academia» содержат слова из словаря, но описанием не считаются.
    const left = toks.filter((t, i) => !covered.has(i) && !FILLER.has(t) && !FILLER_PRE.some((p) => t.startsWith(p)));
    out.descriptive = n + (out.year ? 1 : 0) + (out.format ? 1 : 0) > 0 && (left.length === 0 || toks.some((t) => MARKER.has(t)));
    // «грустное» и «драма» вместе не должны давать два одинаковых жанра; ограничиваем, чтобы запрос оставался выполнимым
    out.genres = out.genres.slice(0, 3);
    out.tags = out.tags.slice(0, 3);
    out.rest = body;
    out.matched = n + (out.year ? 1 : 0) + (out.format ? 1 : 0);
    out.subjectStem = out.similar ? out.similar.split(" ").map(stem).join(" ") : "";
    return out;
  }

  // ---- вкус пользователя ----
  // Вес жанра: лайк +3, просмотрено +2, смотрю +1, брошено −2 (недавнее важнее: до +50%)
  function taste(lib) {
    const weights = {}, seen = new Set(), bases = new Set();
    const sorted = [...lib].sort((a, b) => (a.updated_at > b.updated_at ? 1 : -1));
    sorted.forEach((r, i) => {
      seen.add(Number(r.anime_id));
      if (r.title) bases.add(baseTitle(r.title));
      const w0 = (r.liked ? 3 : 0) + (r.status === "completed" ? 2 : 0) + (r.status === "watching" ? 1 : 0) - (r.status === "dropped" ? 2 : 0);
      if (!w0) return;
      const w = w0 * (1 + 0.5 * (i / Math.max(1, sorted.length - 1)));
      (r.genres || []).forEach((g) => (weights[g] = (weights[g] || 0) + w));
    });
    return { weights, seen, bases };
  }

  // «Attack on Titan Season 2 Part 2» и «Attack on Titan» — одна франшиза: сравниваем по названию без номера сезона
  function baseTitle(t) {
    return norm(t)
      .replace(/\b(season|part|cour|the final|final season|2nd|3rd|4th|5th|ii|iii|iv|v|vi)\b/g, " ")
      .replace(/\b(сезон|часть)\b/g, " ")
      .replace(/\b\d+(st|nd|rd|th)?\b/g, " ")
      .split(" ").filter(Boolean).slice(0, 3).join(" ");
  }

  // Оценка кандидата для конкретного человека: совпадение с его жанрами (нормированное по числу жанров) + качество + новизна
  function tasteScore(m, tw) {
    const gs = m.genres || [];
    let g = gs.reduce((a, x) => a + (tw.weights[x] || 0), 0);
    if (gs.length) g /= Math.sqrt(gs.length);
    const year = m.seasonYear || (m.startDate && m.startDate.year) || 0;
    const fresh = year ? Math.max(0, Math.min(1, (year - 2005) / 21)) : 0.3;
    return g + (m.averageScore || 60) / 12 + fresh * 1.2;
  }

  // Ранжирование результатов умного поиска: сохраняем порядок популярности, добавляем совпадение с запросом и со вкусом, просмотренное — в конец
  function rank(items, plan, tw) {
    const want = new Set(plan.genres || []);
    return items
      .map((m, i) => {
        let s = -i * 0.18;
        if (want.size) s += (m.genres || []).filter((g) => want.has(g)).length * 2;
        if (tw && Object.keys(tw.weights).length) s += tasteScore(m, tw) * 0.25;
        if (tw && tw.seen.has(m.id)) s -= 6;
        return [s, m];
      })
      .sort((a, b) => b[0] - a[0])
      .map((x) => x[1]);
  }

  // Названия тегов, которых нет в AniList (их использует и промпт Worker): заменяем на настоящие
  const TAG_FIX = { "Time Travel": "Time Manipulation", "Cooking": "Food", "Workplace": "Office", "Harem": "Female Harem", "Heist": "Crime", "Friendship": null };
  const fixTags = (arr) => [...new Set((arr || []).map((t) => (t in TAG_FIX ? TAG_FIX[t] : t)).filter(Boolean))];

  window.Smart = { fixTags, norm, parse, stem, taste, baseTitle, tasteScore, rank };
})();
