#!/usr/bin/env bash
# /healthz reflects the database's real state, and leaks nothing while doing it.
# Expects the API to be running; run.sh owns the lifecycle.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1
# shellcheck source=./lib.sh
source "backend/tests/e2e/lib.sh"

API="${API_BASE:-http://127.0.0.1:8099}"

echo "health.sh — ${API}"

echo '· database up'
request "$API/healthz"
expect_status 200 'healthy database answers 200'
expect_body '{"status":"ok","checks":{"database":"ok"}}' 'healthy body is exactly the ok envelope'
expect_header_contains 'application/json' 'healthy response is json'
# Absence, so it cannot use expect_header_contains.
if grep -qi 'X-Powered-By' "$HEADERS_FILE"; then
  bad 'x-powered-by should be disabled'
else
  ok 'x-powered-by is absent'
fi

echo '· database down'
docker compose stop mysql >/dev/null 2>&1 || {
  echo '  cannot stop mysql; aborting'
  exit 1
}
if wait_for_status "$API/healthz" 503 20; then
  ok 'stopping the database flips /healthz to 503'
else
  bad "stopping the database did not produce a 503 (got ${STATUS})"
fi
expect_body '{"status":"degraded","checks":{"database":"unavailable"}}' \
  'degraded body is exactly the degraded envelope'
for secret in 'password' '3307' 'ECONNREFUSED' 'mysql' 'loom:' 'at Timeout' 'prisma'; do
  expect_body_lacks "$secret" "degraded body does not leak '$secret'"
done

echo '· database back up'
docker compose up -d --wait mysql >/dev/null 2>&1 || {
  echo '  cannot start mysql; aborting'
  exit 1
}
if wait_for_status "$API/healthz" 200 40; then
  ok 'the server recovers without a restart'
else
  bad "the server did not recover (got ${STATUS})"
fi

echo '· unknown path'
request "$API/nope"
expect_status 404 'an unknown path answers 404'
expect_body '{"error":{"code":"not_found","message":"not found"}}' '404 uses the error envelope'
expect_body_lacks 'Error:' '404 body carries no stack'

report
