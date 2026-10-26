// Шлюз Kodik для Cloudflare Workers.
// Запрос: GET https://<твой-воркер>.workers.dev/?id=НОМЕР_MYANIMELIST (он же Shikimori)
// Ответ:  200 {"url":"https://aniqit.com/video/..."}  |  404 {"url":null}  |  502 {"error":"..."}
//
// Настройки (Settings → Variables and Secrets в панели Cloudflare):
//   KODIK_TOKEN  (Secret, обязательно)  токен Kodik API
//   ALLOW_ORIGIN (Text, по желанию)     откуда можно вызывать шлюз; по умолчанию только твой сайт на GitHub Pages.
//                                       Значение "*" разрешает всем (тогда шлюзом смогут пользоваться чужие сайты).
//   MIRROR       (Text, по желанию)     домен вместо kodik.info, по умолчанию https://aniqit.com/ (можно https://kodik.cc/)

const DEFAULT_ORIGIN = "https://nekitprologin-lab.github.io";
const DEFAULT_MIRROR = "https://aniqit.com/";
const PUBLIC_TOKEN = "447d179e875efe44217f20d1ee2146be";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function cors(request, env) {
  const allow = env.ALLOW_ORIGIN || DEFAULT_ORIGIN;
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allow === "*" ? "*" : origin === allow ? origin : allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export default {
  async fetch(request, env) {
    const headers = cors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405, headers);

    // Прокси к Shikimori для русских названий (у части провайдеров он закрыт): ?shiki=/animes?ids=1,2
    const sp = new URL(request.url).searchParams.get("shiki");
    if (sp) {
      if (!/^\/animes(\/\d{1,9})?(\?[\w=&,%.\-+]*)?$/.test(sp)) return json({ error: "bad path" }, 400, headers);
      const r = await fetch("https://shikimori.one/api" + sp, {
        headers: { "User-Agent": CHROME_UA, Accept: "application/json" },
        cf: { cacheTtl: 86400, cacheEverything: true },
      });
      return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400", ...headers } });
    }

    // Перевод: ?tr=текст&sl=en&tl=ru. Основной путь — Workers AI (модель m2m100, привязка AI), запасной — Google.
    // Google блокирует адреса Cloudflare, поэтому без привязки AI перевод может не работать.
    const tr = new URL(request.url).searchParams.get("tr");
    if (tr) {
      const q = new URL(request.url).searchParams;
      const sl = /^[a-z]{2}$/.test(q.get("sl") || "") ? q.get("sl") : "en";
      const tl = /^[a-z]{2}$/.test(q.get("tl") || "") ? q.get("tl") : "ru";
      const text = tr.slice(0, 4000);
      const names = { en: "english", ru: "russian" };
      const out = (translated) => new Response(JSON.stringify([[[translated, text, null, null]]]), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400", ...headers },
      });
      const cache = caches.default;
      const hit = await cache.match(request);
      if (hit) return hit;
      const done = async (resp) => { try { await cache.put(request, resp.clone()); } catch (e) {} return resp; };

      if (env.AI && names[sl] && names[tl]) {
        try {
          // каждую строку переводим отдельно, длинные режем по предложениям
          const lines = text.split("\n");
          const tl1 = async (line) => {
            if (!line.trim()) return line;
            const chunks = [];
            let cur = "";
            for (const sent of line.split(/(?<=[.!?…])\s+/)) {
              if ((cur + " " + sent).length > 450 && cur) { chunks.push(cur); cur = sent; } else cur = cur ? cur + " " + sent : sent;
            }
            if (cur) chunks.push(cur);
            const parts = await Promise.all(chunks.map((c) => env.AI.run("@cf/meta/m2m100-1.2b", { text: c, source_lang: names[sl], target_lang: names[tl] })));
            return parts.map((p) => p.translated_text || "").join(" ");
          };
          const res = await Promise.all(lines.map(tl1));
          return done(out(res.join("\n")));
        } catch (e) { /* пробуем Google */ }
      }
      const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=" + sl + "&tl=" + tl + "&dt=t&q=" + encodeURIComponent(text), {
        headers: { "User-Agent": CHROME_UA },
      });
      if (!r.ok) return json({ error: "translate unavailable", status: r.status }, 502, headers);
      return done(new Response(await r.text(), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400", ...headers } }));
    }

    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^\d{1,9}$/.test(id)) return json({ error: "id must be a number" }, 400, headers);

    const userToken = String(env.KODIK_TOKEN || "").trim();
    if (!userToken && !PUBLIC_TOKEN) return json({ error: "KODIK_TOKEN is not set" }, 500, headers);

    const reqHeaders = {
      "User-Agent": CHROME_UA,
      Referer: "https://kodik.info/",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    };

    let link = null;

    // 1. Поиск через search API
    if (userToken) {
      try {
        const api = "https://kodik-api.com/search?token=" + encodeURIComponent(userToken) + "&shikimori_id=" + id;
        const res = await fetch(api, {
          headers: reqHeaders,
          cf: { cacheTtl: 3600, cacheEverything: true },
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.results) && data.results[0] && data.results[0].link) {
            link = data.results[0].link;
          }
        }
      } catch (e) {
        // переходим к get-player
      }
    }

    // 2. Резервный поиск через официальный get-player API
    if (!link) {
      const tokensToTry = [userToken, PUBLIC_TOKEN].filter(Boolean);
      for (const t of tokensToTry) {
        try {
          const api = "https://kodik-api.com/get-player?token=" + encodeURIComponent(t) + "&shikimoriID=" + id;
          const res = await fetch(api, {
            headers: reqHeaders,
            cf: { cacheTtl: 3600, cacheEverything: true },
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.link && (data.found || data.allowed)) {
              link = data.link;
              break;
            }
          }
        } catch (e) {
          // пробуем следующий токен
        }
      }
    }

    if (!link) return json({ url: null }, 404, headers);

    // Ссылка приходит вида //kodik.info/... или //kodikplayer.com/...: меняем домен на рабочее зеркало
    const mirror = String(env.MIRROR || DEFAULT_MIRROR).replace(/\/?$/, "/");
    const url = String(link).replace(/^(https?:)?\/\/[^/]+\//, mirror);
    return json({ url }, 200, { ...headers, "Cache-Control": "public, max-age=1800" });
  },
};
