#!/usr/bin/env bash
# One-step setup for Mac / Linux:  ./setup.sh
set -e
cd "$(dirname "$0")"
echo "== AI Content Studio setup =="
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install the LTS version from https://nodejs.org (1 minute), then run ./setup.sh again."
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then echo "Node $NODE_MAJOR is too old – install Node 18+ from https://nodejs.org"; exit 1; fi
echo "Installing (FFmpeg is bundled – nothing else to install)..."
npm install --no-audit --no-fund --omit=dev
[ -f .env ] || cp .env.example .env
chmod +x start.sh start.command 2>/dev/null || true
node scripts/doctor.js || true
echo; echo "Starting Studio – your browser will open. Add your key on the first screen."
exec node scripts/start.js
