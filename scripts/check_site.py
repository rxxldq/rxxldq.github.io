from __future__ import annotations

import re
import struct
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", re.S)
LITERAL_LOCAL_LINK = re.compile(r"\{\{\s*['\"](/[^'\"]+)['\"]\s*\|\s*relative_url\s*\}\}")


def parse_page(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    match = FRONT_MATTER.match(text)
    if not match:
        return {}, text
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip("\"'")
    return meta, match.group(2).strip()


def normalize_url(value: str) -> str:
    return "/" + value.strip().lstrip("/")


def page_url(path: Path, meta: dict[str, str]) -> str | None:
    if meta.get("permalink"):
        return normalize_url(meta["permalink"])
    if path.parent == ROOT and path.suffix == ".html":
        return normalize_url(path.name)
    return None


def paragraph_count(body: str) -> int:
    return len([block for block in re.split(r"\n\s*\n", body.strip()) if block.strip()])


def main() -> int:
    errors: list[str] = []
    pages: list[tuple[Path, dict[str, str], str]] = []
    candidates = list(ROOT.glob("*.html")) + list((ROOT / "works").glob("*.md"))
    for path in sorted(candidates):
        meta, body = parse_page(path)
        if meta:
            pages.append((path, meta, body))

    by_url: dict[str, tuple[Path, dict[str, str], str]] = {}
    for path, meta, body in pages:
        url = page_url(path, meta)
        if not url:
            continue
        if url in by_url:
            errors.append(f"duplicate permalink {url}: {by_url[url][0]} and {path}")
        by_url[url] = (path, meta, body)

    listed = []
    for path, meta, _ in pages:
        current_url = page_url(path, meta)
        alternate = meta.get("alternate")
        if alternate:
            target = by_url.get(normalize_url(alternate))
            if not target:
                errors.append(f"{path}: alternate target does not exist: {alternate}")
            elif current_url and normalize_url(target[1].get("alternate", "")) != current_url:
                errors.append(f"{path}: alternate target does not link back")
            elif meta.get("alternate_lang") != target[1].get("lang"):
                errors.append(f"{path}: alternate_lang does not match target language")

        if meta.get("listed") == "true":
            listed.append(path)
            for field in ("title", "year", "order", "permalink", "english_title"):
                if not meta.get(field):
                    errors.append(f"{path}: listed work is missing {field}")
            english_url = meta.get("english_url")
            if english_url and normalize_url(english_url) not in by_url:
                errors.append(f"{path}: English page does not exist: {english_url}")

        if meta.get("ai_translation") == "true":
            revised = meta.get("translation_revised", "")
            if not revised:
                errors.append(f"{path}: AI translation is missing translation_revised")
            elif not re.fullmatch(r"\d{4}-\d{2}-\d{2}", revised):
                errors.append(f"{path}: invalid translation_revised date: {revised}")

    pairs = 0
    for zh_path in sorted((ROOT / "works").glob("*.zh.md")):
        en_path = zh_path.with_name(zh_path.name.replace(".zh.md", ".en.md"))
        if not en_path.exists():
            continue
        pairs += 1
        _, zh_body = parse_page(zh_path)
        _, en_body = parse_page(en_path)
        zh_count = paragraph_count(zh_body)
        en_count = paragraph_count(en_body)
        if zh_count != en_count:
            errors.append(
                f"{zh_path.stem[:-3]}: paragraph count differs: Chinese {zh_count}, English {en_count}"
            )

    for path in ROOT.rglob("*.html"):
        text = path.read_text(encoding="utf-8")
        for url in LITERAL_LOCAL_LINK.findall(text):
            target = ROOT / url.lstrip("/")
            if not target.exists() and normalize_url(url) not in by_url:
                errors.append(f"{path}: local link target does not exist: {url}")

    required_text = {
        ROOT / "index.html": (
            "rel=\"canonical\"",
            "property=\"og:title\"",
            "property=\"og:image\"",
            "summary_large_image",
            "include subscription-form.html",
            "site-footer-button-zh",
        ),
        ROOT / "_layouts" / "article.html": (
            "hreflang=\"x-default\"",
            "property=\"og:title\"",
            "property=\"og:image\"",
            "summary_large_image",
            "reading-sequence",
            "proofread-mode.js",
            "reader-insights.js",
            "include reader-message.html",
        ),
        ROOT / "feed.xml": ("where: 'listed', true",),
        ROOT / "sitemap.xml": ("where: 'listed', true",),
        ROOT / "_includes" / "subscription-form.html": ('name="email"', "site.data.subscription"),
        ROOT / "reading-tools.js": ("reading-progress", "data-reading-random", "entries.sort"),
        ROOT / "proofread-mode.js": ('parameters.get("proofread")', "data-alternate-url", "proofread-pair"),
        ROOT / "reader-insights.js": ('send("view")', 'send("complete")', "/api/message"),
        ROOT / "backend" / "src" / "worker.js": ("/api/track", "/api/message", "/admin", "CF-Connecting-IP"),
        ROOT / "backend" / "schema.sql": ("reading_events", "messages", "UNIQUE(view_id, event_type)"),
    }
    for path, needles in required_text.items():
        if not path.exists():
            errors.append(f"required file is missing: {path.relative_to(ROOT)}")
            continue
        text = path.read_text(encoding="utf-8")
        for needle in needles:
            if needle not in text:
                errors.append(f"{path.relative_to(ROOT)}: missing expected text: {needle}")

    share_cover = ROOT / "images" / "share-cover.png"
    if not share_cover.exists():
        errors.append("required file is missing: images/share-cover.png")
    else:
        with share_cover.open("rb") as image_file:
            header = image_file.read(24)
        if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
            errors.append("images/share-cover.png: not a valid PNG file")
        else:
            width, height = struct.unpack(">II", header[16:24])
            if (width, height) != (1200, 630):
                errors.append(
                    f"images/share-cover.png: expected 1200x630, found {width}x{height}"
                )

    if errors:
        print("Site integrity check failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(
        f"Site integrity check passed: {len(by_url)} permalinks, "
        f"{len(listed)} listed works, {pairs} bilingual Markdown pairs."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
