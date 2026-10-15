"""Large test PDF for performance checks: text, drawn tables, a picture every 20 pages, bookmarks and a few
comments. Usage: python scripts/make-big-pdf.py out.pdf [pages=500]"""
import sys
import pymupdf

out = sys.argv[1]
count = int(sys.argv[2]) if len(sys.argv) > 2 else 500
WORDS = ("drainage culvert pavement kerb channel embankment subgrade footpath bollard landscaping irrigation "
         "retaining wall stormwater manhole bitumen concrete reinforcement excavation backfill compaction").split()

doc = pymupdf.open()
pic = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 300), False)
pic.set_rect(pic.irect, (40, 110, 160))
pic.set_rect(pymupdf.IRect(50, 50, 350, 250), (230, 200, 60))
picture = pic.tobytes("jpeg")
toc = []
for i in range(count):
    p = doc.new_page(width=595, height=842)
    p.insert_text((50, 60), f"Section {i // 10 + 1} - page {i + 1}", fontsize=16)
    body = " ".join(WORDS[(i * 7 + k) % len(WORDS)] for k in range(260))
    p.insert_textbox(pymupdf.Rect(50, 80, 545, 420), body, fontsize=10)
    for r in range(12):
        y = 440 + r * 22
        p.draw_line((50, y), (545, y), color=(0.6, 0.6, 0.6), width=0.5)
        p.insert_text((55, y + 15), f"Item {r + 1}", fontsize=9)
        p.insert_text((400, y + 15), f"{(i * 31 + r * 17) % 997}.00", fontsize=9)
    if i % 20 == 0:
        p.insert_image(pymupdf.Rect(350, 720, 545, 815), stream=picture)
    if i % 50 == 0:
        p.add_text_annot((520, 40), f"Review page {i + 1}")
    if i % 10 == 0:
        toc.append([1, f"Section {i // 10 + 1}", i + 1])
doc.set_toc(toc)
doc.save(out, deflate=True, garbage=3)
print(out, count, "pages")
