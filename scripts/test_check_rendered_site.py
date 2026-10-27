from __future__ import annotations

import tempfile
from pathlib import Path

from check_rendered_site import check_rendered_site


META_SCRIPT = """<script>try{localStorage.getItem("rxxldq:theme:v1");localStorage.getItem("rxxldq:text-size:v1")}catch(e){}</script>"""
HOME = """<!doctype html>
<html lang="zh-CN"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f8f5ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1c1915" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<script>try{localStorage.getItem("rxxldq:theme:v1");localStorage.getItem("rxxldq:text-size:v1")}catch(e){}</script>
<title>Home</title><link rel="canonical" href="https://rxxldq.club/">
<link rel="icon" type="image/png" href="/images/map.png">
</head><body class="home-page"><div id="work-article"><a href="/article.html#text">Article</a></div><img src="/image.png" alt=""><button class="site-footer-button theme-toggle" type="button" aria-pressed="false">Dark</button></body></html>
"""
ARTICLE = """<!doctype html>
<html lang="en"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f8f5ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1c1915" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<script>try{localStorage.getItem("rxxldq:theme:v1");localStorage.getItem("rxxldq:text-size:v1")}catch(e){}</script>
<title>Article</title><link rel="canonical" href="https://rxxldq.club/article.html">
<link rel="icon" type="image/png" href="/images/map.png">
</head><body><div class="reading-settings"><button class="theme-toggle" type="button">Dark</button></div><main id="text"><article class="article-body">Text</article></main><a class="back-home" href="/#work-article">Index</a></body></html>
"""
NOT_FOUND = """<!doctype html>
<html lang="zh-CN"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f8f5ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1c1915" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<script>try{localStorage.getItem("rxxldq:theme:v1");localStorage.getItem("rxxldq:text-size:v1")}catch(e){}</script>
<meta name="robots" content="noindex">
<title>404</title>
<link rel="icon" type="image/png" href="/images/map.png">
</head><body><a href="/">Home</a></body></html>
"""
FEED = """<?xml version="1.0"?><rss><channel><link>https://rxxldq.club/</link><language>zh-CN</language></channel></rss>"""
FEED_EN = """<?xml version="1.0"?><rss><channel><link>https://rxxldq.club/</link><language>en</language></channel></rss>"""
ROBOTS = "User-agent: *\nAllow: /\nSitemap: https://rxxldq.club/sitemap.xml\n"
SITEMAP = """<?xml version="1.0"?><urlset><url><loc>https://rxxldq.club/article.html</loc></url></urlset>"""


def write_fixture(root: Path) -> None:
    (root / "index.html").write_text(HOME, encoding="utf-8")
    (root / "article.html").write_text(ARTICLE, encoding="utf-8")
    (root / "404.html").write_text(NOT_FOUND, encoding="utf-8")
    (root / "feed.xml").write_text(FEED, encoding="utf-8")
    (root / "feed-en.xml").write_text(FEED_EN, encoding="utf-8")
    (root / "robots.txt").write_text(ROBOTS, encoding="utf-8")
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
            ("<meta name=\"theme-color\" content=\"#f8f5ee\" media=\"(prefers-color-scheme: light)\">", "theme-color metadata"),
            ("<meta name=\"theme-color\" content=\"#1c1915\" media=\"(prefers-color-scheme: dark)\">", "theme-color metadata"),
            ("<meta name=\"color-scheme\" content=\"light dark\">", "color-scheme metadata"),
            (META_SCRIPT, "theme anti-flash script"),
            ("<link rel=\"icon\" type=\"image/png\" href=\"/images/map.png\">", "favicon link"),
        )
        for page_name in ("index.html", "article.html", "404.html"):
            original = (root / page_name).read_text(encoding="utf-8")
            for markup, error_label in identity_markup:
                (root / page_name).write_text(original.replace(markup, ""), encoding="utf-8")
                errors = check_rendered_site(root)
                assert any(f"{page_name}: {error_label}" in error for error in errors)
            (root / page_name).write_text(original, encoding="utf-8")

        feature_markup = (
            ("index.html", "<button class=\"site-footer-button theme-toggle\" type=\"button\" aria-pressed=\"false\">Dark</button>", "homepage theme toggle"),
            ("article.html", "<div class=\"reading-settings\"><button class=\"theme-toggle\" type=\"button\">Dark</button></div>", "reading settings controls"),
        )
        for page_name, markup, error_label in feature_markup:
            original = (root / page_name).read_text(encoding="utf-8")
            assert markup in original
            (root / page_name).write_text(original.replace(markup, ""), encoding="utf-8")
            assert any(f"{page_name}: {error_label}" in error for error in check_rendered_site(root))
            (root / page_name).write_text(original, encoding="utf-8")
        original = (root / "index.html").read_text(encoding="utf-8")
        (root / "index.html").write_text(original.replace("light dark", "light"), encoding="utf-8")
        assert any("index.html: color-scheme metadata" in error for error in check_rendered_site(root))
        (root / "index.html").write_text(original, encoding="utf-8")

        (root / "robots.txt").unlink()
        assert any("robots.txt is missing" in error for error in check_rendered_site(root))
        (root / "robots.txt").write_text(ROBOTS, encoding="utf-8")
        (root / "feed-en.xml").write_text("<rss>", encoding="utf-8")
        assert any("feed-en.xml: invalid XML" in error for error in check_rendered_site(root))
        (root / "feed-en.xml").unlink()
        assert any("feed-en.xml is missing" in error for error in check_rendered_site(root))
        (root / "feed-en.xml").write_text(FEED_EN, encoding="utf-8")
        assert check_rendered_site(root) == []

        english_item = "<item><link>https://rxxldq.club/article.html</link></item>"
        (root / "feed-en.xml").write_text(FEED_EN.replace("</channel>", english_item + "</channel>"), encoding="utf-8")
        assert any("feed-en.xml: expected 0 items" in error for error in check_rendered_site(root))
        (root / "feed-en.xml").write_text(FEED_EN, encoding="utf-8")

        (root / "index.html").write_text(HOME.replace('id="work-article"', ''), encoding="utf-8")
        errors = check_rendered_site(root)
        assert any("article.html: missing fragment target in /#work-article" in error for error in errors)

        (root / "index.html").write_text(HOME.replace("/article.html#text", "/missing.html"), encoding="utf-8")
        errors = check_rendered_site(root)
        assert any("broken internal href: /missing.html" in error for error in errors)

        (root / "index.html").write_text(HOME.replace("<body class=\"home-page\">", "<body class=\"home-page\"><span id=\"same\"></span><span id=\"same\"></span>{{ unresolved }}"), encoding="utf-8")
        errors = check_rendered_site(root)
        assert any("duplicate element id(s): same" in error for error in errors)
        assert any("unresolved Liquid marker {{" in error for error in errors)

    print("Rendered site checker tests passed.")


if __name__ == "__main__":
    main()
