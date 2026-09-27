#!/usr/bin/env bash
# Owns the stack lifecycle for the e2e suites: database, API, Vite, teardown.
#
# Uses ports 8099 and 5174 rather than 8080 and 5173 so this can run while a
# development server is up.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1
ROOT="$PWD"

export API_BASE='http://127.0.0.1:8099'
export WEB_BASE='http://127.0.0.1:5174'
API_PID=''
WEB_PID=''
LOG_DIR="${TMPDIR:-/tmp}/luma-e2e"
mkdir -p "$LOG_DIR"

# nvm's node shadows Homebrew's in a fresh shell and cannot run this project.
# Fail with the reason rather than a stack trace (agent-cache/knowledge.md).
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 25 ]; then
  echo "node >=25 required, found $(node -v 2>/dev/null || echo none)."
  echo 'Homebrew has it: export PATH="/opt/homebrew/opt/node/bin:$PATH"'
  exit 1
fi

# Signal by pid, never `pkill -f`: that also matches the launching shell, whose
# exit status then masquerades as the server's (agent-cache/knowledge.md). And
# bound the wait — an unresponsive child must not hang the suite.
stop_pid() {
  local pid="$1" name="$2" i
  [ -z "$pid" ] && return 0
  kill -INT "$pid" 2>/dev/null || return 0
  for ((i = 0; i < 40; i++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "  $name stopped"
      return 0
    fi
    sleep 0.25
  done
  echo "  $name ignored SIGINT after 10s; killing"
  kill -9 "$pid" 2>/dev/null
}

teardown() {
  echo
  echo '· teardown'
  stop_pid "$WEB_PID" 'vite'
  stop_pid "$API_PID" 'api'
}
trap teardown EXIT

echo '· database'
docker compose up -d --wait mysql >/dev/null || {
  echo '  mysql failed to start'
  exit 1
}
echo '  healthy'

echo '· api on 8099'
# exec so $! is node's pid rather than the subshell's — without it the signal in
# teardown lands on a shell that has already gone and the server survives.
(
  cd "$ROOT/backend" || exit 1
  exec env LUMA_PORT=8099 LUMA_LOG_FORMAT=json node --env-file-if-exists=.env src/main.ts
) >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "$API_BASE/healthz" && break
  sleep 0.5
done
if ! curl -s -o /dev/null "$API_BASE/healthz"; then
  echo '  api never came up:'
  tail -20 "$LOG_DIR/api.log"
  exit 1
fi
echo "  up (pid $API_PID)"

echo
bash "$ROOT/backend/tests/e2e/health.sh"
HEALTH_RC=$?

echo
echo '· vite on 5174'
(
  cd "$ROOT/web" || exit 1
  exec env LUMA_API_TARGET="$API_BASE" "$ROOT/node_modules/.bin/vite" --port 5174 --strictPort
) >"$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "$WEB_BASE/" && break
  sleep 0.5
done
if ! curl -s -o /dev/null "$WEB_BASE/"; then
  echo '  vite never came up:'
  tail -20 "$LOG_DIR/web.log"
  exit 1
fi
echo "  up (pid $WEB_PID)"

echo
bash "$ROOT/backend/tests/e2e/proxy.sh"
PROXY_RC=$?

echo
if [ "$HEALTH_RC" -eq 0 ] && [ "$PROXY_RC" -eq 0 ]; then
  echo 'e2e: all suites passed'
  exit 0
fi
echo "e2e: FAILED (health=$HEALTH_RC proxy=$PROXY_RC)"
exit 1
