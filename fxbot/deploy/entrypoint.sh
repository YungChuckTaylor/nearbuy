#!/bin/sh
# Runs the paper loop by default; set FXBOT_MODE=live to trade for real.
set -e

MODE="${FXBOT_MODE:-paper}"

echo "fxbot starting mode=$mode symbols=${FXBOT_SYMBOLS:-default} granularity=${FXBOT_GRANULARITY:-900}"

if [ "$MODE" = "live" ]; then
  exec python -m fxbot.cli live --yes
else
  exec python -m fxbot.cli paper
fi
