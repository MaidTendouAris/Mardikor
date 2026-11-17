"""Independent PDF rendering checks for the test:publication fixture.

Usage: python scripts/verify-publication.py [path/to/latest.json]
Requires pdfplumber, pypdfium2 and Pillow (available in the bundled runtime).
"""

import json
import logging
from pathlib import Path
import sys

import pdfplumber
import pypdfium2 as pdfium


logging.getLogger("pdfminer").setLevel(logging.ERROR)
manifest = Path(sys.argv[1] if len(sys.argv) > 1 else ".test-artifacts/publication-packaged/latest.json")
fixture = json.loads(manifest.read_text(encoding="utf-8"))
run = Path(fixture["run"])
images = run / "verified-pages"
images.mkdir(exist_ok=True)

with pdfplumber.open(fixture["pdf"]) as document:
    text = "".join(page.extract_text() or "" for page in document.pages)
    assert all(value in text for value in ["页", "这里验证中文段落", "第二章", "目录"])
    assert not any(0x2E80 <= ord(char) <= 0x2FDF for char in text)

with pdfplumber.open(run / "book-b.pdf") as document:
    assert len(document.pages) == 2
    assert "第 8 页" in document.pages[0].extract_text()
    assert document.pages[0].width > document.pages[0].height

book = pdfium.PdfDocument(fixture["pdf"])
for index in range(len(book)):
    book[index].render(scale=1.3).to_pil().save(images / f"book-{index + 1}.png")

comic = pdfium.PdfDocument(str(run / "comic.pdf"))
assert len(comic) == 2
blue_by_page = []
for index in range(len(comic)):
    image = comic[index].render(scale=1.3).to_pil().convert("RGB")
    image.save(images / f"comic-{index + 1}.png")
    left = right = 0
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue = pixels[x, y]
            if red < 80 and green < 150 and blue > 170:
                if x < image.width // 2:
                    left += 1
                else:
                    right += 1
    assert left + right > 10000, f"Comic page {index + 1} has no visible image"
    blue_by_page.append({"left": left, "right": right})

assert blue_by_page[0]["left"] > 10000 and blue_by_page[0]["right"] > 10000
assert blue_by_page[1]["right"] > 10000 and blue_by_page[1]["left"] == 0
result = {"book_pages": len(book), "comic_pages": len(comic), "comic_visible_pixels": blue_by_page, "search_text": "passed", "offset_numbering": "passed"}
(images / "verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result))
