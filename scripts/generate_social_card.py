"""Generate the home and per-work Open Graph cards without generative AI."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 1200, 630
PAPER = (251, 250, 247, 255)
INK = (24, 24, 22, 255)
QUIET = (91, 88, 82, 255)
RULE = (216, 212, 202, 255)
FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---", re.S)
GEORGIA = r"C:\Windows\Fonts\georgia.ttf"
GEORGIA_ITALIC = r"C:\Windows\Fonts\georgiai.ttf"
CHINESE = r"C:\Windows\Fonts\msyh.ttc"


def parse_front_matter(path: Path) -> dict[str, str]:
    match = FRONT_MATTER.match(path.read_text(encoding="utf-8"))
    if not match:
        return {}
    metadata: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip("\"'")
    return metadata


def page_url(path: Path, metadata: dict[str, str]) -> str:
    if metadata.get("permalink"):
        return "/" + metadata["permalink"].lstrip("/")
    return "/" + path.name


def article_pairs() -> list[tuple[str, str, str]]:
    candidates = list(ROOT.glob("*.html")) + list((ROOT / "works").glob("*.md"))
    pages = [(path, parse_front_matter(path)) for path in candidates]
    by_url = {page_url(path, metadata): metadata for path, metadata in pages if metadata}
    pairs: list[tuple[str, str, str]] = []
    for path, metadata in pages:
        if metadata.get("layout") != "article" or metadata.get("lang") != "zh-CN":
            continue
        url = page_url(path, metadata)
        slug = url.rsplit("/", 1)[-1].removesuffix(".html")
        alternate = by_url.get(metadata.get("alternate", ""), {})
        english_title = alternate.get("title") or metadata.get("english_title") or metadata["title"]
        pairs.append((slug, metadata["title"], english_title))
    return sorted(set(pairs))


def contain(font_path: str, text: str, max_width: int, start_size: int, minimum: int = 20) -> ImageFont.FreeTypeFont:
    size = start_size
    while size > minimum:
        font = ImageFont.truetype(font_path, size)
        if font.getlength(text) <= max_width:
            return font
        size -= 1
    return ImageFont.truetype(font_path, minimum)


def wrap_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    if not words:
        return [text]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def artwork_layer(slug: str, opacity: float, max_size: tuple[int, int]) -> Image.Image:
    artwork = Image.open(ROOT / "images" / "map.png").convert("RGBA")
    artwork.thumbnail(max_size, Image.Resampling.LANCZOS)
    digest = hashlib.sha256(slug.encode("utf-8")).digest()
    angle = (digest[0] % 9) - 4
    artwork = artwork.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    alpha = artwork.getchannel("A").point(lambda value: round(value * opacity))
    artwork.putalpha(alpha)
    return artwork


def paper_canvas(slug: str) -> Image.Image:
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), PAPER)
    # A nearly invisible monochrome texture prevents a flat digital-paper look.
    noise = Image.effect_noise((WIDTH, HEIGHT), 5).convert("L")
    noise = ImageEnhance.Contrast(noise).enhance(0.15)
    texture = Image.merge("RGBA", (noise, noise, noise, Image.new("L", (WIDTH, HEIGHT), 7)))
    canvas.alpha_composite(texture)
    artwork = artwork_layer(slug, 0.12, (610, 760))
    digest = hashlib.sha256(slug.encode("utf-8")).digest()
    x = WIDTH - artwork.width + 70 + digest[1] % 45
    y = -75 + digest[2] % 120
    canvas.alpha_composite(artwork, (x, y))
    return canvas


def draw_card(slug: str, chinese_title: str, english_title: str, output: Path) -> None:
    canvas = paper_canvas(slug)
    draw = ImageDraw.Draw(canvas)
    left = 86
    max_width = 755

    draw.line((left, 86, left + 72, 86), fill=RULE, width=2)
    chinese_font = contain(CHINESE, chinese_title, max_width, 51, 34)
    draw.text((left, 184), chinese_title, font=chinese_font, fill=INK)

    english_font = ImageFont.truetype(GEORGIA_ITALIC, 29)
    english_lines = wrap_lines(draw, english_title, english_font, max_width)
    english_y = 184 + chinese_font.size + 28
    for line in english_lines[:2]:
        draw.text((left, english_y), line, font=english_font, fill=QUIET)
        english_y += 39

    site_font = ImageFont.truetype(GEORGIA, 19)
    draw.text((left, HEIGHT - 86), "RXXLDQ.GITHUB.IO", font=site_font, fill=QUIET)
    draw.text((WIDTH - 88, HEIGHT - 86), "L’imagination au pouvoir !", font=site_font, fill=QUIET, anchor="ra")

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, "PNG", optimize=True)


def draw_home_card(output: Path) -> None:
    canvas = paper_canvas("home")
    draw = ImageDraw.Draw(canvas)
    left = 86
    draw.line((left, 86, left + 72, 86), fill=RULE, width=2)
    title = "L’imagination au pouvoir !"
    title_font = contain(GEORGIA, title, 760, 63, 40)
    draw.text((left, 196), title, font=title_font, fill=INK)
    subtitle_font = ImageFont.truetype(CHINESE, 31)
    draw.text((left + 2, 196 + title_font.size + 25), "让想象力夺权", font=subtitle_font, fill=QUIET)
    site_font = ImageFont.truetype(GEORGIA, 19)
    draw.text((left, HEIGHT - 86), "RXXLDQ.GITHUB.IO", font=site_font, fill=QUIET)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, "PNG", optimize=True)


def main() -> None:
    draw_home_card(ROOT / "images" / "share-cover.png")
    pairs = article_pairs()
    social_dir = ROOT / "images" / "social"
    for slug, chinese_title, english_title in pairs:
        draw_card(slug, chinese_title, english_title, social_dir / f"{slug}.png")
    print(f"Generated the home card and {len(pairs)} article cards.")


if __name__ == "__main__":
    main()
