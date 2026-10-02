# /// script
# requires-python = ">=3.11"
# ///
"""Выгрузка опубликованных страниц Tilda в public/ со всеми ресурсами локально.

Запуск:  uv run scripts/tilda_export.py [--force] [--page ID ...]

Ключи PUB_KEY и SECRET_KEY берутся из .env в корне репозитория.
По умолчанию существующие HTML-страницы в public/ не перезаписываются: после миграции
источник правды — репозиторий, а не Tilda. --force перезаписывает их.
Лимит API — 150 запросов в час; полная выгрузка тратит 2 + число страниц.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
ASSETS = PUBLIC / "tilda"
MANIFEST = ROOT / "docs" / "tilda-pages.json"
API = "https://api.tildacdn.info/v1/"
# Страницы, пересобранные на Astro (src/pages/<alias>.astro): не выгружаем, иначе public/ перекроет маршрут.
REBUILT = {"english"}

# Любой файл с CDN Tilda (static/thb/optim, любая доменная зона).
CDN_URL = re.compile(r"https?://(?:static|thb|optim)\.tildacdn\.[a-z]+/[^\s\"'()<>\\]+")
FONT_EXT = (".woff2", ".woff", ".ttf", ".otf", ".eot")

# Теги, которые на своём хостинге не нужны: статистика Tilda и фолбэк на резервный CDN.
DROP_TAGS = [
    re.compile(r"<script[^>]*tilda-stat[^>]*></script>\s*"),
    re.compile(r"<!-- Stat -->\s*<script[^>]*>(?:(?!</script>).)*?tilda-stat(?:(?!</script>).)*</script>\s*", re.S),
    re.compile(r"<script[^>]*neo\.tildacdn\.com[^>]*></script>\s*"),
    re.compile(r"<link rel=\"dns-prefetch\" href=\"https://[a-z]+\.tildacdn\.com\">\s*"),
]
OVERRIDES_LINK = '<link rel="stylesheet" href="/assets/legacy-overrides.css" type="text/css" media="all" />'
OVERRIDES_SCRIPT = '<script src="/assets/legacy-overrides.js" defer></script>'


def load_env() -> dict[str, str]:
    env = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip("\"'")
    return env


def fetch(url: str, retries: int = 3) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "nadezhdik-export/1.0"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
                return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise AssertionError


def api(method: str, env: dict[str, str], **params: str) -> dict:
    query = urllib.parse.urlencode({"publickey": env["PUB_KEY"], "secretkey": env["SECRET_KEY"], **params})
    data = json.loads(fetch(f"{API}{method}/?{query}"))
    if data.get("status") != "FOUND":
        raise RuntimeError(f"{method}: {data.get('message') or data}")
    return data["result"]


def local_name(url: str) -> str:
    """static.tildacdn.com/tild1234-.../Photo 1.png → tild1234-...__photo_1.png (как в экспорте Tilda)."""
    path = urllib.parse.unquote(urllib.parse.urlsplit(url).path).strip("/")
    parts = path.split("/")
    name = parts[-1]
    if len(parts) >= 2 and parts[-2].startswith("tild"):
        name = f"{parts[-2]}__{name.lower().replace(' ', '_')}"
    return name


def kind_of(name: str) -> str:
    lower = name.lower()
    if lower.endswith(".css"):
        return "css"
    if lower.endswith(".js"):
        return "js"
    if lower.endswith(FONT_EXT):
        return "fonts"
    return "img"


class Downloader:
    def __init__(self) -> None:
        self.done: dict[str, str] = {}

    def get(self, url: str, name: str | None = None) -> str:
        """Скачивает файл (один раз за запуск) и возвращает его публичный путь /tilda/<kind>/<name>."""
        clean = url.split("?")[0]
        if clean in self.done:
            return self.done[clean]
        name = name or local_name(clean)
        kind = kind_of(name)
        target = ASSETS / kind / name
        target.parent.mkdir(parents=True, exist_ok=True)
        body = fetch(url)
        if kind == "css":
            body = self.localize_css(body.decode("utf-8")).encode("utf-8")
        target.write_bytes(body)
        public = f"/tilda/{kind}/{name}"
        self.done[clean] = public
        print(f"  ↓ {public}")
        return public

    def localize_css(self, css: str) -> str:
        return CDN_URL.sub(lambda m: self.get(m.group(0)), css)


def localize_page(html: str, page: dict, dl: Downloader) -> str:
    # 1. Ресурсы из списков экспорта: в HTML на них ссылаются по имени файла ("to"), иногда с ?t=...
    for group in ("css", "js", "images"):
        for item in page.get(group, []):
            if "tilda-stat" in item["to"]:
                continue
            public = dl.get(item["from"], item["to"])
            pattern = r"(?<=[\"'(\s=])" + re.escape(item["to"]) + r"(?:\?[^\"')\s]*)?(?=[\"')\s])"
            html = re.sub(pattern, public, html)
    # 2. Абсолютные ссылки на CDN, оставшиеся в разметке и инлайн-стилях.
    html = CDN_URL.sub(lambda m: dl.get(m.group(0)), html)
    for tag in DROP_TAGS:
        html = tag.sub("", html)
    if OVERRIDES_LINK not in html:
        html = html.replace("</head>", f"{OVERRIDES_LINK}\n</head>", 1)
    if OVERRIDES_SCRIPT not in html:
        html = html.replace("</head>", f"{OVERRIDES_SCRIPT}\n</head>", 1)
    return html


def route_for(page: dict, index_id: str) -> Path:
    if str(page["id"]) == str(index_id):
        return PUBLIC / "index.html"
    return PUBLIC / page["alias"] / "index.html"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="перезаписать существующие страницы в public/")
    parser.add_argument("--page", action="append", help="выгрузить только эти ID страниц")
    args = parser.parse_args()

    env = load_env()
    if not env.get("PUB_KEY") or not env.get("SECRET_KEY"):
        print("В .env нет PUB_KEY/SECRET_KEY", file=sys.stderr)
        return 1

    project_id = env.get("TILDA_PROJECT_ID", "9817273")
    project = api("getprojectexport", env, projectid=project_id)
    pages = api("getpageslist", env, projectid=project_id)
    dl = Downloader()
    manifest = []

    for info in pages:
        if args.page and str(info["id"]) not in args.page:
            continue
        target = route_for(info, project["indexpageid"])
        route = "/" if target.parent == PUBLIC else f"/{info['alias']}/"
        manifest.append({"id": info["id"], "title": info["title"], "alias": info["alias"], "route": route,
                         "descr": info.get("descr", ""), "published": info.get("published", "")})
        if info["alias"] in REBUILT:
            print(f"= {route} пересобрана в src/pages/, пропускаю")
            continue
        if target.exists() and not args.force:
            print(f"= {route} уже есть, пропускаю (--force для перезаписи)")
            continue
        print(f"→ {route}  «{info['title']}» ({info['id']})")
        page = api("getpagefullexport", env, pageid=str(info["id"]))
        html = localize_page(page["html"], page, dl)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html, encoding="utf-8")

    MANIFEST.write_text(json.dumps({"project_id": project_id, "domain": project.get("customdomain"),
                                    "index_page_id": project["indexpageid"], "pages": manifest},
                                   ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    leftovers = [p for p in PUBLIC.rglob("*.html") if "tildacdn" in p.read_text(encoding="utf-8")]
    for p in leftovers:
        print(f"! в {p.relative_to(ROOT)} остались ссылки на tildacdn", file=sys.stderr)
    print(f"Готово: {len(manifest)} страниц, {len(dl.done)} файлов, манифест — {MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
