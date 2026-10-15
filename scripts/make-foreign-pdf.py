"""Writes a test PDF whose annotations were made by another tool (PyMuPDF), for import tests:
page 1 has an arrow line (start and end set with /LE), a dashed rectangle, a callout, a stamp and a file attachment.
Usage: python scripts/make-foreign-pdf.py out.pdf
"""
import sys

import pymupdf

out = sys.argv[1]
doc = pymupdf.open()
page = doc.new_page(width=595, height=842)
page.insert_text((60, 80), "Annotations made by another tool", fontsize=18)

line = page.add_line_annot((80, 200), (300, 200))
line.set_line_ends(pymupdf.PDF_ANNOT_LE_NONE, pymupdf.PDF_ANNOT_LE_OPEN_ARROW)
line.set_border(width=2)
line.set_colors(stroke=(0, 0, 1))
line.update()

rect = page.add_rect_annot(pymupdf.Rect(80, 260, 300, 340))
rect.set_border(width=2, dashes=[6, 3])
rect.set_colors(stroke=(1, 0, 0))
rect.update()

callout = page.add_freetext_annot(
    pymupdf.Rect(340, 380, 520, 430),
    "Callout from another tool",
    fontsize=11,
    callout=((360, 520), (360, 450), (340, 430)),
    line_end=pymupdf.PDF_ANNOT_LE_OPEN_ARROW,
)
callout.update()

stamp = page.add_stamp_annot(pymupdf.Rect(80, 560, 260, 620), stamp=0)
stamp.update()

attach = page.add_file_annot((420, 600), b"attached notes\n", "notes.txt")
attach.update()

doc.save(out)
print(out)
