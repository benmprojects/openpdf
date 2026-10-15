#!/usr/bin/env bash
# Builds the generated corpus in a temp folder, checks every file strictly, then runs a short fuzz over it.
# Usage: bash scripts/corpus.sh [fuzz runs, default 150]
set -euo pipefail
cd "$(dirname "$0")/.."
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
python scripts/make-corpus.py "$dir/corpus" > /dev/null
npx tsx scripts/corpus-check.mts "$dir/corpus" --strict > "$dir/corpus.log" 2>&1 || { cat "$dir/corpus.log"; exit 1; }
tail -1 "$dir/corpus.log"
npx tsx scripts/fuzz-pdf.mts "$dir/corpus" --runs "${1:-150}" --seed "${FUZZ_SEED:-1}" --out "$dir/fuzz-failures" 2>/dev/null | tail -20
