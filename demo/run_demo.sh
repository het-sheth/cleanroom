#!/usr/bin/env bash
# One-command live demo: session text -> transcript -> live GLiNER scrub -> before/after.
# Usage: demo/run_demo.sh [session.txt]   (default: demo/session.txt)
set -euo pipefail
cd "$(dirname "$0")/.."

SESSION="${1:-demo/session.txt}"

set -a; . ./.env; set +a
if [ -z "${PIONEER_API_KEY:-}" ]; then
  echo "PIONEER_API_KEY not set — refusing to demo in silent mock mode." >&2
  exit 1
fi

rm -rf demo/out
demo/mk_transcript.sh "$SESSION" demo/live.jsonl
node sentinel/cli.js scrub demo/live.jsonl --out demo/out

echo
echo "=== BEFORE — raw values sitting in the session ==="
grep -nE 'ptk_live_9fQ2|523-04-1187|555-0142|marcus\.delgado' "$SESSION" | head -6 || echo "(model was careful — only partial values in this session)"

echo
echo "=== AFTER — redacted transcript ==="
python3 -c "import json;[print(json.loads(l)['redacted_text']) for l in open('demo/out/redacted.jsonl')]"

echo
echo ">>> dashboard: node dashboard/server.js --dir demo/out   → http://localhost:4600 (updates within 2s)"
echo
echo "=== SURVIVOR CHECK (silence = clean) ==="
python3 <<'EOF'
import json
red = ' '.join(json.loads(l)['redacted_text'] for l in open('demo/out/redacted.jsonl'))
for v in ['ptk_live_9fQ2mVx7Lb0RtYe4Kd1AsZ', '523-04-1187', '555-0142',
          'marcus.delgado@tidebreak.io']:
    if v in red:
        print('SURVIVED:', v)
EOF
