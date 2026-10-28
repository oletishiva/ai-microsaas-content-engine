#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund --omit=dev
exec node scripts/start.js
