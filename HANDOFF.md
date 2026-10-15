# Handoff

Everything below is committed (see `git log`). Read `CLAUDE.md` (rules, testing, gotchas) and `ROADMAP.md` (scope and ticks) too.

## How the user wants this built (decided 15/10/2026)
- Build the whole roadmap without stopping; ask questions only when genuinely blocked.
- **Strict phase order**: Phase 0 leftovers, then all of Phase 1, then Phase 2, and so on.
- Native or heavy dependencies are fine if the licence is permissive (MIT, BSD, Apache, ISC). Check with `npm view <pkg> license`; never GPL/AGPL/LGPL.
- Local commits on `main` only; the user pushes.
- Features that need a human (real printer, native dialogs, scanners, certificates): build them, verify everything a test hook can reach, and add them to the hand-test checklist below.
- The user asked for a professional look with icons, like a ribbon editor. Keep new UI consistent with the design system below.

## Current state
- Phases 0, 1, 2 and 3 complete (see ROADMAP). Phase 3: page organisation, copy/replace/split, Layout tab (headers, footers, numbers, Bates, watermarks, backgrounds, crop, resize), and bookmark, page label and link editing are done.
- Edit text (Phase 4, Edit tab):
  - Design: PDFium identifies the text object under the pointer (`pdfiumRaw.readTextObjects`: bounds, text, font name and flags, size, colour, matrix; the worker message is `textObjects`). The k-th PDFium text object is the k-th non-empty text-showing operator (Tj, TJ, ' or ") of the page's content stream: checked on 1,776 objects across five real PDFs with `scripts/textobj-check.mts` and `scripts/origin-check.mts` (counts only, no text printed).
  - `content.ts`: content stream tokenizer and operation parser with source ranges (inline images handled), `removeOps`, and `showOrigins` (where each show operator starts, from q/Q/cm/BT/Tm/Td/TD/T*/TL/'/").
  - `textEdit.replaceText`: refuses if the page's count of text objects differs from the stream's, or if the operator's start differs from PDFium's matrix origin by more than 1 pt. Removes the operator when later text will not move (the next show starts from a fresh position), else wraps it in `3 Tr ... n Tr` (invisible, original text stays in the file; the user is told). ' and " keep their line move (T*, and Tw/Tc). Replacement is drawn with pdf-lib `drawText` at the object's origin, size, colour and rotation, in the standard font from `pickStandardFont` (family from name and flags, bold and italic from name, weight, flags). Characters the font cannot show are refused.
  - UI: `TextEditLayer.tsx` outlines runs, click to edit (Enter commits, Esc cancels). The layer only appears once the viewer's client has loaded the current bytes (`textEditReady`), because object numbers change after every edit.
  - Font match: `shared/fontMatch.ts` reduces PDF font names and Windows font display names to a family key plus bold/italic; `main/fonts.ts` lists installed fonts from the registry (`reg query` on HKLM and HKCU Fonts, ttf/otf only) and reads the one file asked for (IPC `font:find`). `textEdit.embeddable` refuses fonts whose OS/2 fsType is restricted (0x2) or that lack a glyph; then a standard font is used. Embedded with @pdf-lib/fontkit (MIT), subset. Only exact weight and slant matches count.
  - Paragraph reflow: `textBlocks.groupBlocks` joins runs on one baseline into lines (gap at most 1.2 x size, same font, size and colour) and lines into paragraph blocks (spacing 0.9 to 2.2 x size and consistent, same left edge, first line may be indented). `plausibleParagraph` keeps tables out: every line but the last is several words and at least 60 % of the longest line, at most 60 lines; two lines only when the second continues the first (no sentence end, lower-case start). Upright text on an unrotated page only. `textEdit.replaceBlock` removes all the block's operators (a removed operator is only safe if what follows it is repositioned or is itself safely removed; else it is made invisible) and draws the new text wrapped by `wrapText` with the PDF font's metrics, at the first line's baseline and the measured leading; a single run is never wrapped. In the overlay Enter commits and Shift+Enter inserts a line break. Visual checks showed grids of one-character cells and tables being merged by an earlier version, hence the guards. `scripts/block-check.mts` prints block counts only.
  - Not done: text inside form XObjects (not listed by PDFium at page level), text with horizontal scaling or character spacing is redrawn without them.
- Edit images (Phase 4, Edit tab > Edit image): same design as Edit text. `pdfiumRaw.readImageObjects` lists PDFium's image objects (display rect, matrix) and the display-to-page matrix; `content.imageDraws` finds the stream's image draws (`Do` of an Image XObject, or an inline `BI`) with the CTM in force; `imageEdit.ts` refuses unless the counts match and the CTM equals PDFium's matrix (0.5 pt), then wraps the draw in `q <cm> ... Q` (move/resize: M = ctm x change x ctm^-1, so the new transform is ctm x change), swaps in a new embedded PNG/JPEG fitted inside the old box, or removes the draw. `ImageEditLayer.tsx` is the overlay; display-space edits become page-space with F^-1 x change x F. Checked on 221 images in five real PDFs with `scripts/image-check.mts` (counts only). Not done: rotate, crop, images inside forms, replacing with formats other than PNG/JPEG.
- Forms (Phase 5): `forms.ts` reads fields with pdf-lib (`readForm`: type, value, options, flags, DA size and colour, widgets with display-space rect, on-values, /MK colours and caption; a radio's on-value is its /Opt text when the state name is an index) and writes them (`applyFormValues`: setText/check/select, appearances regenerated per field, 12 pt for automatic multiline, an installed Unicode font for text Helvetica cannot show; `save({ updateFieldAppearances: false })` because they were made already). Pages are rendered with `forms: false` (worker `renderFormFields`, tile renderer skips FFLDraw) when the document has fields, and `FormLayer.tsx` draws controls over them. DocView keeps `formFields` (read from `bytes`), `formValues` (edits only; reset after save and page edits), `highlightFields`; `applyEdits` is async and writes annotations then form values. IMPORTANT: callbacks whose dependency lists carry `annotsDirty` must also carry `formValues` and `zDirty` (a stale closure once saved only the first edited field). Thumbnails, presentation mode and the snapshot tool still draw fields from the file's saved values. `scripts/make-form-pdf.mts` makes the all-field-types fixture (pdf-lib bakes the computed auto font size into DA, so the script sets sizes explicitly).
- Edit shape (Phase 4, Edit tab): vector paths in the page content. `content.pathDraws` finds painted paths (the run of m/l/c/v/y/re/h/W operators ending in S/s/f/F/f*/B/B*/b/b*; paths ending in `n` only clip and are skipped) with the CTM and a point bbox; `pdfiumRaw.readPathObjects` lists PDFium's path objects; `pathEdit.transformPath` checks counts and that the centres agree within 3 pt, refuses paths that also clip, and wraps the run in `q <cm> ... Q` or removes it. `scripts/path-check.mts` (counts only): 65,000 paths in six real PDFs, counts equal on every page, 99.98 % agree on position (the rest would be refused). `ObjectEditLayer.tsx` serves both Edit image (a box per image) and Edit shape (hit test under the pointer, smallest box first, 3 pt slop). Stroke width scales with a resize. Not done: editing path colours or line widths, dashes, shading objects, shapes inside form XObjects.
- Arrange annotations (Edit tab): Shift or Ctrl click adds to the selection (`selectedAnnot` is the primary, `extraSel` the rest; `selectAnnot(id, additive)`); dragging one of several moves all; Delete removes all. `arrange.ts` (pure, tested): `alignAnnots`, `distributeAnnots`, `restack`. Stacking order is the annotation list order; `zDirty` makes the save pass every annotation to `writeAnnotations(..., stacked = true)`, which rebuilds each page's /Annots (unmanaged entries such as popups and widgets first, ours after in order). Rectangle-type annotations are hit-tested on their outline only (existing behaviour).
- Add image (Edit tab): `imageEdit.addImage` places a PNG/JPEG as page content, 96 dpi capped at 240 pt and 60 % of the page, centred on the click, upright on rotated pages. `pendingImage` holds the picked file until the click.
- Spell check: `main/spellMenu.ts` builds the text-box context menu (suggestions, Add to dictionary, edit commands); `Settings.spellcheck` (default on); `applySpelling` in `main/settings.ts` picks en-AU, en-GB or en-US if available, and sets the enabled flag last (setting a language can switch it back on). Not checked by hand: the visible underlines and suggestions depend on the Windows dictionaries (hand-test list).
- Document properties (File tab > Properties): `metadata.ts` reads and writes the Info dictionary and rewrites a matching XMP packet (dc, pdf and xmp schemas; any other XMP properties are replaced), and can remove all metadata. `DocPropsDialog.tsx`. Files with no Info dictionary are handled. Not covered: custom Info keys and editing raw XMP.
- Optimise (Organise tab): `optimise.ts` re-encodes oversized 8-bit grey/RGB images as JPEG (pdf-lib plus canvas; PNG-predicted images are unfiltered first; masks, indexed, CMYK and TIFF-predicted images are left alone) and drops page thumbnails; then `src/main/qpdf.ts` runs qpdf (WASM, `@neslinesli93/qpdf-wasm`, ISC, pinned) over IPC `pdf:qpdf` for object streams, recompression, unused resources and linearising. `OptimiseDialog.tsx` has presets. Undoable like other page edits. Saving writes bytes as-is, so linearisation survives. Install with `npm i --legacy-peer-deps`.
- Bookmark, page label and link editing:
  - `outlineEdit.ts`: bookmark tree edits (insert, remove, update, move, indent, outdent) and `writeOutline` (a fresh /Outlines tree, every bookmark to the top of its page). `readLabelRanges` / `writeLabelRanges` / `labelFor` for /PageLabels.
  - Bookmarks pane (`Sidebar.tsx`) has an edit toolbar; F2 renames, Delete deletes. The pane shows the edited tree until the rewritten file reads back the same, and DocView queues outline writes (`editOutline`) because edits come faster than reloads.
  - Organise > Page labels opens `PageLabelsDialog.tsx`.
  - Links already in a file are imported as kind `link` when they go to a web address or a page here (resolved in `annotExtras.ts`, including named destinations). They are hidden unless the Link tool is on or one is selected. With the Link tool, links can be moved, resized, deleted, and retargeted by double-click. Saving keeps the original border and flags and replaces /A or /Dest.
- Phase 2 this session:
  - New annotation kinds: squiggly, caret/replace text, typewriter, callout, polygon/polyline/cloud, image and dated stamps, file attachment, sound, link.
  - Shape options: fill, dashes, opacity, fonts.
  - Eraser; measurements saved as measurement annotations.
  - Comment list with threads and review status, summary PDF and CSV export.
  - Properties panel (Ctrl+E), tool defaults and presets (Settings).
  - Other tools' annotations: arrows, dashes, callouts and measurements are editable via pdf-lib extras; anything else is "foreign" and can be moved, resized or deleted.
  - Links can be followed and added.
  - XFDF/FDF import and export; compare comments with another copy.
- Annotation pipeline in short:
  - Import: worker `readPageAnnots` (PDFium plus pdf-lib extras in `annotExtras.ts`), then `importMap.annotsFromImported`.
  - Edit: model in `annotations.ts`.
  - Save: `annotWrite.writeAnnotations(bytes, annots, deleted, rewrite)`. New replies are added without rewriting an unchanged parent.
  - Foreign annotations stay drawn by PDFium; moves are applied with `setAnnotRect` in memory.
- Fixtures:
  - `scripts/make-test-pdf.py`: 6 pages, "fox" 24 times.
  - `scripts/make-feature-pdf.mts`: attachments, labels, layers, 1:100 viewport.
  - `scripts/make-foreign-pdf.py`: PyMuPDF-made annotations.

## Design system (keep to it)
- Tokens at the top of `styles.css`: `--bg --panel --panel-2 --panel-3 --border --border-strong --text --muted --accent (OpenPDF red) --focus --pressed --sel --shadow-* --radius`. Light is the base; dark comes from `prefers-color-scheme`, which Electron's `nativeTheme.themeSource` drives from Settings. Never hard-code chrome colours.
- Ribbon: `RGroup` (labelled group), `RB` (button: `big` = icon above label, otherwise icon beside label), `RStack` (column of small buttons), `IconButton` (bars). Icons are from `lucide-react` (ISC). Each ribbon tab lives in `DocView.tsx` under `ribbon === '...'`.
- The tab strip is the window's title bar (`titleBarStyle: 'hidden'` with a `titleBarOverlay` tinted per theme). Buttons in it need `-webkit-app-region: no-drag` (already set for `.tabstrip button`, `.tab` and `.menu-anchor`).
- Logo: `Logo.tsx`, our own artwork.
- `e2e/look.spec.ts` screenshots the welcome screen and a document in both themes into `test-results/`. Look at them after UI changes. Playwright pins light mode, so the spec calls `emulateMedia({ colorScheme: null })`.

## Key code added this session
- `src/main/settings.ts`: settings.json (theme, recent, autosaveMinutes, author, sidebarWidth), recent list, recovery snapshots in userData/recovery.
- `src/main/index.ts`: IPC for print (`print:*`), settings, recent, recovery; single-instance lock; title bar overlay.
  - Test hooks:
    - `OPENPDF_E2E=1` turns them on and skips the single-instance lock.
    - `OPENPDF_E2E_OPEN`, `_SAVE` and `_DIR` answer the file dialogs.
    - `_PRINT=out.pdf` makes printing write that PDF instead of showing the dialog.
    - `_USERDATA` points settings and recovery at a scratch folder.
    - `_DISCARD=1` answers the close-with-unsaved prompt.
    - `_PICK=path` answers single-file pickers (attach, sound, import comments, compare).
    - `_SAVE_TEXT=path` answers CSV, XFDF and FDF saves.
    - `_IMAGES=a;b` adds image stamps.
    - `_LINKS=path` records opened web links instead of opening them.
    - `_CLIP=path` writes copied images (snapshots) to that file instead of the system clipboard, which other programs on the machine can hold.
    - `_SEARCH_DIR` answers the search-in-files folder picker.
    - `_SHOW=1` shows test windows (they open off-screen otherwise).
- `print.ts`: pending annotations are written into a copy, then PDFium renders one page at a time at 300 dpi (capped at 40 Mpx). The PNGs are spooled to a temp folder, and a hidden window prints them.
- `viewRotation.ts`: view rotation keeps the page stack (canvas, overlay, highlights) in the unrotated page frame under one CSS transform. Every screen-to-page conversion goes through `toPage` / `deltaToPage` / `toDisplay`.
- Tiling (`Viewer.tsx` PageView, `pdfiumRaw.renderRegion`): above 16 Mpx a page draws a ~3 Mpx base plus a full-resolution tile of the part in view, re-rendered on scroll.
- Ribbon Organise tab acts on the thumbnails selected in the side pane (`Sidebar` reports them through `onSelectionChange`), or on the current page.

## Tests
- `bash scripts/check.sh`: run before every commit (typecheck, unit, lint errors, build, all e2e).
- `npm test` (54 unit tests), `npm run e2e` (6 specs; run `npm run build` first), `npm run lint` (0 errors, 27 warnings), `npx tsc --noEmit`.
- An e2e test that leaves a document unsaved must set `OPENPDF_E2E_DISCARD=1`, or `app.close()` hangs on the native prompt.
- If an Electron test window is left open after a failed run, kill only processes whose command line contains `openpdf-e2e` or the scratchpad path.

## Hand-test checklist (needs a person)
- Spell check: type a misspelling in a comment or Edit text box, check it is underlined, right-click gives suggestions, Add to dictionary stops the underline.
- Printing to a real printer: the system dialog, copies, the margins with "Fit to paper".
- Native Open, Save As and folder dialogs; the close-with-unsaved prompt; Save As cancel.
- Installer: `npm run dist` from a normal terminal (here Windows refused to run the unsigned NSIS stub, EPERM). Then install, check the .pdf association, and check that opening a PDF from Explorer while the app runs adds a tab.
- Window buttons in the title-bar overlay in both themes. They are drawn by Windows, so Playwright screenshots do not show them.

## Known issues and limits
- Saving password-protected PDFs is refused, and so are page edits on them.
- Applying a page edit writes pending annotation edits into the file first. Undoing the page edit brings them back as ordinary saved annotations.
- Deleting a page can leave a bookmark pointing at nothing.
- Rewriting bookmarks sends each one to the top of its page (any zoom or position in the original destination is dropped) and closes every bookmark that has children.
- An edited link keeps working from PDFium's copy until the file is saved (following a link uses PDFium's list).
- Underline and strikeout on sideways text are drawn horizontally.
- Thumbnails that have not rendered yet show a placeholder.
- Printed output is raster: text is not selectable in a print-to-PDF.
- Lint: some react-hooks rules are relaxed to warnings (see CLAUDE.md).

## Next steps (strict phase order)
1. Phase 3 is done. Next: Phase 4 (content editing), then 5 forms, 6 security/signatures/redaction, 7 OCR and conversion, 8 automation, 9 polish and release. Check ROADMAP for each phase's items.
2. (Done this session) Phase 1, in ROADMAP order:
   - Marquee zoom; single and two-page modes.
   - Attachments, layers (optional content), page labels.
   - Find in multiple files.
   - Snapshot tool.
   - Booklet and N-up printing; presentation/full-screen mode.
   - Read-aloud (Web Speech API), reading mode, accessibility (screen reader, high contrast).
   - Rulers, grid, guides, measurement (distance, perimeter, area).
   - PDFium exposes attachments (FPDFDoc_GetAttachment*), page labels (FPDF_GetPageLabel) and optional content via raw calls in `pdfiumRaw.ts`. Check the exports exist in the wasm first.
3. Then on through Phase 9.

## Decisions already made
Electron + React + PDFium; MIT licence; do not write our own engine; no reverse engineering of proprietary software; KillerPDF (GPLv3) and Stirling-PDF are references only; Lucide icons (ISC).
