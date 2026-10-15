# OpenPDF: working notes for Claude

Open-source (MIT) PDF workbench for Windows, aiming at feature parity with PDF-XChange Editor. Read `HANDOFF.md` first for current state and next steps, and `ROADMAP.md` for scope.

## Rules
- **Clean room.** Match features, never copy code or assets from proprietary software, and do not reverse engineer or decompile PDF-XChange or any other proprietary engine. Public sources only: ISO 32000, PDFium, pdf.js, and black-box behaviour tests.
- **Licences.** Project is MIT. Do not copy code from GPL/AGPL projects (e.g. KillerPDF is GPLv3, MuPDF is AGPL). Check a dependency's licence before adding it.
- **Do not build our own PDF engine.** PDFium (WASM via `@hyzyla/pdfium`) renders and reads; pdf-lib writes.
- Australian English in user-facing text and docs.

## Stack and layout
Electron + Vite + React + TypeScript. `npm run dev | build | typecheck`.
- `src/main`, `src/preload`: file dialogs, save (atomic write), unsaved-changes prompt.
- `src/renderer/src/pdf.worker.ts`: PDFium in a worker. `pdfClient.ts` is its main-thread client (render queue with priorities and abort, text cache).
- `pdfiumRaw.ts`: raw PDFium C calls the wrapper lacks (outline, char boxes, annotation read/hide). It reaches into private fields of `@hyzyla/pdfium`: `module`, `documentIdx` (the FPDF_DOCUMENT; `documentPtr` is the data buffer, not the document), `pageIdx`. Keep the package version pinned.
- `Viewer.tsx` (pages, selection, drawing gestures), `DocView.tsx` (per-tab state, toolbar, search, save), `Sidebar.tsx`, `App.tsx` (tabs).
- Annotations: `annotations.ts` (model), `AnnotLayer.tsx` + `ShapeLayer.tsx` (overlay), `annotWrite.ts` (pdf-lib writer, appearance streams authored in display space with one `cm`).
- Design rule: existing annotations stay drawn by PDFium until edited ("touched"); then PDFium is told to hide the original and the overlay takes over. Unchanged ones are never rewritten on save.

## Testing
- `npm test`: Vitest unit tests (`src/**/*.test.ts`, node environment) for textLogic, viewRotation, pageOps and annotWrite. Modules that need PDFium or the DOM are not covered here.
- `npm run e2e`: Playwright Electron specs in `e2e/` (smoke, shell, ribbon, look, tiles). Tests that leave a document unsaved need `OPENPDF_E2E_DISCARD=1`; always set `OPENPDF_E2E_USERDATA` to a temp folder. It does not build: run `npm run build` first. Needs `python` on PATH (generates the test PDF).
- `npm run lint`: ESLint (flat config). typescript-eslint does not support TypeScript 7 yet, so `eslint.config.mjs` shims `typescript` to `@typescript/typescript6`; some react-hooks rules are warnings only. Installing needs `npm i --legacy-peer-deps`.
- `npx tsx scripts/annot-check.mts in.pdf out.pdf prefix`: writes every annotation kind, renders through PDFium, re-imports, compares geometry.
- `npx tsx scripts/hide-check.mts file.pdf`: hiding an annotation leaves the page intact.
- `python scripts/make-test-pdf.py out.pdf`: test PDF with text and bookmarks.
- UI end-to-end: launch `npx electron . --remote-debugging-port=9333 file.pdf` and drive it with `scripts/cdp.mjs` (Chrome DevTools Protocol over WebSocket). The test window is only about 800 px tall: keep click coordinates inside it, and re-measure the page rectangle before each action because the toolbar can wrap and shift the layout.
- Work on a copy of any test PDF; Save overwrites the file.

## Gotchas
- Long heredocs in the Bash tool can fail to parse. Write patch scripts to a file with the Write tool and run them.
- Electron downloads its binary on first run (slow once).
- Saving password-protected PDFs is blocked on purpose (pdf-lib cannot write them).

## Delegation (keeps this context small)
Act as orchestrator. Do design and tricky logic yourself. Hand mechanical, well-specified work to subagents with the `model` parameter: Haiku for searches, reading logs, running a script and summarising output; Sonnet for scoped implementation and writing/running UI test scripts. Give each a brief with the goal, the files, and what "done" looks like, and ask for a short report. Check their results before relying on them. Start a fresh session with a handoff when context passes about 40%.
