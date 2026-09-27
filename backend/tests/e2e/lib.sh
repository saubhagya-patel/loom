# shellcheck shell=bash
# Shared assertions for the e2e suites. Sourced, not executed.

PASS=0
FAIL=0
BODY_FILE="${TMPDIR:-/tmp}/loom-e2e-body.$$"
STATUS=''
HEADERS_FILE="${TMPDIR:-/tmp}/loom-e2e-headers.$$"

cleanup_body_files() { rm -f "$BODY_FILE" "$HEADERS_FILE"; }

ok() {
  PASS=$((PASS + 1))
  printf '  \033[32mPASS\033[0m %s\n' "$1"
}

bad() {
  FAIL=$((FAIL + 1))
  printf '  \033[31mFAIL\033[0m %s\n' "$1"
}

# Truncate both files before every request. A failed curl leaves the previous
# response in place, and a `contains` assertion then passes on stale data — that
# is exactly how a broken proxy test reported a spurious PASS in an earlier
# project. See agent-cache/knowledge.md.
request() {
  local url="$1"
  : >"$BODY_FILE"
  : >"$HEADERS_FILE"
  STATUS="$(curl -s -o "$BODY_FILE" -D "$HEADERS_FILE" -w '%{http_code}' --max-time 20 "$url")" ||
    STATUS='000'
}

expect_status() {
  local want="$1" what="$2"
  if [ "$STATUS" = "$want" ]; then
    ok "$what (status $want)"
  else
    bad "$what — wanted status $want, got ${STATUS:-none}"
  fi
}

expect_body() {
  local want="$1" what="$2"
  local got
  got="$(cat "$BODY_FILE")"
  if [ "$got" = "$want" ]; then
    ok "$what"
  else
    bad "$what — wanted '$want', got '$got'"
  fi
}

expect_body_contains() {
  local needle="$1" what="$2"
  if grep -qF -- "$needle" "$BODY_FILE"; then
    ok "$what"
  else
    bad "$what — '$needle' not in body"
  fi
}

# The important direction for a privacy-first project: assert what is *absent*.
expect_body_lacks() {
  local needle="$1" what="$2"
  if grep -qiF -- "$needle" "$BODY_FILE"; then
    bad "$what — LEAKED '$needle'"
  else
    ok "$what"
  fi
}

expect_header_contains() {
  local needle="$1" what="$2"
  if grep -qiF -- "$needle" "$HEADERS_FILE"; then
    ok "$what"
  else
    bad "$what — '$needle' not in headers"
  fi
}

# Poll until the endpoint answers with the wanted status, or give up.
wait_for_status() {
  local url="$1" want="$2" tries="${3:-40}"
  local i
  for ((i = 0; i < tries; i++)); do
    request "$url"
    [ "$STATUS" = "$want" ] && return 0
    sleep 0.5
  done
  return 1
}

report() {
  printf '\n  %d passed, %d failed\n' "$PASS" "$FAIL"
  cleanup_body_files
  [ "$FAIL" -eq 0 ]
}
