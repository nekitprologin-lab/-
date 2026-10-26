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

    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^\d{1,9}$/.test(id)) return json({ error: "id must be a number" }, 400, headers);
    if (!env.KODIK_TOKEN) return json({ error: "KODIK_TOKEN is not set" }, 500, headers);

    const api = `https://kodikapi.com/search?token=${encodeURIComponent(env.KODIK_TOKEN)}&shikimori_id=${id}`;
    let data;
    try {
      const res = await fetch(api, {
        headers: {
          "User-Agent": CHROME_UA,
          Referer: "https://kodik.info/",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        },
        cf: { cacheTtl: 3600, cacheEverything: true }, // одинаковые запросы не дёргают Kodik повторно
      });
      if (!res.ok) return json({ error: "kodik answered " + res.status }, 502, headers);
      data = await res.json();
    } catch (e) {
      return json({ error: "kodik unreachable" }, 502, headers);
    }
    if (data && data.error) return json({ error: "kodik: " + data.error }, 502, headers);

    const link = data && Array.isArray(data.results) && data.results[0] && data.results[0].link;
    if (!link) return json({ url: null }, 404, headers);

    // ссылка приходит вида //kodik.info/video/...: меняем домен на рабочее зеркало
    const mirror = String(env.MIRROR || DEFAULT_MIRROR).replace(/\/?$/, "/");
    const url = String(link).replace(/^(https?:)?\/\/[^/]+\//, mirror);
    return json({ url }, 200, { ...headers, "Cache-Control": "public, max-age=1800" });
  },
};
