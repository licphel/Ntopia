#!/usr/bin/env bash
# ============================================================
# Ntopia 2.0 — one-click test-all
#   Installs deps, syntax-checks every .js file,
#   runs all test suites, reports results.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

cd "$PROJECT_DIR"

log()  { printf "${GREEN}[test]${NC} %s\n" "$*"; }

# ── 1. Dependencies ──────────────────────────────────────────
echo ""
echo "  ${BOLD}═══ Install ═══${NC}"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install --prefer-offline 2>&1 | tail -3
fi
log "Dependencies OK"

# ── 2. Syntax check ──────────────────────────────────────────
echo ""
echo "  ${BOLD}═══ Syntax ═══${NC}"
syntax_fail=0
while IFS= read -r -d '' f; do
  node -c "$f" 2>/dev/null || { echo "  ${RED}FAIL${NC} $f"; syntax_fail=$((syntax_fail + 1)); }
done < <(find src -name '*.js' -print0)
if [ "$syntax_fail" -eq 0 ]; then
  log "All source files pass syntax check"
else
  echo "  ${RED}$syntax_fail file(s) have syntax errors${NC}"
fi

# ── 3. Unit tests ────────────────────────────────────────────
echo ""
echo "  ${BOLD}═══ Tests ═══${NC}"
node --test test/*.test.js 2>&1 | tee /tmp/ntopia-test.tap | tail -8
echo ""

# ── 4. Summary ───────────────────────────────────────────────
passed=$(grep -c '^ok ' /tmp/ntopia-test.tap 2>/dev/null) || passed=0
failed=$(grep -c '^not ok ' /tmp/ntopia-test.tap 2>/dev/null) || failed=0
passed=${passed:-0}
failed=${failed:-0}
total=$((passed + failed))

echo "  ${BOLD}═══════════════════════════════════${NC}"
echo "  Total:  $total"
echo "  Passed: ${GREEN}$passed${NC}"
echo "  Failed: ${RED}$failed${NC}"

if [ "${failed}" -eq 0 ] && [ "${syntax_fail}" -eq 0 ]; then
  echo ""
  echo "  ${GREEN}╔══════════════════════════════╗${NC}"
  echo "  ${GREEN}║   ALL CHECKS PASSED          ║${NC}"
  echo "  ${GREEN}╚══════════════════════════════╝${NC}"
  exit 0
else
  echo ""
  echo "  ${RED}╔══════════════════════════════╗${NC}"
  echo "  ${RED}║   ${failed} TEST(S) FAILED         ║${NC}"
  echo "  ${RED}╚══════════════════════════════╝${NC}"
  exit 1
fi
