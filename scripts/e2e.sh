#!/usr/bin/env bash
# E2E แบบครบวงจร: เปิด stack → build แอปด้วย .env.e2e → start → Playwright → หยุดแอป
set -euo pipefail
cd "$(dirname "$0")/.."
DATA="$(pwd)/tests/e2e/.data"
[ "${SKIP_STACK:-}" = "1" ] || bash scripts/e2e-stack.sh
set -a; . ./.env.e2e; set +a
[ -f "$DATA/next.pid" ] && kill "$(cat "$DATA/next.pid")" 2>/dev/null || true
NEXT_TELEMETRY_DISABLED=1 npx next build > "$DATA/build.log" 2>&1 || { tail -30 "$DATA/build.log"; exit 1; }
nohup npx next start -p 3000 > "$DATA/next.log" 2>&1 & echo $! > "$DATA/next.pid"
for i in $(seq 1 40); do curl -sf -o /dev/null http://localhost:3000/login && break; sleep 0.5; done
set +e
npx playwright test "$@"; rc=$?
kill "$(cat "$DATA/next.pid")" 2>/dev/null
exit $rc
