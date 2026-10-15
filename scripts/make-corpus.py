"""Builds the generated test corpus: PDFs that exercise the structures and damage real files have.
Usage: python scripts/make-corpus.py out_dir
Files whose names contain "pw-<password>" are encrypted with that user password. All content is our own."""
import os
import sys
import pymupdf

out = sys.argv[1]
os.makedirs(out, exist_ok=True)


def path(name):
    return os.path.join(out, name)


def text_page(doc, label, w=595, h=842):
    p = doc.new_page(width=w, height=h)
    p.insert_text((min(50, w / 4), min(60, h / 2)), label, fontsize=min(14, max(4, h / 10)))
    return p


def save_raw(name, objects, header=b"%PDF-1.4", xref=True, trailer_extra=b""):
    """A hand-written PDF from numbered object bodies (bytes), for structures pymupdf will not produce."""
    data = bytearray(header + b"\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(data))
        data += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    start = len(data)
    if xref:
        data += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
        for o in offsets:
            data += b"%010d 00000 n \n" % o
    data += b"trailer\n<< /Size %d /Root 1 0 R %s>>\n" % (len(objects) + 1, trailer_extra)
    if xref:
        data += b"startxref\n%d\n" % start
    data += b"%%EOF\n"
    open(path(name), "wb").write(data)


def stream(content, extra=b""):
    return b"<< /Length %d %s>>\nstream\n" % (len(content), extra) + content + b"\nendstream"


# 1. Plain text.
d = pymupdf.open()
for i in range(3):
    text_page(d, f"Plain page {i + 1}")
d.save(path("plain.pdf"))

# 2. Every page rotation.
d = pymupdf.open()
for r in (0, 90, 180, 270):
    p = text_page(d, f"Rotated {r}")
    p.set_rotation(r)
d.save(path("rotations.pdf"))

# 3. Mixed and extreme page sizes (smallest and largest the format allows in practice).
d = pymupdf.open()
for w, h in ((842, 1191), (612, 792), (72, 72), (14400, 14400), (3, 3)):
    text_page(d, f"{w} x {h}", w, h)
d.save(path("sizes.pdf"))

# 4. Crop box inside the media box, and a media box with a negative origin.
d = pymupdf.open()
p = text_page(d, "Cropped")
p.set_cropbox(pymupdf.Rect(40, 40, 400, 500))
d.save(path("cropbox.pdf"))
save_raw(
    "negative-origin.pdf",
    [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [-300 -400 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        stream(b"BT /F1 24 Tf -200 0 Td (Negative origin) Tj ET"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ],
)

# 5. Every annotation kind pymupdf can make.
d = pymupdf.open()
p = text_page(d, "Annotations: the quick brown fox jumps over the lazy dog")
words = p.search_for("quick brown")
p.add_highlight_annot(words)
p.add_underline_annot(p.search_for("fox"))
p.add_strikeout_annot(p.search_for("lazy"))
p.add_squiggly_annot(p.search_for("dog"))
p.add_text_annot((300, 120), "A note")
p.add_freetext_annot(pymupdf.Rect(50, 150, 250, 200), "Free text", fontsize=11)
p.add_line_annot((50, 250), (250, 300))
p.add_rect_annot(pymupdf.Rect(300, 250, 400, 320))
p.add_circle_annot(pymupdf.Rect(420, 250, 520, 320))
p.add_polygon_annot([(50, 400), (150, 380), (120, 460)])
p.add_polyline_annot([(200, 400), (260, 440), (320, 400)])
p.add_ink_annot([[(350, 400), (380, 430), (410, 400), (440, 430)]])
p.add_stamp_annot(pymupdf.Rect(50, 500, 250, 560), stamp=0)
p.add_caret_annot((300, 520))
p.add_file_annot((400, 520), b"attached bytes", "notes.txt")
d.save(path("annots.pdf"))

# 6. Two thousand annotations on one page.
d = pymupdf.open()
p = text_page(d, "Many annotations")
for i in range(2000):
    x, y = 20 + (i % 50) * 11, 80 + (i // 50) * 18
    p.add_rect_annot(pymupdf.Rect(x, y, x + 8, y + 12))
d.save(path("many-annots.pdf"))

# 7. Form fields.
d = pymupdf.open()
p = text_page(d, "Form")
for kind, rect, extra in (
    (pymupdf.PDF_WIDGET_TYPE_TEXT, (50, 100, 250, 125), {"field_value": "Text"}),
    (pymupdf.PDF_WIDGET_TYPE_CHECKBOX, (50, 140, 65, 155), {"field_value": True}),
    (pymupdf.PDF_WIDGET_TYPE_COMBOBOX, (50, 170, 250, 195), {"choice_values": ["One", "Two"], "field_value": "Two"}),
    (pymupdf.PDF_WIDGET_TYPE_LISTBOX, (50, 210, 250, 260), {"choice_values": ["A", "B", "C"], "field_value": "B"}),
):
    w = pymupdf.Widget()
    w.field_type = kind
    w.field_name = f"field{kind}"
    w.rect = pymupdf.Rect(*rect)
    for k, v in extra.items():
        setattr(w, k, v)
    p.add_widget(w)
d.save(path("form.pdf"))

# 8. Encryption: AES-256 and RC4-128, each with a user password.
for method, name in ((pymupdf.PDF_ENCRYPT_AES_256, "aes256"), (pymupdf.PDF_ENCRYPT_RC4_128, "rc4")):
    d = pymupdf.open()
    text_page(d, f"Encrypted {name}")
    d.save(path(f"encrypted-{name}-pw-user.pdf"), encryption=method, user_pw="user", owner_pw="owner", permissions=pymupdf.PDF_PERM_PRINT)
# Owner password only: opens without a password.
d = pymupdf.open()
text_page(d, "Owner password only")
d.save(path("encrypted-owner-only.pdf"), encryption=pymupdf.PDF_ENCRYPT_AES_128, owner_pw="owner", permissions=pymupdf.PDF_PERM_PRINT)

# 9. Incremental update on top of a saved file.
d = pymupdf.open()
text_page(d, "Original")
d.save(path("incremental.pdf"))
d = pymupdf.open(path("incremental.pdf"))
d[0].insert_text((50, 120), "Added in an incremental update", fontsize=12)
d.saveIncr()

# 10. Object streams and compressed cross-reference.
d = pymupdf.open()
for i in range(5):
    text_page(d, f"Object streams {i + 1}")
d.save(path("objstm.pdf"), use_objstms=1, garbage=3, deflate=True)

# 11. Damage: wrong startxref, no xref at all, truncated, missing %%EOF, junk before the header.
good = open(path("plain.pdf"), "rb").read()
i = good.rfind(b"startxref")
open(path("bad-startxref.pdf"), "wb").write(good[:i] + b"startxref\n999999\n%%EOF\n")
open(path("truncated.pdf"), "wb").write(good[: int(len(good) * 0.85)])
open(path("no-eof.pdf"), "wb").write(good.replace(b"%%EOF", b""))
open(path("junk-before-header.pdf"), "wb").write(b"JUNK" * 200 + good)
save_raw(
    "no-xref.pdf",
    [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>",
        stream(b"0 0 1 rg 50 50 200 200 re f"),
    ],
    header=b"%PDF-1.0",
    xref=False,
)

# 12. Inherited MediaBox, Resources and Rotate from the page tree; a page with no contents.
save_raw(
    "inherited.pdf",
    [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 3 /MediaBox [0 0 400 300] /Rotate 90 /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
        stream(b"BT /F1 20 Tf 30 150 Td (Inherited box and font) Tj ET"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
        b"<< /Type /Pages /Parent 2 0 R /Kids [7 0 R 8 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 6 0 R >>",
        b"<< /Type /Page /Parent 6 0 R /Contents [9 0 R 10 0 R] /MediaBox [0 0 200 200] >>",
        stream(b"q 1 0 0 rg 10 10 80 80 re f"),
        stream(b"Q BT /F1 12 Tf 20 150 Td (Split contents) Tj ET"),
    ],
)

# 13. Unicode, deeply nested bookmarks and page labels.
d = pymupdf.open()
for i in range(12):
    text_page(d, f"Labelled page {i + 1}")
toc = [[1, "Préface — überblick", 1], [1, "目录 第一章", 2]]
for lvl in range(2, 12):
    toc.append([lvl, f"Level {lvl} ✓", lvl])
d.set_toc(toc)
d.set_page_labels([{"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 1}, {"startpage": 3, "prefix": "A-", "style": "D", "firstpagenum": 1}])
d.embfile_add("readme.txt", b"Embedded file contents", filename="readme.txt")
d.save(path("unicode-outline.pdf"))

# 14. Pictures: JPEG, grey, picture with transparency, CMYK JPEG.
d = pymupdf.open()
p = text_page(d, "Pictures")
rgb = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 80), False)
rgb.set_rect(rgb.irect, (200, 60, 40))
p.insert_image(pymupdf.Rect(50, 100, 170, 180), stream=rgb.tobytes("jpeg"))
grey = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 120, 80), False)
grey.set_rect(grey.irect, (128,))
p.insert_image(pymupdf.Rect(200, 100, 320, 180), pixmap=grey)
alpha = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 80), True)
alpha.set_rect(alpha.irect, (20, 120, 220, 128))
p.insert_image(pymupdf.Rect(350, 100, 470, 180), pixmap=alpha)
cmyk = pymupdf.Pixmap(pymupdf.csCMYK, pymupdf.IRect(0, 0, 120, 80), False)
cmyk.set_rect(cmyk.irect, (0, 200, 200, 0))
p.insert_image(pymupdf.Rect(50, 220, 170, 300), pixmap=cmyk)
d.save(path("pictures.pdf"))

# 15. Optional content (layers).
d = pymupdf.open()
p = text_page(d, "Layers")
on = d.add_ocg("Visible layer", on=True)
off = d.add_ocg("Hidden layer", on=False)
p.insert_text((50, 120), "On layer", oc=on)
p.insert_text((50, 150), "Off layer", oc=off)
d.save(path("layers.pdf"))

# 16. CJK text with an embedded font subset.
d = pymupdf.open()
p = d.new_page()
p.insert_font(fontname="cjk", fontbuffer=pymupdf.Font("cjk").buffer)
p.insert_text((50, 80), "汉字 かな 한글", fontname="cjk", fontsize=20)
d.save(path("cjk.pdf"), garbage=3, deflate=True)

print("\n".join(sorted(os.listdir(out))))
