# Handoff

Everything below is committed (see `git log`). Phase 3 was built in a second session; the first session did Phases 0 to 2.

## Done
- Phase 0: Electron + Vite + React app, PDFium WASM worker, open via dialog, drag and drop, command line.
- Phase 1 (most): tabs, continuous scroll with lazy render, fit-width/fit-page/preset zoom, thumbnails, bookmarks, find (case, whole word, highlight all), text selection and copy, password-protected files, hand tool.
- Phase 2 (most): highlight, underline, strikeout, sticky notes, text boxes, line, arrow, rectangle, ellipse, pencil, text stamps. Undo/redo, colour, width, move, resize, endpoint reshape, delete. Save and Save as write real PDF annotations. Existing highlight, underline, strikeout, note, text box, line/arrow (Subj Line/Arrow), unfilled rectangle/ellipse, ink and our own stamps can be edited and deleted.
- Phase 3 (first part): in the thumbnail pane, select pages (click, Ctrl, Shift, Ctrl+A), right-click menu (rotate, delete, extract, insert from file, split), Delete key, drag to reorder, a Merge button in the toolbar. Each operation applies and reloads at once; Ctrl+Z / Ctrl+Y undo and redo; the tab is marked unsaved and Save writes it. Code: `pageOps.ts`, `Sidebar.tsx`, `DocView.tsx`.

## Not done (see ROADMAP.md)
- Phase 1: print, rotate view, single and two-page modes, marquee zoom, snapshot tool, multi-file find, attachments, layers, page labels, rulers, measurement, read-aloud.
- Phase 2: squiggly, callout, typewriter, comment list and replies, properties panel, tool presets, FDF/XFDF, custom image stamps, polygon/polyline/cloud, eraser, fill colour, dashes, editing foreign annotation types.
- Phase 3: copy and replace pages, split by bookmark or size, crop, resize, headers and footers, Bates numbering, page numbers, watermarks, backgrounds, bookmark and page label editing, link editing, optimise and compress, metadata.
- Phases 4 to 9: content editing, forms, security/signatures/redaction, OCR/conversion, automation, polish.

## Verified and not verified
- Verified in the running app (CDP, on a copy of a test PDF): page selection, rotate with undo/redo, delete with undo and the Delete key, drag reorder with undo, the Extract and Split dialogs opening with the right prefilled values, no console errors, and the right-click menu staying inside the 798 px window (last thumb near the bottom, first thumb at the top-left, a click near the right edge; all eight items reachable; edges are within half a pixel of the window edge).
- Verified by script: `npx tsx scripts/pageops-check.mts` passes 10 of 10 (the pdf-lib operations and the page-range parser).
- **Not verified (needs a hand test):** the native file dialogs used by insert and merge, the save step inside extract, and split (including writing the files into a chosen folder). The CDP harness cannot drive native dialogs.
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
1. Hand-test the native-dialog operations (insert, merge, extract-save, split), then tick the matching ROADMAP items.
2. Finish Phase 1 gaps that users notice first: print and rotate view.
3. Add Vitest and move the CDP checks into a repeatable e2e script.
4. Remaining Phase 3: watermarks, headers and footers, page numbers, then metadata.

## Decisions already made
Electron + React + PDFium; MIT licence; do not write our own engine; no reverse engineering of proprietary software; KillerPDF (GPLv3) and Stirling-PDF are references only.
