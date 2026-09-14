#!/usr/bin/env bash
# NearBuyGoods local launcher (macOS/Linux)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required: https://nodejs.org"; exit 1
fi
echo "Starting NearBuyGoods on http://localhost:3000 ..."
exec node server.js
