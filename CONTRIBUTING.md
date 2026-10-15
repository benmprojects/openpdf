# Contributing to OpenPDF

OpenPDF is MIT licensed. Contributions are welcome under the same licence.

## Rules

- **Clean room.** Match features, never copy code or assets from proprietary PDF software, and do not reverse engineer or decompile it. Use public sources only: ISO 32000, the PDFium and pdf.js documentation, and black-box behaviour tests.
- **No GPL or AGPL code.** Do not copy code from GPL, AGPL or similar projects (for example MuPDF or KillerPDF).
- **Check dependency licences.** Before adding a package, run `npm view <package> license` and confirm it is permissive (MIT, BSD, Apache-2.0, ISC and similar). Then run `npm run licences`, which regenerates `THIRD_PARTY_NOTICES.md` and fails on copyleft or unknown licences.
- **No custom PDF engine.** PDFium (via `@hyzyla/pdfium`) renders and reads; pdf-lib writes.
- Use Australian English in user-facing text and documentation.

## Running things

Install with `npm install --legacy-peer-deps` (or `npm ci --legacy-peer-deps`).

```bash
npm run dev         # development with hot reload
npm run typecheck
npm run lint
npm test            # unit tests (Vitest)
npm run build && npm run e2e   # Electron end-to-end tests (Playwright); build first
npm run dist        # build the Windows installer into dist/
```

The Testing section in `CLAUDE.md` has the details, including the annotation round-trip scripts and how to drive the app over the DevTools protocol. Work on a copy of any test PDF, because Save overwrites the file.

## Commits

Use a short imperative subject, for example "Add rotate view and print". Keep each commit to one change.
