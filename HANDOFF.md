# Handoff

State at the end of the first long session. Everything below is committed (`git log`), the working tree was clean.

## Done
- Phase 0: Electron + Vite + React app, PDFium WASM worker, open via dialog, drag and drop, command line.
- Phase 1 (most): tabs, continuous scroll with lazy render, fit-width/fit-page/preset zoom, thumbnails, bookmarks, find (case, whole word, highlight all), text selection and copy, password-protected files, hand tool.
- Phase 2 (most): highlight, underline, strikeout, sticky notes, text boxes, line, arrow, rectangle, ellipse, pencil, text stamps. Undo/redo, colour, width, move, resize, endpoint reshape, delete. Save and Save as write real PDF annotations. Existing highlight, underline, strikeout, note, text box, line/arrow (Subj Line/Arrow), unfilled rectangle/ellipse, ink and our own stamps can be edited and deleted.

## Not done (see ROADMAP.md)
- Phase 1: print, rotate view, single and two-page modes, marquee zoom, snapshot tool, multi-file find, attachments, layers, page labels, rulers, measurement, read-aloud.
- Phase 2: squiggly, callout, typewriter, comment list and replies, properties panel, tool presets, FDF/XFDF, custom image stamps, polygon/polyline/cloud, eraser, fill colour, dashes, editing foreign annotation types.
- Phases 3 to 9: page organisation, content editing, forms, security/signatures/redaction, OCR/conversion, automation, polish.

## Known issues and limits
- Saving password-protected PDFs is refused (message shown).
- Underline and strikeout on pages whose text runs sideways are drawn horizontally.
- One blank-canvas screenshot during an early edit session did not reproduce in three reruns. Watch for it.
- Not hand-tested: the Save As dialog, the close-with-unsaved-changes prompts, window close with unsaved changes.
- No automated test runner yet (only the scripts in CLAUDE.md). Adding Vitest for `textLogic.ts` and `annotWrite.ts` is a cheap win.
- Git: no remote yet. LF/CRLF warnings suggest adding `.gitattributes` with `* text=auto eol=lf`.

## Suggested next steps
1. Phase 3 page organisation (rotate, delete, reorder, extract, insert, merge, split): pdf-lib does the structure, reload PDFium after each operation. Good first target is a thumbnail-pane context menu.
2. Finish Phase 1 gaps that users notice first: print and rotate view.
3. Add Vitest and move the CDP checks into a repeatable e2e script.

## Decisions already made
Electron + React + PDFium; MIT licence; do not write our own engine; no reverse engineering of proprietary software; KillerPDF (GPLv3) and Stirling-PDF are references only.
