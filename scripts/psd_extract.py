# /// script
# requires-python = ">=3.11"
# dependencies = ["psd-tools>=1.21", "pillow>=10", "numpy>=1.26"]
# ///
"""Разбор PSD-макета в понятный Claude вид.

Запуск:  uv run scripts/psd_extract.py design/mockups/page.psd [--out design/specs/page] [--max-layers 200]
         uv run scripts/psd_extract.py --selftest   # проверка на сгенерированном PSD

Результат в design/specs/<имя>/:
  preview.png   — макет целиком (композит); эталон для scripts/visual-check.mjs --ref
  layers/*.png  — видимые слои с пикселями (картинки для страницы), имя = номер + имя слоя
  spec.json     — дерево слоёв: тип, bbox, прозрачность; для текста — строка, шрифт, кегль, цвет
  spec.md       — то же кратко: тексты, шрифты/кегли, цвета и их ближайшие токены из src/styles/tokens.css
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "src" / "styles" / "tokens.css"


def slug(text: str) -> str:
    text = re.sub(r"[^\w\-]+", "-", text.strip().lower(), flags=re.U).strip("-")
    return text[:40] or "layer"


def load_tokens() -> dict[str, tuple[int, int, int]]:
    tokens = {}
    if TOKENS.exists():
        for name, hexval in re.findall(r"(--c-[\w-]+):\s*#([0-9a-fA-F]{3,6})\b", TOKENS.read_text()):
            if len(hexval) == 3:
                hexval = "".join(ch * 2 for ch in hexval)
            tokens[name] = tuple(int(hexval[i:i + 2], 16) for i in (0, 2, 4))
    return tokens


def nearest_token(rgb: tuple[int, int, int], tokens: dict) -> tuple[str, float]:
    if not tokens:
        return "", 0.0
    name, value = min(tokens.items(), key=lambda kv: sum((a - b) ** 2 for a, b in zip(rgb, kv[1])))
    return name, sum((a - b) ** 2 for a, b in zip(rgb, value)) ** 0.5


def to_hex(rgb) -> str:
    return "#%02x%02x%02x" % tuple(int(round(c)) for c in rgb[:3])


def text_styles(layer) -> list[dict]:
    """Шрифт/кегль/цвет по фрагментам текста. Кегль умножается на масштаб трансформации слоя."""
    styles = []
    try:
        engine = layer.engine_dict
        fonts = [f.get("Name", "") for f in layer.resource_dict.get("FontSet", [])]
        scale = abs(layer.transform[3]) if layer.transform else 1.0
        runs = engine["StyleRun"]["RunArray"]
        lengths = engine["StyleRun"]["RunLengthArray"]
        text = layer.text
        pos = 0
        for run, length in zip(runs, lengths):
            data = run["StyleSheet"]["StyleSheetData"]
            fill = data.get("FillColor", {}).get("Values")
            styles.append({
                "text": text[pos:pos + int(length)].strip(),
                "font": str(fonts[int(data["Font"])]) if "Font" in data and int(data["Font"]) < len(fonts) else None,
                "size_px": round(float(data.get("FontSize", 0)) * scale, 1) or None,
                "leading_px": round(float(data["Leading"]) * scale, 1) if data.get("Leading") else None,
                "tracking": int(data["Tracking"]) if data.get("Tracking") else None,
                "color": to_hex([float(v) * 255 for v in fill[1:4]]) if fill else None,
                "caps": bool(data.get("FontCaps")),
            })
            pos += int(length)
    except Exception as exc:  # у разных версий Photoshop структура отличается
        styles.append({"error": f"не удалось прочитать стиль: {exc}"})
    return [s for s in styles if s.get("text") or s.get("error")]


def walk(layer, out_dir: Path, counter: list[int], limit: int, depth: int = 0) -> dict:
    node = {
        "name": layer.name,
        "kind": layer.kind,
        "visible": layer.is_visible(),
        "bbox": list(layer.bbox) if layer.bbox else None,  # left, top, right, bottom
        "opacity": round(layer.opacity / 255, 2) if hasattr(layer, "opacity") else None,
        "blend": str(getattr(layer, "blend_mode", "")).split(".")[-1] or None,
    }
    if layer.kind == "type":
        node["text"] = layer.text
        node["styles"] = text_styles(layer)
    if layer.is_group():
        node["children"] = [walk(child, out_dir, counter, limit, depth + 1) for child in layer]
    elif node["visible"] and layer.kind in ("pixel", "smartobject", "shape") and layer.width and layer.height:
        if counter[0] < limit:
            counter[0] += 1
            try:
                image = layer.composite()
                if image is not None:
                    name = f"{counter[0]:03d}-{slug(layer.name)}.png"
                    image.save(out_dir / "layers" / name)
                    node["png"] = f"layers/{name}"
            except Exception as exc:
                node["png_error"] = str(exc)
    return node


def iter_nodes(node):
    yield node
    for child in node.get("children", []):
        yield from iter_nodes(child)


def top_colors(image: Image.Image, count: int = 10) -> list[tuple[tuple[int, int, int], float]]:
    small = image.convert("RGB").copy()
    small.thumbnail((400, 400))
    quant = small.quantize(colors=count, method=Image.Quantize.MEDIANCUT)
    palette = quant.getpalette()
    total = small.width * small.height
    pixels = quant.get_flattened_data() if hasattr(quant, "get_flattened_data") else quant.getdata()
    hist = Counter(pixels)
    return [((palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]), n / total) for i, n in hist.most_common(count)]


def write_markdown(spec: dict, tokens: dict, path: Path) -> None:
    lines = [f"# {spec['source']}", "", f"Холст: {spec['width']}×{spec['height']} px. Превью: `preview.png`.", ""]
    lines += ["## Цвета макета → токены", "", "| цвет | доля | ближайший токен | Δ |", "|---|---:|---|---:|"]
    for color in (c for c in spec["colors"] if c["share"] >= 0.005):
        lines.append(f"| `{color['hex']}` | {color['share']:.0%} | `{color['token']}` | {color['distance']:.0f} |")
    fonts = Counter()
    lines += ["", "## Тексты (сверху вниз)", ""]
    texts = [n for n in iter_nodes(spec["tree"]) if n.get("kind") == "type" and n.get("visible")]
    for n in sorted(texts, key=lambda n: (n["bbox"] or [0, 0])[1]):
        style = next((s for s in n.get("styles", []) if "font" in s), {})
        fonts[(style.get("font"), style.get("size_px"))] += 1
        where = "y={1} x={0} w={2}".format(n["bbox"][0], n["bbox"][1], n["bbox"][2] - n["bbox"][0]) if n["bbox"] else ""
        text = " ".join(n["text"].split())
        lines.append(f"- **{text[:120]}** — {style.get('font')} {style.get('size_px')}px {style.get('color')} ({where})")
    lines += ["", "## Шрифты и кегли", ""]
    lines += [f"- {font} — {size}px ×{n}" for (font, size), n in fonts.most_common()]
    images = [n for n in iter_nodes(spec["tree"]) if n.get("png")]
    lines += ["", f"## Картинки слоёв ({len(images)})", ""]
    lines += [f"- `{n['png']}` — {n['name']} bbox={n['bbox']}" for n in images]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def extract(psd_path: Path, out_dir: Path, limit: int) -> dict:
    psd = PSDImage.open(psd_path)
    (out_dir / "layers").mkdir(parents=True, exist_ok=True)
    preview = psd.composite()
    preview.convert("RGB").save(out_dir / "preview.png")
    counter = [0]
    tree = {"name": psd_path.name, "kind": "document", "children": [walk(layer, out_dir, counter, limit) for layer in psd]}
    tokens = load_tokens()
    colors = []
    for rgb, share in top_colors(preview):
        token, distance = nearest_token(rgb, tokens)
        colors.append({"hex": to_hex(rgb), "share": round(share, 3), "token": token, "distance": round(distance, 1)})
    spec = {"source": psd_path.name, "width": psd.width, "height": psd.height, "colors": colors, "tree": tree}
    (out_dir / "spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    write_markdown(spec, tokens, out_dir / "spec.md")
    return spec


def selftest() -> int:
    """Собирает PSD с группой и пиксельными слоями, прогоняет extract и проверяет результат."""
    tmp = ROOT / "design" / "specs" / "_selftest"
    tmp.mkdir(parents=True, exist_ok=True)
    psd = PSDImage.new("RGB", (1200, 800), color=(255, 83, 44))
    group = psd.create_group(name="Hero")
    group.append(psd.create_pixel_layer(Image.new("RGB", (400, 300), (0, 145, 207)), name="Blue card", top=100, left=80))
    psd.append(psd.create_pixel_layer(Image.new("RGB", (300, 120), (225, 225, 194)), name="Cream plate", top=500, left=700))
    source = tmp / "selftest.psd"
    psd.save(source)
    spec = extract(source, tmp / "out", limit=50)
    names = [n["name"] for n in iter_nodes(spec["tree"])]
    ok = (
        (tmp / "out" / "preview.png").exists()
        and "Blue card" in names and "Cream plate" in names
        and len(list((tmp / "out" / "layers").glob("*.png"))) == 2
        and any(c["token"] == "--c-orange" for c in spec["colors"])
    )
    print(f"selftest: {'OK' if ok else 'FAIL'} → {tmp / 'out'}")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("psd", nargs="?", type=Path)
    parser.add_argument("--out", type=Path, help="по умолчанию design/specs/<имя файла>")
    parser.add_argument("--max-layers", type=int, default=200, help="сколько слоёв сохранять в PNG")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if not args.psd or not args.psd.exists():
        parser.error("укажите существующий .psd")
    out = args.out or ROOT / "design" / "specs" / args.psd.stem
    spec = extract(args.psd, out, args.max_layers)
    texts = sum(1 for n in iter_nodes(spec["tree"]) if n.get("kind") == "type")
    print(f"{args.psd.name}: {spec['width']}×{spec['height']}, текстовых слоёв {texts} → {out}/ (spec.md, spec.json, preview.png, layers/)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
