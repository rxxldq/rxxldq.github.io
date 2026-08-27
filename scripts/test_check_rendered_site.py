from __future__ import annotations

import tempfile
from pathlib import Path

from check_rendered_site import check_rendered_site


HOME = """<!doctype html>
<html lang="zh-CN"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Home</title><link rel="canonical" href="https://rxxldq.github.io/">
</head><body><a href="/article.html#text">Article</a><img src="/image.png" alt=""></body></html>
"""
ARTICLE = """<!doctype html>
<html lang="en"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Article</title><link rel="canonical" href="https://rxxldq.github.io/article.html">
</head><body><main id="text">Text</main><a href="/">Home</a></body></html>
"""
FEED = """<?xml version="1.0"?><rss><channel><link>https://rxxldq.github.io/</link></channel></rss>"""
SITEMAP = """<?xml version="1.0"?><urlset><url><loc>https://rxxldq.github.io/article.html</loc></url></urlset>"""


def write_fixture(root: Path) -> None:
    (root / "index.html").write_text(HOME, encoding="utf-8")
    (root / "article.html").write_text(ARTICLE, encoding="utf-8")
    (root / "feed.xml").write_text(FEED, encoding="utf-8")
    (root / "sitemap.xml").write_text(SITEMAP, encoding="utf-8")
    (root / "image.png").write_bytes(b"png")


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        write_fixture(root)
        assert check_rendered_site(root) == []

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
