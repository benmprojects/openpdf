# Handoff

Everything below is committed (see `git log`). Phase 3 was built in a second session; the first session did Phases 0 to 2.

## Done
- Phase 0: Electron + Vite + React app, PDFium WASM worker, open via dialog, drag and drop, command line.
- Phase 1 (most): tabs, continuous scroll with lazy render, fit-width/fit-page/preset zoom, thumbnails, bookmarks, find (case, whole word, highlight all), text selection and copy, password-protected files, hand tool.
- Phase 2 (most): highlight, underline, strikeout, sticky notes, text boxes, line, arrow, rectangle, ellipse, pencil, text stamps. Undo/redo, colour, width, move, resize, endpoint reshape, delete. Save and Save as write real PDF annotations. Existing highlight, underline, strikeout, note, text box, line/arrow (Subj Line/Arrow), unfilled rectangle/ellipse, ink and our own stamps can be edited and deleted.
- Phase 1 additions (third session): rotate view and print.
  - Rotate view: toolbar ⟲ ⟳ and Ctrl+Shift++ / Ctrl+Shift+-. Per tab, view only, never marks the tab unsaved. The `.page` box takes the rotated size; inside it `.page-stack` keeps the unrotated page frame (canvas, annotation overlay, highlights) and gets a CSS transform. All screen-to-page conversions go through `viewRotation.ts` (`toPage`, `deltaToPage`, `toDisplay`), so the annotation model, text boxes and PDFium rendering are unchanged. Fit width/page uses the rotated sizes. Thumbnails stay unrotated.
  - Print: Print… button and Ctrl+P open a strip with pages (all, current, custom range), copies, fit to paper or actual size, and auto-rotate (landscape pages turned to fill portrait paper). Pending annotation edits are written into a copy first (same writer as Save), so the printout matches what Save would write; the file and the unsaved state are not touched. A separate PDFium worker renders one page at a time at 300 dpi (capped at 40 Mpx), encodes PNG and sends it to the main process, which spools to a temp folder; a hidden window lays out one image per sheet and calls `webContents.print` (system dialog). Temp folder is removed afterwards. Code: `print.ts`, `src/main/index.ts` (`print:*` handlers). Output is raster, so printed text is not selectable in a print-to-PDF.
- Phase 3 (first part): in the thumbnail pane, select pages (click, Ctrl, Shift, Ctrl+A), right-click menu (rotate, delete, extract, insert from file, split), Delete key, drag to reorder, a Merge button in the toolbar. Each operation applies and reloads at once; Ctrl+Z / Ctrl+Y undo and redo; the tab is marked unsaved and Save writes it. Code: `pageOps.ts`, `Sidebar.tsx`, `DocView.tsx`.

## Not done (see ROADMAP.md)
- Phase 1: booklet and N-up print, single and two-page modes, marquee zoom, snapshot tool, multi-file find, attachments, layers, page labels, rulers, measurement, read-aloud.
- Phase 2: squiggly, callout, typewriter, comment list and replies, properties panel, tool presets, FDF/XFDF, custom image stamps, polygon/polyline/cloud, eraser, fill colour, dashes, editing foreign annotation types.
- Phase 3: copy and replace pages, split by bookmark or size, crop, resize, headers and footers, Bates numbering, page numbers, watermarks, backgrounds, bookmark and page label editing, link editing, optimise and compress, metadata.
- Phases 4 to 9: content editing, forms, security/signatures/redaction, OCR/conversion, automation, polish.

## Verified and not verified
- Verified in the running app (CDP, on a copy of a test PDF): page selection, rotate with undo/redo, delete with undo and the Delete key, drag reorder with undo, the Extract and Split dialogs opening with the right prefilled values, no console errors, and the right-click menu staying inside the 798 px window (last thumb near the bottom, first thumb at the top-left, a click near the right edge; all eight items reachable; edges are within half a pixel of the window edge).
- Verified by script: `npx tsx scripts/pageops-check.mts` passes 10 of 10 (the pdf-lib operations and the page-range parser).
- Verified end to end with the dialog test hook (`OPENPDF_E2E=1`, see `src/main/index.ts`): insert (page order and undo), merge, extract (including a typed range) and split (two files, second run did not overwrite). Saved files were checked with PyMuPDF; no console errors.
- Rotate view, verified by CDP on a copy of the test PDF (6 pages, mixed portrait/landscape): page boxes swap size at 90/270 and return after four turns; both shortcuts; Save stays clean; note placement lands within 0.3 px of the click at 0/90/180/270; text selection at 90/180/270 lies on the drag path; search highlights sit on the text and the current match scrolls into view at every rotation; dragging a rectangle by (+60, +40) screen px moves it exactly that much on screen at 90/180/270, and a resize handle at 90 follows the mouse; no console errors.
- Print, verified with the print test hook (`OPENPDF_E2E=1` and `OPENPDF_E2E_PRINT=out.pdf` make the hidden window `printToPDF` to that path, A4, instead of opening the system dialog): all pages (6 non-blank A4 pages, landscape pages auto-rotated), custom range "1-2" at actual size (2 pages), current page (1 page), and an unsaved rectangle appears in the output while the tab stays unsaved.
- **Print not verified:** the system print dialog, real printers, copies (only passed through to Electron), and the exact margins a real printer applies with "Fit to paper" (`printableArea`).
- **Still not verified:** the real native dialog windows themselves (open, save, folder pick). The hook replaces them, so what is untested is Electron's dialog calls, not our page logic.
- The Save As dialog, the close-with-unsaved-changes prompts and window close with unsaved changes are also still untested by hand.

## Known issues and limits
- Saving password-protected PDFs is refused, and so are page edits on them (message shown).
- Applying a page edit first writes pending annotation edits into the file. Undoing the page edit brings them back as ordinary saved annotations, so the earlier annotation undo history is lost.
- Deleting a page can leave a bookmark pointing at nothing.
- Underline and strikeout on pages whose text runs sideways are drawn horizontally.
- Thumbnails that have not rendered yet show a 300x150 placeholder.
- One blank-canvas screenshot during an early edit session did not reproduce in three reruns. Watch for it.
- No automated test runner yet (only the scripts in CLAUDE.md). Adding Vitest for `textLogic.ts`, `annotWrite.ts` and `pageOps.ts` is a cheap win.
- Git: no remote yet.

## Suggested next steps
1. Test printing once by hand on a real printer (system dialog, copies, fit margins). Then single and two-page modes.
2. Add Vitest and move the CDP checks into a repeatable e2e script.
3. Remaining Phase 3: watermarks, headers and footers, page numbers, then metadata.

## Decisions already made
Electron + React + PDFium; MIT licence; do not write our own engine; no reverse engineering of proprietary software; KillerPDF (GPLv3) and Stirling-PDF are references only.
