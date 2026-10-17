"""Generate a small multi-page PDF with text and a nested outline, for manual and automated testing.

Usage: python scripts/make-test-pdf.py out.pdf
"""
import sys

PAGES = 6
LINES = [
    "The quick brown fox jumps over the lazy dog.",
    "OpenPDF is an open-source PDF workbench.",
    "Search should find fox, FOX and Fox on every page.",
    "Selection should flow across lines and across pages.",
]

objs = []


def add(s):
    objs.append(s)
    return len(objs)


# Reserve object numbers: 1 catalog, 2 pages, 3 font, 4 outlines root
add(None)
add(None)
add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
add(None)

page_ids = []
for p in range(PAGES):
    w, h = (595, 842) if p % 2 == 0 else (842, 595)  # alternate portrait / landscape
    ops = [f"BT /F1 28 Tf 60 {h - 80} Td (Chapter page {p + 1}) Tj ET"]
    y = h - 130
    for line in LINES:
        ops.append(f"BT /F1 14 Tf 60 {y} Td ({line}) Tj ET")
        y -= 24
    ops.append(f"0.8 0.2 0.2 rg 60 {y - 80} 160 60 re f")
    content = "\n".join(ops)
    cid = add(f"<< /Length {len(content)} >>\nstream\n{content}\nendstream")
    pid = add(
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Contents {cid} 0 R "
        f"/Resources << /Font << /F1 3 0 R >> >> >>"
    )
    page_ids.append(pid)

# Outline: Part 1 (pages 1-3, with two children), Part 2 (page 4), Part 3 (page 6)
def item(title, page, parent, prev=None, nxt=None, first=None, last=None, count=None):
    s = f"<< /Title ({title}) /Parent {parent} 0 R /Dest [{page_ids[page]} 0 R /Fit]"
    if prev:
        s += f" /Prev {prev} 0 R"
    if nxt:
        s += f" /Next {nxt} 0 R"
    if first:
        s += f" /First {first} 0 R /Last {last} 0 R /Count {count}"
    return s + " >>"


base = len(objs) + 1  # ids for outline items
part1, part2, part3, c1, c2 = base, base + 1, base + 2, base + 3, base + 4
add(item("Part 1", 0, 4, nxt=part2, first=c1, last=c2, count=2))
add(item("Part 2", 3, 4, prev=part1, nxt=part3))
add(item("Part 3", 5, 4, prev=part2))
add(item("Section 1.1", 1, part1, nxt=c2))
add(item("Section 1.2", 2, part1, prev=c1))

objs[0] = "<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>"
objs[1] = f"<< /Type /Pages /Kids [{' '.join(f'{i} 0 R' for i in page_ids)}] /Count {PAGES} >>"
objs[3] = f"<< /Type /Outlines /First {part1} 0 R /Last {part3} 0 R /Count 5 >>"

out = "%PDF-1.4\n"
offs = []
for i, o in enumerate(objs, 1):
    offs.append(len(out))
    out += f"{i} 0 obj\n{o}\nendobj\n"
x = len(out)
out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n"
out += "".join(f"{o:010d} 00000 n \n" for o in offs)
out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n"
with open(sys.argv[1], "w", newline="") as f:
    f.write(out)
print(sys.argv[1])
