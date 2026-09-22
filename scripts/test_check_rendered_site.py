from __future__ import annotations

import tempfile
from pathlib import Path

from check_rendered_site import check_rendered_site


HOME = """<!doctype html>
<html lang="zh-CN"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#fbfaf7">
<meta name="color-scheme" content="light">
<title>Home</title><link rel="canonical" href="https://rxxldq.club/">
<link rel="icon" type="image/png" href="/images/map.png">
</head><body><a href="/article.html#text">Article</a><img src="/image.png" alt=""></body></html>
"""
ARTICLE = """<!doctype html>
<html lang="en"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#fbfaf7">
<meta name="color-scheme" content="light">
<title>Article</title><link rel="canonical" href="https://rxxldq.club/article.html">
<link rel="icon" type="image/png" href="/images/map.png">
</head><body><main id="text">Text</main><a href="/">Home</a></body></html>
"""
NOT_FOUND = """<!doctype html>
<html lang="zh-CN"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#fbfaf7">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex">
<title>404</title>
<link rel="icon" type="image/png" href="/images/map.png">
</head><body><a href="/">Home</a></body></html>
"""
FEED = """<?xml version="1.0"?><rss><channel><link>https://rxxldq.club/</link></channel></rss>"""
SITEMAP = """<?xml version="1.0"?><urlset><url><loc>https://rxxldq.club/article.html</loc></url></urlset>"""


def write_fixture(root: Path) -> None:
    (root / "index.html").write_text(HOME, encoding="utf-8")
    (root / "article.html").write_text(ARTICLE, encoding="utf-8")
    (root / "404.html").write_text(NOT_FOUND, encoding="utf-8")
    (root / "feed.xml").write_text(FEED, encoding="utf-8")
    (root / "sitemap.xml").write_text(SITEMAP, encoding="utf-8")
    (root / "image.png").write_bytes(b"png")
    (root / "images").mkdir()
    (root / "images" / "map.png").write_bytes(b"png")


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        write_fixture(root)
        assert check_rendered_site(root) == []

        identity_markup = (
            ("<meta name=\"theme-color\" content=\"#fbfaf7\">", "theme-color metadata"),
            ("<meta name=\"color-scheme\" content=\"light\">", "color-scheme metadata"),
            ("<link rel=\"icon\" type=\"image/png\" href=\"/images/map.png\">", "favicon link"),
        )
        for page_name in ("index.html", "article.html", "404.html"):
            original = (root / page_name).read_text(encoding="utf-8")
            for markup, error_label in identity_markup:
                (root / page_name).write_text(original.replace(markup, ""), encoding="utf-8")
                errors = check_rendered_site(root)
                assert any(f"{page_name}: {error_label}" in error for error in errors)
            (root / page_name).write_text(original, encoding="utf-8")

        (root / "index.html").write_text(HOME.replace("/article.html#text", "/missing.html"), encoding="utf-8")
        errors = check_rendered_site(root)
        assert any("broken internal href: /missing.html" in error for error in errors)

        (root / "index.html").write_text(HOME.replace("<body>", "<body><span id=\"same\"></span><span id=\"same\"></span>{{ unresolved }}"), encoding="utf-8")
        errors = check_rendered_site(root)
        assert any("duplicate element id(s): same" in error for error in errors)
        assert any("unresolved Liquid marker {{" in error for error in errors)

    print("Rendered site checker tests passed.")


if __name__ == "__main__":
    main()
