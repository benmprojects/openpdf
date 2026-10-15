# OpenPDF Roadmap

An open-source (MIT) PDF workbench for Windows, with feature parity with PDF-XChange Editor as the long-term goal.

**Stack:** Electron + React + TypeScript. PDFium (WASM) renders and edits. pdf-lib covers structural edits and saving. Tesseract (WASM) handles OCR.
**Clean-room rule:** match features, not code or assets. Do not copy PDF-XChange code, icons, strings or layouts.

Legend: `[ ]` not started. P0 = must have, P1 = should have, P2 = later.

## Phase 0: Foundation
- [x] Repo, TypeScript, Vite, Electron, lint, test runner (Vitest + Playwright)
- [x] PDFium WASM worker and render pipeline (tiles above 16 Mpx, DPI-aware, off main thread)
- [x] Document model, undo/redo, crash-recovery snapshots of unsaved work (no silent autosave to the file itself, on purpose)
- [x] Ribbon (File, Home, Comment, Organise, View) with icons, status bar, title-bar tab strip, tabbed documents, dark and light themes
- [x] Side pane docks left or right, resizable, remembered (floating panes not planned for now)
- [x] Settings, keyboard shortcut list (F1), recent files, single instance; .pdf file association in the installer config (installer not yet built on this machine)
- [x] MIT licence, CONTRIBUTING, third-party licence notices (`npm run licences`), CI workflow written
- [ ] CI run on a remote and a built NSIS installer (local build blocked: Windows refused to run the unsigned NSIS stub, EPERM)

## Phase 1: Viewer (P0)
- [x] Open, tabs, drag and drop
- [x] Password-protected files
- [x] Zoom: fit width, fit page, presets, Ctrl+/-; continuous scroll
- [x] Rotate view (view only, per tab, Ctrl+Shift++ / Ctrl+Shift+-)
- [x] Marquee zoom tool (drag to fit, click to zoom in, Shift+click out); single page or continuous; one or two pages per row; cover page
- [x] Thumbnails, bookmarks/outline
- [x] Attachments (list, save a copy), layers (show or hide, view only, printing follows the view), page labels (thumbnails, page box)
- [x] Text search (highlight all, whole word, match case, next/previous)
- [x] Find in multiple files (open documents or a folder, with subfolders; results with context; click to open at the match)
- [x] Text select and copy
- [x] Hand and select tools
- [x] Snapshot tool (drag a box; copies a 200 dpi PNG, turned with the view)
- [x] Print: page ranges, copies, fit or actual size, auto-rotate (output checked through the test hook; the system print dialog itself is not yet tested)
- [x] Booklet and N-up printing (2, 4, 6, 9, 16 per sheet), presentation mode (F5, full screen)
- [x] Read aloud (Windows voices; page by page or the selection; speed and voice), reading mode (Ctrl+H), night and high-contrast page colours, screen-reader text layer, Windows high-contrast support
- [x] Rulers (mm, cm, in, pt), grid, guides (drag from a ruler), snap; measurement of distance, perimeter and area with calibration and document scales (overlay; saving as annotations comes with Phase 2 polygons)

## Phase 2: Annotation and markup (P0)
- [x] Highlight, underline, strikeout (from selected text)
- [x] Squiggly, replace text (strikeout grouped with a caret), insert text (caret)
- [x] Sticky note, text box (free text)
- [x] Callout (leader line with arrow, /CL, /RD) and typewriter; imported callouts stay drawn by PDFium (their /CL is not readable through PDFium)
- [x] Line, arrow, rectangle, ellipse, pencil/ink (move, reshape, resize, colour, width)
- [x] Polygon, polyline, cloud, eraser (pencil strokes), fill colour, dashed and dotted lines; measurements saved as measurement annotations (LineDimension, PolyLineDimension, PolygonDimension with /Measure)
- [x] Stamps: built-in text stamps (colour, resize)
- [x] Custom image stamps (PNG/JPEG library in userData), dated stamps with name, date and time; stamp picker
- [x] Comment list: sort, filter, search, reply threads, review status, summary PDF, CSV export; author and dates on new comments
- [x] Colour choice, move, resize, delete, undo/redo, Save and Save As
- [x] Properties panel (colour, fill, opacity, line width and style, font and size, author; Ctrl+E), tool defaults saved in Settings, named tool presets
- [x] Edit annotations already in a file: highlight, underline, strikeout, note, text box (select, recolour, move, resize, edit text, delete; unedited ones are left byte-for-byte as they were)
- [x] Edit annotations from other tools: arrows by /LE, dashed styles, callouts by /CL, measurements by /Measure (read with pdf-lib in the worker); anything else (other stamps, file attachments, sounds) can be moved, resized, deleted and commented on; reply threads. Links are in Phase 3
- [x] Attach file and sound (WAV), links (follow, and add with the Link tool); import and export comments as XFDF and FDF
- [x] Review: compare comments with another copy (changed, only there, only here; add theirs, use their text and replies)

## Phase 3: Page and document organisation (P0)
- [x] Rotate, delete and reorder pages (thumbnail pane: select, right-click menu, drag; undo/redo; verified in the app)
- [x] Extract and insert pages (verified end to end with the dialog test hook: saved files checked with PyMuPDF; the real native dialog windows were not exercised)
- [x] Merge and split by page count (same; split never overwrites existing files)
- [x] Copy and paste pages (also between documents), duplicate, replace with pages from another PDF; split every N pages, at top-level bookmarks, or by file size
- [x] Crop (margins or crop tool, remove cropping), resize to a paper size (scale to fit), headers and footers with codes, Bates numbering, page numbers (Layout tab; marks are tagged so they can be removed)
- [x] Watermarks (text or picture, angle, opacity, over or behind) and backgrounds (colour or picture), removable
- [x] Bookmarks, page labels and link editing
- [x] Optimise and compress, linearise, remove unused objects
- [x] Document properties and metadata editing, XMP

## Phase 4: Content editing (P0/P1)
- [x] Edit existing text (font match, reflow within a text box): Edit tab > Edit text. A run, or a paragraph of several lines (rewrapped to its original width), is edited in place; redrawn in the installed font of the same family (Windows registry lookup, licence and glyph checks) or else a matching standard font
- [x] Edit, move, resize and replace images (Edit tab > Edit image: drag to move, corner to resize, Replace, Delete; page-level images only, not those inside form XObjects)
- [x] Add and edit shapes and paths; object selection, align, distribute, z-order (annotation shapes: Draw tab; Shift-click multi-select, align, distribute and stacking order of annotations: Edit tab; vector paths that are part of the page: Edit > Edit shape moves, resizes or deletes them)
- [x] Add and edit links; add text and images (links: Phase 3; text: Typewriter, Text box and callout tools, and Edit text for existing text; images: Edit > Add image places a PNG or JPEG as page content)
- [x] Spell check (the browser engine underlines misspelled words in text boxes; right-click gives suggestions and Add to dictionary; Settings can turn it off; Australian English when the system has it)

## Phase 5: Forms (P1)
- [x] Fill AcroForms (text, checkbox, radio, combo, list; signature fields are shown but signing is Phase 6): Forms tab. Fields are real controls over the page (PDFium draws no widgets), values are written with pdf-lib on save, print and page edits
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
