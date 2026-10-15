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
- Phases 0 to 2 (most), Phase 3 first part, plus print and rotate view, all done earlier.
- Phase 0 is now complete except dockable panes and a real installer/CI run (see ROADMAP).
- New this session:
  - Print and rotate view (`print.ts`, `viewRotation.ts`).
  - Vitest, Playwright, ESLint and the e2e specs in `e2e/`.
  - Settings, recent files, crash recovery, themes, single instance (`src/main/settings.ts`).
  - Ribbon UI with Lucide icons (`Ribbon.tsx`), the redesign, tiled rendering at high zoom, and packaging/CI/notices (`electron-builder.yml`, `.github/workflows/ci.yml`, `scripts/licences.mjs`).

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
- `print.ts`: pending annotations are written into a copy, then PDFium renders one page at a time at 300 dpi (capped at 40 Mpx). The PNGs are spooled to a temp folder, and a hidden window prints them.
- `viewRotation.ts`: view rotation keeps the page stack (canvas, overlay, highlights) in the unrotated page frame under one CSS transform. Every screen-to-page conversion goes through `toPage` / `deltaToPage` / `toDisplay`.
- Tiling (`Viewer.tsx` PageView, `pdfiumRaw.renderRegion`): above 16 Mpx a page draws a ~3 Mpx base plus a full-resolution tile of the part in view, re-rendered on scroll.
- Ribbon Organise tab acts on the thumbnails selected in the side pane (`Sidebar` reports them through `onSelectionChange`), or on the current page.

## Tests
- `npm test` (54 unit tests), `npm run e2e` (6 specs; run `npm run build` first), `npm run lint` (0 errors, 27 warnings), `npx tsc --noEmit`.
- An e2e test that leaves a document unsaved must set `OPENPDF_E2E_DISCARD=1`, or `app.close()` hangs on the native prompt.
- If an Electron test window is left open after a failed run, kill only processes whose command line contains `openpdf-e2e` or the scratchpad path.

## Hand-test checklist (needs a person)
- Printing to a real printer: the system dialog, copies, the margins with "Fit to paper".
- Native Open, Save As and folder dialogs; the close-with-unsaved prompt; Save As cancel.
- Installer: `npm run dist` from a normal terminal (here Windows refused to run the unsigned NSIS stub, EPERM). Then install, check the .pdf association, and check that opening a PDF from Explorer while the app runs adds a tab.
- Window buttons in the title-bar overlay in both themes. They are drawn by Windows, so Playwright screenshots do not show them.

## Known issues and limits
- Saving password-protected PDFs is refused, and so are page edits on them.
- Applying a page edit writes pending annotation edits into the file first. Undoing the page edit brings them back as ordinary saved annotations.
- Deleting a page can leave a bookmark pointing at nothing.
- Underline and strikeout on sideways text are drawn horizontally.
- Thumbnails that have not rendered yet show a placeholder.
- Printed output is raster: text is not selectable in a print-to-PDF.
- Lint: some react-hooks rules are relaxed to warnings (see CLAUDE.md).

## Next steps (strict phase order)
1. (Done: side pane docks left or right.)
2. Phase 1, in ROADMAP order:
   - Marquee zoom; single and two-page modes.
   - Attachments, layers (optional content), page labels.
   - Find in multiple files.
   - Snapshot tool.
   - Booklet and N-up printing; presentation/full-screen mode.
   - Read-aloud (Web Speech API), reading mode, accessibility (screen reader, high contrast).
   - Rulers, grid, guides, measurement (distance, perimeter, area).
   - PDFium exposes attachments (FPDFDoc_GetAttachment*), page labels (FPDF_GetPageLabel) and optional content via raw calls in `pdfiumRaw.ts`. Check the exports exist in the wasm first.
3. Then Phase 2 gaps, Phase 3 remainder, and on through Phase 9.

## Decisions already made
Electron + React + PDFium; MIT licence; do not write our own engine; no reverse engineering of proprietary software; KillerPDF (GPLv3) and Stirling-PDF are references only; Lucide icons (ISC).
