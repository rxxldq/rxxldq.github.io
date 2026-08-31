#!/usr/bin/env python3
"""End-to-end structural checks for archive exports."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import export_archive  # noqa: E402


class ArchiveExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temp.name) / "output"
        export_archive.OUTPUT = cls.output
        cls.paths = export_archive.export_all()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def test_exactly_five_outputs_and_no_tracked_outputs(self) -> None:
        expected = {
            "rxxldq-complete-backup.zip",
            "rxxldq-writing-archive-zh.pdf",
            "rxxldq-writing-archive-zh.epub",
            "rxxldq-writing-archive-en.pdf",
            "rxxldq-writing-archive-en.epub",
        }
        self.assertEqual({path.name for path in self.paths}, expected)
        tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
        self.assertFalse(any(name.startswith("output/") for name in tracked))

    def test_pdfs_open_and_have_text(self) -> None:
        expected_english = [work.title for work in export_archive.publication_works("en")]
        for language in ("zh", "en"):
            pdf = self.output / f"rxxldq-writing-archive-{language}.pdf"
            reader = PdfReader(str(pdf))
            self.assertGreater(len(reader.pages), 15)
            extracted = "".join(page.extract_text() or "" for page in reader.pages)
            self.assertGreater(len(extracted.strip()), 1000)
            if language == "en":
                for title in expected_english:
                    self.assertIn(title, extracted)
                self.assertTrue("lib.ru" in extracted or "Ivan Bunin" in extracted)
            else:
                self.assertEqual(reader.metadata.title, "中文写作档案")
                self.assertTrue("lib.ru" in extracted or "蒲宁" in extracted)

    def test_epubs_are_valid_structural_epub3(self) -> None:
        expected_titles = {
            "zh": [work.title for work in export_archive.publication_works("zh")],
            "en": [work.title for work in export_archive.publication_works("en")],
        }
        for language, titles in expected_titles.items():
            epub = self.output / f"rxxldq-writing-archive-{language}.epub"
            with zipfile.ZipFile(epub) as archive:
                info = archive.infolist()[0]
                self.assertEqual(info.filename, "mimetype")
                self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
                self.assertEqual(archive.read("mimetype"), b"application/epub+zip")
                ET.fromstring(archive.read("META-INF/container.xml"))
                ET.fromstring(archive.read("OEBPS/content.opf"))
                nav = archive.read("OEBPS/nav.xhtml").decode("utf-8")
                self.assertEqual(nav.count("chapter-"), 15)
                chapters = sorted(name for name in archive.namelist() if name.startswith("OEBPS/chapter-"))
                self.assertEqual(len(chapters), 15)
                combined = "\n".join(archive.read(name).decode("utf-8") for name in chapters)
                for title in titles:
                    self.assertIn(title, combined)
                self.assertNotIn("data-note", combined)
                self.assertNotIn("note-ref", combined)
                self.assertNotIn("{{", combined)
                self.assertNotIn("{%", combined)
                if language == "en":
                    self.assertEqual(combined.count('<li id="note-'), 14)
                    self.assertIn("Ivan Bunin", combined)

    def test_backup_has_every_tracked_source_and_manifest(self) -> None:
        backup = self.output / "rxxldq-complete-backup.zip"
        tracked = export_archive.tracked_files()
        with zipfile.ZipFile(backup) as archive:
            names = set(archive.namelist())
            self.assertTrue(set(tracked).issubset(names))
            manifest = json.loads(archive.read("EXPORT-MANIFEST.json"))
            self.assertEqual([entry["path"] for entry in manifest["source_files"]], tracked)
            self.assertEqual(manifest["article_counts"], {"zh": 14, "en": 14})
            self.assertEqual(len(manifest["publication_files"]), 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
