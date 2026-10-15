#!/usr/bin/env bash
# Fetches the PDF files from the pdf.js (Apache-2.0) and PDFium (BSD-3-Clause) test suites into a local folder,
# for scripts/corpus-check.mts and scripts/fuzz-pdf.mts. Only the test PDFs are checked out (sparse, shallow).
# Some of these files come from public bug reports: keep the folder local and never commit it to this repository.
# Usage: bash scripts/fetch-corpus.sh <folder>
set -euo pipefail
dest="${1:?Usage: bash scripts/fetch-corpus.sh <folder>}"
mkdir -p "$dest"
fetch() {
  local name="$1" url="$2" path="$3"
  if [ ! -d "$dest/$name/.git" ]; then
    git clone --depth 1 --filter=blob:none --sparse "$url" "$dest/$name"
  fi
  git -C "$dest/$name" sparse-checkout set "$path"
  echo "$name: $(find "$dest/$name/$path" -iname '*.pdf' | wc -l) PDFs in $dest/$name/$path"
}
fetch pdfjs https://github.com/mozilla/pdf.js.git test/pdfs
fetch pdfium https://pdfium.googlesource.com/pdfium testing/resources
echo "Run: npx tsx scripts/corpus-check.mts <folder with PDFs>  (point it at each folder above)"
