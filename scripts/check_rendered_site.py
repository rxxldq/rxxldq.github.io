from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse


PUBLIC_ORIGIN = "https://rxxldq.github.io"
UNRESOLVED_LIQUID = ("{{", "{%")


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()
        self.duplicate_ids: set[str] = set()
        self.references: list[tuple[str, str]] = []
        self.canonicals: list[str] = []
        self.has_html_lang = False
        self.has_viewport = False
        self.has_noindex = False
        self.missing_image_alt = 0
        self.in_title = False
        self.title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()

        element_id = values.get("id")
        if element_id:
            if element_id in self.ids:
                self.duplicate_ids.add(element_id)
            self.ids.add(element_id)

        if tag == "html" and values.get("lang").strip():
            self.has_html_lang = True
        elif tag == "title":
            self.in_title = True
        elif tag == "meta":
            name = values.get("name", "").lower()
            content = values.get("content", "").lower()
            if name == "viewport" and "width=device-width" in content:
                self.has_viewport = True
            if name == "robots" and "noindex" in content:
                self.has_noindex = True
        elif tag == "link":
            rel = {part.lower() for part in values.get("rel", "").split()}
            href = values.get("href", "")
            if "canonical" in rel and href:
                self.canonicals.append(href)
        elif tag == "img" and "alt" not in values:
            self.missing_image_alt += 1

        for attribute in ("href", "src"):
            value = values.get(attribute)
            if value:
                self.references.append((attribute, value))

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)

    @property
    def title(self) -> str:
        return "".join(self.title_parts).strip()


def output_target(site_root: Path, page: Path, raw_url: str) -> tuple[Path | None, str]:
    url = raw_url.strip()
    if not url or url.startswith(("mailto:", "tel:", "javascript:", "data:")):
        return None, ""

    parsed = urlparse(url)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme not in ("http", "https"):
            return None, ""
        if parsed.netloc.lower() != urlparse(PUBLIC_ORIGIN).netloc:
            return None, ""
        path = unquote(parsed.path)
    elif url.startswith("#"):
        return page, unquote(parsed.fragment)
    else:
        page_url = "/" + page.relative_to(site_root).as_posix()
        path = unquote(urlparse(urljoin(PUBLIC_ORIGIN + page_url, url)).path)

    relative = path.lstrip("/")
    candidate = site_root / relative
    if not relative or path.endswith("/"):
        candidate = candidate / "index.html"
    elif not candidate.exists() and not candidate.suffix:
        candidate = candidate / "index.html"
    return candidate, unquote(parsed.fragment)


def parse_page(path: Path) -> tuple[PageParser, str]:
    text = path.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(text)
    parser.close()
    return parser, text


def check_rendered_site(site_root: Path) -> list[str]:
    errors: list[str] = []
    if not site_root.is_dir():
        return [f"rendered site directory does not exist: {site_root}"]

    html_files = sorted(site_root.rglob("*.html"))
    if not html_files:
        return [f"no rendered HTML files found in {site_root}"]
    if not (site_root / "index.html").exists():
        errors.append("rendered homepage is missing: index.html")

    parsed_pages: dict[Path, PageParser] = {}
    for path in html_files:
        relative = path.relative_to(site_root).as_posix()
        parser, text = parse_page(path)
        parsed_pages[path.resolve()] = parser

        for marker in UNRESOLVED_LIQUID:
            if marker in text:
                errors.append(f"{relative}: unresolved Liquid marker {marker}")
        if not parser.has_html_lang:
            errors.append(f"{relative}: html element is missing a language")
        if not parser.has_viewport:
            errors.append(f"{relative}: responsive viewport metadata is missing")
        if not parser.title:
            errors.append(f"{relative}: document title is empty")
        if parser.duplicate_ids:
            errors.append(
                f"{relative}: duplicate element id(s): {', '.join(sorted(parser.duplicate_ids))}"
            )
        if parser.missing_image_alt:
            errors.append(f"{relative}: {parser.missing_image_alt} image(s) are missing alt text")
        if not parser.has_noindex:
            if len(parser.canonicals) != 1:
                errors.append(
                    f"{relative}: expected exactly one canonical URL, found {len(parser.canonicals)}"
                )
            elif not parser.canonicals[0].startswith(PUBLIC_ORIGIN + "/"):
                errors.append(f"{relative}: canonical URL is outside {PUBLIC_ORIGIN}")

    for page, parser in parsed_pages.items():
        relative = page.relative_to(site_root).as_posix()
        for attribute, url in parser.references:
            target, fragment = output_target(site_root, page, url)
            if target is None:
                continue
            resolved = target.resolve()
            if not resolved.is_relative_to(site_root.resolve()):
                errors.append(f"{relative}: {attribute} escapes the rendered site: {url}")
                continue
            if not resolved.exists():
                errors.append(f"{relative}: broken internal {attribute}: {url}")
                continue
            if fragment and resolved.suffix.lower() == ".html":
                target_parser = parsed_pages.get(resolved)
                if target_parser is None:
                    target_parser, _ = parse_page(resolved)
                    parsed_pages[resolved] = target_parser
                if fragment not in target_parser.ids:
                    errors.append(f"{relative}: missing fragment target in {url}")

    for xml_name in ("feed.xml", "sitemap.xml"):
        xml_path = site_root / xml_name
        if not xml_path.exists():
            errors.append(f"rendered {xml_name} is missing")
            continue
        try:
            root = ET.parse(xml_path).getroot()
        except ET.ParseError as error:
            errors.append(f"{xml_name}: invalid XML: {error}")
            continue
        urls = []
        for element in root.iter():
            if element.text and element.tag.rsplit("}", 1)[-1] in ("loc", "link"):
                value = element.text.strip()
                if value.startswith(PUBLIC_ORIGIN):
                    urls.append(value)
            href = element.attrib.get("href", "").strip()
            if href.startswith(PUBLIC_ORIGIN):
                urls.append(href)
        for url in urls:
            target, _ = output_target(site_root, site_root / "index.html", url)
            if target is not None and not target.exists():
                errors.append(f"{xml_name}: URL has no rendered page: {url}")

    return errors


def main() -> int:
    site_root = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
    errors = check_rendered_site(site_root)
    if errors:
        print("Rendered site check failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    count = len(list(site_root.rglob("*.html")))
    print(f"Rendered site check passed: {count} HTML pages, internal links and XML verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
