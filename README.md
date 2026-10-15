# OpenPDF

Open-source PDF workbench for Windows (MIT). Goal: feature parity with PDF-XChange Editor. See [ROADMAP.md](ROADMAP.md).

Stack: Electron, React, TypeScript, PDFium (WASM, via `@hyzyla/pdfium`).

## Develop

```bash
npm install
npm run dev        # start with hot reload
npm run build      # production build to out/
npm run typecheck
```

Pass a PDF on the command line to open it at start: `npx electron . file.pdf`.

## Status

Phase 0 and most of Phase 1 are in: tabs, drag and drop, command-line open, continuous scroll with lazy rendering, fit-width/fit-page/preset zoom, thumbnails, bookmarks, find (match case, whole word, highlight all), and text selection with copy. PDFium runs in a Web Worker.

Also: password-protected files and a hand tool. Annotations: highlight, underline, strikeout, sticky notes, text boxes, lines, arrows, rectangles, ellipses, pencil and text stamps, with undo/redo, written into the PDF on Save (Ctrl+S) or Save as (Ctrl+Shift+S). Saving is not supported for password-protected files yet,. Existing highlight, underline, strikeout, note and text box annotations can be edited and deleted; other annotation types are shown but not editable yet. Not yet: print, rotate view, page modes. See [ROADMAP.md](ROADMAP.md).

Shortcuts: Ctrl+O open, Ctrl+W close tab, Ctrl+Tab next tab, Ctrl+F find, F3 / Shift+F3 next/previous match, Ctrl+C copy selection, Ctrl+= / Ctrl+- zoom, Ctrl+0 fit width, Ctrl+1 100%.

Test PDF with text and bookmarks: `python scripts/make-test-pdf.py out.pdf`.
