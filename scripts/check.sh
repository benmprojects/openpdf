#!/usr/bin/env bash
# Everything that must pass before a commit: typecheck, unit tests (fuzz included), lint errors, generated corpus
# and a short PDF fuzz, build, end-to-end tests.
# Usage: bash scripts/check.sh && git commit ...
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc --noEmit
npx vitest run --reporter=dot > /tmp/openpdf-unit.log 2>&1 || { tail -30 /tmp/openpdf-unit.log; exit 1; }
npx eslint . --quiet
bash scripts/corpus.sh > /tmp/openpdf-corpus.log 2>&1 || { tail -30 /tmp/openpdf-corpus.log; exit 1; }
npm run build > /tmp/openpdf-build.log 2>&1 || { tail -30 /tmp/openpdf-build.log; exit 1; }
npx playwright test --reporter=line > /tmp/openpdf-e2e.log 2>&1 || { grep -E "✘|Error:|Expected|Received|failed" /tmp/openpdf-e2e.log | head -30; exit 1; }
grep -E "passed" /tmp/openpdf-e2e.log | tail -1
echo "All checks passed."
