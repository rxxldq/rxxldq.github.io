#!/usr/bin/env python3
"""Create a portable backup and print/EPUB editions of the writing archive.

The source files remain authoritative.  This exporter deliberately reads only
the existing Markdown/HTML works and turns the web-only context-note buttons
into endnotes in the publication editions.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output"
WORKS = ROOT / "works"
ABOUT = ROOT / "_includes" / "works"
IMAGE_DIR = ROOT / "images"
TITLE = "L’imagination au pouvoir !"
SPECIAL_FIRST = "middle-class-children"
NOTE_RE = re.compile(
    r'<button\s+class=["\']note-ref["\'][^>]*?data-note=["\'](.*?)["\'][^>]*>.*?</button>',
    re.IGNORECASE | re.DOTALL,
)
TAG_RE = re.compile(r"<[^>]+>")
BLOCK_RE = re.compile(r"<(h[1-6]|p)\b[^>]*>(.*?)</\1\s*>", re.IGNORECASE | re.DOTALL)


@dataclass
class Work:
    slug: str
    title: str
    language: str
    source_url: str | None
    source_label: str | None
    blocks: list[tuple[str, str]]
    notes: list[str]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_front_matter(path: Path) -> tuple[dict[str, object], str]:
    text = read_text(path).replace("\r\n", "\n")
    if not text.startswith("---\n"):
        return {}, text
    _, front, body = text.split("---\n", 2)
    data: dict[str, object] = {}
    for raw in front.splitlines():
        if not raw or raw.lstrip().startswith("#") or ":" not in raw:
            continue
        key, value = raw.split(":", 1)
        value = value.strip()
        if (value.startswith("'") and value.endswith("'")) or (
            value.startswith('"') and value.endswith('"')
        ):
            value = value[1:-1]
        if value.lower() in {"true", "false"}:
            data[key.strip()] = value.lower() == "true"
        elif re.fullmatch(r"-?\d+", value):
            data[key.strip()] = int(value)
        else:
            data[key.strip()] = value
    return data, body.strip()


def clean_inline(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    value = re.sub(r"<(?:em|i)\b[^>]*>", "*", value, flags=re.IGNORECASE)
    value = re.sub(r"</(?:em|i)\s*>", "*", value, flags=re.IGNORECASE)
    value = re.sub(r"<(?:strong|b)\b[^>]*>", "**", value, flags=re.IGNORECASE)
    value = re.sub(r"</(?:strong|b)\s*>", "**", value, flags=re.IGNORECASE)
    value = TAG_RE.sub("", value)
    return html.unescape(value).strip()


def replace_notes(body: str) -> tuple[str, list[str]]:
    notes: list[str] = []

    def repl(match: re.Match[str]) -> str:
        notes.append(clean_inline(match.group(1)))
        return f"[{len(notes)}]"

    return NOTE_RE.sub(repl, body), notes


def markdown_blocks(body: str) -> list[tuple[str, str]]:
    """Retain paragraph and poetry line boundaries without rendering site UI."""
    body, _unused = replace_notes(body)  # callers pass a note-expanded body; harmless fallback
    # Files whose visible body is explicitly paragraph-tagged are poetry and
    # need every original <p> as a distinct line/block.
    matches = list(BLOCK_RE.finditer(body))
    if matches and not body[: matches[0].start()].strip():
        blocks: list[tuple[str, str]] = []
        for match in matches:
            kind = "heading" if match.group(1).lower().startswith("h") else "paragraph"
            text = clean_inline(match.group(2))
            if text:
                blocks.append((kind, text))
        if blocks:
            return blocks

    body = re.sub(r"<br\s*/?>", "\n", body, flags=re.IGNORECASE)
    body = re.sub(r"<(?:em|i)\b[^>]*>", "*", body, flags=re.IGNORECASE)
    body = re.sub(r"</(?:em|i)\s*>", "*", body, flags=re.IGNORECASE)
    body = re.sub(r"<(?:strong|b)\b[^>]*>", "**", body, flags=re.IGNORECASE)
    body = re.sub(r"</(?:strong|b)\s*>", "**", body, flags=re.IGNORECASE)
    body = TAG_RE.sub("", body)
    blocks = []
    for raw in re.split(r"\n\s*\n", body):
        raw = html.unescape(raw).strip()
        if not raw or raw.startswith("{%") or raw.startswith("{{"):
            continue
        heading = re.match(r"^#{1,6}\s+(.+)$", raw)
        if heading:
            blocks.append(("heading", heading.group(1).strip()))
        else:
            blocks.append(("paragraph", raw))
    return blocks


def load_work(slug: str, language: str) -> Work:
    front, body = parse_front_matter(WORKS / f"{slug}.{language}.md")
    body, notes = replace_notes(body)
    return Work(
        slug=slug,
        title=str(front["title"]),
        language=language,
        source_url=str(front["source_url"]) if front.get("source_url") else None,
        source_label=str(front["source_label"]) if front.get("source_label") else None,
        blocks=markdown_blocks(body),
        notes=notes,
    )


def ordered_slugs() -> list[str]:
    entries: list[tuple[int, int, str]] = []
    for path in WORKS.glob("*.zh.md"):
        front, _ = parse_front_matter(path)
        if not front.get("listed"):
            continue
        slug = path.name.removesuffix(".zh.md")
        if slug == SPECIAL_FIRST:
            continue
        entries.append((int(front.get("year", 0)), int(front.get("order", 0)), slug))
    # The live navigation places the poem first, then latest work first; 0 is
    # the archive's explicit undated-last value.
    entries.sort(key=lambda item: (item[0] == 0, -item[0], item[1], item[2]))
    return [SPECIAL_FIRST] + [slug for _, _, slug in entries]


def about_work(language: str) -> Work:
    name = "about-author.zh.md" if language == "zh" else "about-author.en.md"
    page_name = "hall.html" if language == "zh" else "hall-en.html"
    page_front, _ = parse_front_matter(ROOT / page_name)
    blocks = markdown_blocks(read_text(ABOUT / name))
    author_name = str(page_front.get("author_name", "")).strip()
    if author_name:
        blocks.insert(0, ("paragraph", author_name))
    return Work(
        slug="about-author",
        title="关于作者" if language == "zh" else "About the Author",
        language=language,
        source_url=None,
        source_label=None,
        blocks=blocks,
        notes=[],
    )


def publication_works(language: str) -> list[Work]:
    return [load_work(slug, language) for slug in ordered_slugs()] + [about_work(language)]


def xml_escape(value: str) -> str:
    return html.escape(value, quote=True)


def inline_xhtml(value: str) -> str:
    safe = xml_escape(value)
    safe = safe.replace("\n", "<br/>")
    safe = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r'<a href="\2">\1</a>', safe)
    safe = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", safe)
    safe = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", safe)
    return safe


def chapter_xhtml(work: Work, ordinal: int, language: str) -> str:
    language_code = "zh-CN" if language == "zh" else "en"
    sections = [f'<h1>{inline_xhtml(work.title)}</h1>']
    if work.source_url:
        label = work.source_label or work.source_url
        sections.append(f'<p class="source"><a href="{xml_escape(work.source_url)}">{inline_xhtml(label)}</a></p>')
    for kind, text in work.blocks:
        tag = "h2" if kind == "heading" else "p"
        sections.append(f"<{tag}>{inline_xhtml(text)}</{tag}>")
    if work.notes:
        note_title = "注释" if language == "zh" else "Notes"
        items = "".join(f"<li id=\"note-{ordinal}-{n}\">{inline_xhtml(note)}</li>" for n, note in enumerate(work.notes, 1))
        sections.append(f'<section class="notes"><h2>{note_title}</h2><ol>{items}</ol></section>')
    if work.slug == "about-author":
        sections.append('<figure><img src="images/about-author.jpg" alt=""/></figure>')
    return """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="%s" lang="%s">
<head><title>%s</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>
<body><main>%s</main></body></html>""" % (
        language_code,
        language_code,
        xml_escape(work.title),
        "\n".join(sections),
    )


EPUB_STYLE = """@charset \"utf-8\";
body { margin: 6%; font-family: serif; line-height: 1.65; }
main { max-width: 42em; margin: auto; }
h1 { margin: 1.8em 0 1.2em; font-size: 1.5em; }
h2 { margin: 1.5em 0 .75em; font-size: 1.1em; }
p { margin: 0 0 1em; }
.source { font-size: .9em; }
.notes { margin-top: 2em; font-size: .92em; }
figure { margin: 2em 0; text-align: center; }
figure img { max-width: 100%; height: auto; }
.cover { text-align: center; padding-top: 15%; }
.cover img { max-width: 85%; height: auto; }
"""


def epub_nav(works: list[Work], language: str) -> str:
    lang = "zh-CN" if language == "zh" else "en"
    title = "目录" if language == "zh" else "Contents"
    entries = "".join(
        f'<li><a href="chapter-{i:02d}.xhtml">{inline_xhtml(work.title)}</a></li>'
        for i, work in enumerate(works, 1)
    )
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="{lang}" xml:lang="{lang}">
<head><title>{title}</title></head><body><nav epub:type="toc" id="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>{title}</h1><ol>{entries}</ol></nav></body></html>'''


def build_epub(language: str, destination: Path) -> None:
    works = publication_works(language)
    lang = "zh-CN" if language == "zh" else "en"
    edition = "中文写作档案" if language == "zh" else "English Writing Archive"
    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="css" href="styles.css" media-type="text/css"/>',
        '<item id="cover" href="images/site-card.png" media-type="image/png" properties="cover-image"/>',
        '<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>',
        '<item id="author-image" href="images/about-author.jpg" media-type="image/jpeg"/>',
    ]
    spine = ['<itemref idref="cover-page" linear="no"/>']
    for index, _work in enumerate(works, 1):
        manifest.append(f'<item id="chapter-{index}" href="chapter-{index:02d}.xhtml" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="chapter-{index}"/>')
    opf = f'''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0" xml:lang="{lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:rxxldq-{language}-archive</dc:identifier><dc:title>{edition}</dc:title><dc:language>{lang}</dc:language><dc:creator>rxxldq</dc:creator><meta property="dcterms:modified">{datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')}</meta></metadata>
<manifest>{''.join(manifest)}</manifest><spine>{''.join(spine)}</spine></package>'''
    cover_title = "写作档案" if language == "zh" else "Writing Archive"
    cover = f'''<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="{lang}"><head><title>{cover_title}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body><section class="cover"><img src="images/site-card.png" alt=""/><h1>{cover_title}</h1></section></body></html>'''
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w") as archive:
        info = zipfile.ZipInfo("mimetype")
        info.compress_type = zipfile.ZIP_STORED
        archive.writestr(info, "application/epub+zip")
        archive.writestr("META-INF/container.xml", """<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
        archive.writestr("OEBPS/content.opf", opf)
        archive.writestr("OEBPS/nav.xhtml", epub_nav(works, language))
        archive.writestr("OEBPS/styles.css", EPUB_STYLE)
        archive.writestr("OEBPS/cover.xhtml", cover)
        archive.write(IMAGE_DIR / "site-card.png", "OEBPS/images/site-card.png")
        archive.write(IMAGE_DIR / "about-author.jpg", "OEBPS/images/about-author.jpg")
        for index, work in enumerate(works, 1):
            archive.writestr(f"OEBPS/chapter-{index:02d}.xhtml", chapter_xhtml(work, index, language))


def find_pdf_font() -> str:
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simsun.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            try:
                pdfmetrics.registerFont(TTFont("ArchiveCJK", str(candidate), subfontIndex=0))
                return "ArchiveCJK"
            except Exception:
                continue
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    return "STSong-Light"


def reportlab_markup(value: str) -> str:
    safe = xml_escape(value).replace("\n", "<br/>")
    safe = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", safe)
    safe = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", safe)
    return safe


def footer(canvas, doc) -> None:  # type: ignore[no-untyped-def]
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(HexColor("#666666"))
    canvas.drawCentredString(A5[0] / 2, 10 * mm, str(doc.page))
    canvas.restoreState()


def build_pdf(language: str, destination: Path) -> None:
    works = publication_works(language)
    zh = language == "zh"
    cjk_font = find_pdf_font()
    heading_font = cjk_font if zh else "Helvetica"
    body_font = cjk_font if zh else "Times-Roman"
    edition = "中文写作档案" if zh else "English Writing Archive"
    contents = "目录" if zh else "Contents"
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("ArchiveTitle", parent=styles["Title"], fontName=heading_font, fontSize=22, leading=30, alignment=TA_CENTER, spaceAfter=14 * mm)
    contents_style = ParagraphStyle("ArchiveContents", parent=styles["BodyText"], fontName=body_font, fontSize=10.5, leading=17, spaceAfter=2 * mm)
    chapter_style = ParagraphStyle("ArchiveChapter", parent=styles["Heading1"], fontName=heading_font, fontSize=18, leading=26, spaceAfter=9 * mm)
    heading_style = ParagraphStyle("ArchiveHeading", parent=styles["Heading2"], fontName=heading_font, fontSize=13, leading=20, spaceBefore=5 * mm, spaceAfter=3 * mm)
    body_style = ParagraphStyle("ArchiveBody", parent=styles["BodyText"], fontName=body_font, fontSize=10.7 if zh else 10.4, leading=19 if zh else 17.5, spaceAfter=4 * mm)
    note_style = ParagraphStyle("ArchiveNote", parent=body_style, fontSize=8.8, leading=14, leftIndent=5 * mm, firstLineIndent=-5 * mm, spaceAfter=2 * mm)
    source_style = ParagraphStyle("ArchiveSource", parent=body_style, fontSize=9, leading=14, textColor=HexColor("#555555"))
    story = [Spacer(1, 14 * mm)]
    if (IMAGE_DIR / "site-card.png").exists():
        story.extend([Image(str(IMAGE_DIR / "site-card.png"), width=74 * mm, height=74 * mm, hAlign="CENTER"), Spacer(1, 7 * mm)])
    story.extend([Paragraph(edition, title_style), Paragraph(TITLE, ParagraphStyle("Motto", parent=contents_style, alignment=TA_CENTER)), PageBreak(), Paragraph(contents, chapter_style)])
    for number, work in enumerate(works[:-1], 1):
        story.append(Paragraph(f"{number}. {reportlab_markup(work.title)}", contents_style))
    story.append(Paragraph(("关于作者" if zh else "About the Author"), contents_style))
    story.append(PageBreak())
    for index, work in enumerate(works):
        story.append(Paragraph(reportlab_markup(work.title), chapter_style))
        if work.source_url:
            source_label = reportlab_markup(work.source_label or work.source_url)
            source_url = xml_escape(work.source_url)
            source_text = f'{source_label}<br/><link href="{source_url}">{source_url}</link>'
            story.append(Paragraph(source_text, source_style))
        for kind, text in work.blocks:
            story.append(Paragraph(reportlab_markup(text), heading_style if kind == "heading" else body_style))
        if work.notes:
            story.append(Paragraph("注释" if zh else "Notes", heading_style))
            for note_number, note in enumerate(work.notes, 1):
                story.append(Paragraph(f"{note_number}. {reportlab_markup(note)}", note_style))
        if work.slug == "about-author" and (IMAGE_DIR / "about-author.jpg").exists():
            story.append(Spacer(1, 4 * mm))
            story.append(Image(str(IMAGE_DIR / "about-author.jpg"), width=70 * mm, height=70 * mm, hAlign="CENTER"))
        if index != len(works) - 1:
            story.append(PageBreak())
    doc = SimpleDocTemplate(str(destination), pagesize=A5, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=19 * mm, bottomMargin=18 * mm, title=edition, author="rxxldq")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def tracked_files() -> list[str]:
    result = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True)
    return sorted(item.decode("utf-8") for item in result.stdout.split(b"\0") if item)


def commit_sha() -> str:
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def build_backup(destination: Path, publications: Iterable[Path]) -> None:
    files = tracked_files()
    listed_works = ordered_slugs()
    manifest = {
        "generated_at_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "commit_sha": commit_sha(),
        "source_files": [{"path": name, "sha256": sha256(ROOT / name)} for name in files],
        "article_counts": {"zh": len(listed_works), "en": len(listed_works)},
        "publication_files": [{"path": item.name, "sha256": sha256(item)} for item in publications],
    }
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in files:
            archive.write(ROOT / name, name)
        archive.writestr("EXPORT-MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def export_all() -> list[Path]:
    OUTPUT.mkdir(exist_ok=True)
    paths = {
        "zh_pdf": OUTPUT / "rxxldq-writing-archive-zh.pdf",
        "zh_epub": OUTPUT / "rxxldq-writing-archive-zh.epub",
        "en_pdf": OUTPUT / "rxxldq-writing-archive-en.pdf",
        "en_epub": OUTPUT / "rxxldq-writing-archive-en.epub",
    }
    build_pdf("zh", paths["zh_pdf"])
    build_epub("zh", paths["zh_epub"])
    build_pdf("en", paths["en_pdf"])
    build_epub("en", paths["en_epub"])
    backup = OUTPUT / "rxxldq-complete-backup.zip"
    build_backup(backup, paths.values())
    return [backup, paths["zh_pdf"], paths["zh_epub"], paths["en_pdf"], paths["en_epub"]]


def main() -> int:
    parser = argparse.ArgumentParser(description="Export the writing archive as backup, PDF, and EPUB editions.")
    parser.add_argument("--output", type=Path, help="Override the default output directory (for CI/tests).")
    args = parser.parse_args()
    global OUTPUT
    if args.output:
        OUTPUT = args.output.resolve()
    for item in export_all():
        print(f"{item.name}\t{item.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
