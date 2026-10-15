# OpenPDF Roadmap

An open-source (MIT) PDF workbench for Windows, with feature parity with PDF-XChange Editor as the long-term goal.

**Stack:** Electron + React + TypeScript. PDFium (WASM) renders and edits. pdf-lib covers structural edits and saving. Tesseract (WASM) handles OCR.
**Clean-room rule:** match features, not code or assets. Do not copy PDF-XChange code, icons, strings or layouts.

Legend: `[ ]` not started. P0 = must have, P1 = should have, P2 = later.

## Phase 0: Foundation
- [ ] Repo, TypeScript, Vite, Electron, lint, test runner (Vitest + Playwright)
- [ ] PDFium WASM worker and render pipeline (tiles, DPI-aware, off main thread)
- [ ] Document model, undo/redo command stack, autosave and crash recovery
- [ ] Ribbon/toolbar shell, dockable panes, tabbed documents, dark and light themes
- [ ] Settings, keyboard shortcut map, file associations, recent files
- [ ] CI builds (Windows installer), MIT licence, CONTRIBUTING, third-party licence notices

## Phase 1: Viewer (P0)
- [x] Open, tabs, drag and drop
- [x] Password-protected files
- [x] Zoom: fit width, fit page, presets, Ctrl+/-; continuous scroll
- [ ] Marquee zoom, rotate view, single and two-page modes
- [x] Thumbnails, bookmarks/outline
- [ ] Attachments, layers, page labels
- [x] Text search (highlight all, whole word, match case, next/previous)
- [ ] Find in multiple files
- [x] Text select and copy
- [x] Hand and select tools
- [ ] Snapshot tool
- [ ] Print (page ranges, scaling, booklet, N-up), presentation/full-screen mode
- [ ] Read-aloud (system TTS), reading mode, accessibility (screen-reader, high contrast)
- [ ] Rulers, grid, guides, measurement tools (distance, perimeter, area)

## Phase 2: Annotation and markup (P0)
- [x] Highlight, underline, strikeout (from selected text)
- [ ] Squiggly, replace text, insert caret
- [x] Sticky note, text box (free text)
- [ ] Callout, typewriter
- [ ] Line, arrow, rectangle, ellipse, polygon, polyline, cloud, pencil/ink, eraser
- [ ] Stamps (built-in, custom image, dynamic with date, time and user)
- [ ] Comment list: sort, filter, reply threads, status, summarise, export
- [x] Colour choice, move, resize, delete, undo/redo, Save and Save As
- [ ] Properties panel (font, opacity, border), saved tool presets, custom tool sets
- [ ] Edit annotations already in a file (only newly drawn ones are editable)
- [ ] Attach file, sound and links; import and export FDF/XFDF
- [ ] Review: compare annotation sets across files

## Phase 3: Page and document organisation (P0)
- [ ] Rotate, delete, move, copy, extract, replace and insert pages
- [ ] Merge, split (by page count, bookmark, size), combine from multiple files
- [ ] Crop, resize, headers and footers, Bates numbering, page numbers
- [ ] Watermarks and backgrounds
- [ ] Bookmarks, page labels and link editing
- [ ] Optimise and compress, linearise, remove unused objects
- [ ] Document properties and metadata editing, XMP

## Phase 4: Content editing (P0/P1)
- [ ] Edit existing text (font match, reflow within a text box)
- [ ] Edit, move, resize and replace images
- [ ] Add and edit shapes and paths; object selection, align, distribute, z-order
- [ ] Add and edit links; add text and images
- [ ] Spell check

## Phase 5: Forms (P1)
- [ ] Fill AcroForms (text, checkbox, radio, combo, list, signature)
- [ ] Form field designer (all field types), tab order, calculation and format scripts
- [ ] Flatten, reset, import and export form data (FDF, XFDF, CSV, XML)
- [ ] Auto-detect form fields
- [ ] JavaScript field actions (sandboxed)

## Phase 6: Security and signatures (P1)
- [ ] Password and permission encryption (AES-256), remove security
- [ ] Redaction (text, region, search and redact, true content removal) and metadata sanitise
- [ ] Digital signatures: create, validate, timestamp, certificate store (Windows cert store)
- [ ] Visible signature appearances; certify documents
- [ ] Verify PDF/A and PDF/UA compliance flags

## Phase 7: OCR and conversion (P1)
- [ ] OCR scanned pages to searchable text (Tesseract WASM, multiple languages)
- [ ] Import: images, Word, Excel (via optional LibreOffice integration), HTML, text
- [ ] Export: images (PNG, JPEG, TIFF), text, Word (best effort), HTML
- [ ] Scan from TWAIN/WIA scanners
- [ ] Create PDF from clipboard and screenshots; PDF/A output

## Phase 8: Productivity and automation (P2)
- [ ] Batch processing and action wizard (watermark, OCR, optimise on folders)
- [ ] Command-line interface and scripting API
- [ ] Compare two documents (text and visual)
- [ ] Portfolios/packages, embedded files
- [ ] 3D, multimedia and rich media playback (low priority)
- [ ] Plugin API and extension store
- [ ] Optional cloud connectors (OneDrive, SharePoint, Google Drive)

## Phase 9: Polish and release
- [ ] Performance targets: open a 500-page file under 2 s to first page; memory cap on huge files
- [ ] Localisation (English-AU first), i18n framework
- [ ] Accessibility audit, installer, auto-update, telemetry off by default
- [ ] Test corpus (public-domain PDFs plus pdf.js and PDFium test suites), fuzz tests on parsers

## Risks and open questions
- **True text editing** is the hardest feature. PDFium has no reflow engine, so expect a staged approach (replace-within-line first).
- **Word export fidelity** will trail commercial tools. Treat it as best effort.
- **Digital signature trust lists** (AATL, EUTL) need sourcing and legal review.
- **Name clash:** "OpenPDF" is already a well-known Java library (LibrePDF/OpenPDF). Consider a different name before the public release.
- **Licence check:** PDFium is BSD-3/Apache-2.0, pdf-lib MIT, Tesseract Apache-2.0. Avoid MuPDF, iText and Ghostscript (AGPL) to keep MIT.
