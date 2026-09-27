#!/usr/bin/env bash
# The Vite dev proxy makes the browser same-origin with the API. Phase 1's
# session cookie depends on this being true (docs/plan.md §2.3).
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1
# shellcheck source=./lib.sh
source "backend/tests/e2e/lib.sh"

API="${API_BASE:-http://127.0.0.1:8099}"
WEB="${WEB_BASE:-http://127.0.0.1:5174}"

echo "proxy.sh — ${WEB} → ${API}"

request "$WEB/"
expect_status 200 'vite serves the html shell'
expect_body_contains '<div id="root">' 'the shell carries the react mount point'

request "$WEB/healthz"
expect_status 200 '/healthz through the proxy answers 200'
expect_header_contains 'application/json' 'the proxied response is json, not html'
proxied="$(cat "$BODY_FILE")"

request "$API/healthz"
direct="$(cat "$BODY_FILE")"
if [ "$proxied" = "$direct" ]; then
  ok 'the proxied body is byte-identical to the direct one'
else
  bad "proxied '$proxied' differs from direct '$direct'"
fi

# No /api endpoint exists yet, so the API's own 404 arriving here is the proof
# that the /api rule proxies rather than falling through to Vite's index.html.
request "$WEB/api/does-not-exist"
expect_status 404 '/api is proxied to the api, not handled by vite'
expect_body '{"error":{"code":"not_found","message":"not found"}}' \
  '/api 404 comes from the api error envelope'

report
