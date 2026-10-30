#!/usr/bin/env python3
"""Сбор каталога бесплатного кино с ОФИЦИАЛЬНЫХ каналов студий на Rutube.

Запускать с компьютера в России (из-за границы Rutube отдаёт пустые ответы):
    python tools/rutube_sync.py
Результат: data/rutube.json (его читает сайт). Потом закоммитить и запушить.

Каналы заданы списком CHANNELS ниже. Брать только официальные каналы студий и правообладателей.
"""
import json, re, sys, time, urllib.request, pathlib

# key, id канала, подпись, тип (film / cartoon)
CHANNELS = [
    ("mosfilm", 25963146, "Мосфильм", "film"),
    ("gorky", 48160110, "Киностудия Горького", "film"),
    ("lenfilm", 1792500, "Ленфильм", "film"),
    ("gosfilmofond", 23635314, "Госфильмофонд России", "film"),
    ("soyuzmult", 12056, "Союзмультфильм", "cartoon"),
    ("soyuzmult-kids", 80482456, "Союзмультфильм: мультики для детей", "cartoon"),
]
MIN_SEC = {"film": 40 * 60, "cartoon": 3 * 60}  # короткие ролики, нарезки и шортсы не берём
MAX_PAGES = 400
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "rutube.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept": "application/json"}


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def main():
    items, seen, stats = [], set(), {}
    for key, cid, name, kind in CHANNELS:
        n_kept = n_all = 0
        page = 1
        while page <= MAX_PAGES:
            j = get(f"https://rutube.ru/api/video/person/{cid}/?page={page}")
            for v in j.get("results", []):
                n_all += 1
                vid = v.get("id")
                if not vid or vid in seen:
                    continue
                if any(v.get(f) for f in ("is_hidden", "is_deleted", "is_adult", "is_locked", "is_paid", "is_livestream", "is_audio")):
                    continue
                au = v.get("author") or {}
                if au.get("id") not in (None, cid):  # перепосты чужих каналов не берём
                    continue
                d = int(v.get("duration") or 0)
                if d < MIN_SEC[kind]:
                    continue
                t = (v.get("title") or "").strip()
                if "#shorts" in t.lower() or "отрывок" in t.lower() or "трейлер" in t.lower() or "тизер" in t.lower():
                    continue
                m = re.search(r"\b(19\d\d|20\d\d)\b", t)
                seen.add(vid)
                items.append({
                    "k": int(vid[:12], 16),  # короткий числовой номер для адресов и библиотеки
                    "id": vid, "t": t, "d": d, "th": v.get("thumbnail_url") or "",
                    "h": int(v.get("hits") or 0), "ch": key, "ty": kind, "y": int(m.group(1)) if m else 0,
                })
                n_kept += 1
            print(f"{name}: страница {page}, взято {n_kept} из {n_all}", file=sys.stderr)
            if not j.get("has_next"):
                break
            page += 1
            time.sleep(0.25)
        stats[key] = n_kept
    items.sort(key=lambda x: -x["h"])
    data = {"updated": time.strftime("%Y-%m-%d"), "channels": {k: {"name": n, "id": c, "type": t} for k, c, n, t in CHANNELS}, "items": items}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Готово:", len(items), "видео", stats, "->", OUT)


if __name__ == "__main__":
    main()
