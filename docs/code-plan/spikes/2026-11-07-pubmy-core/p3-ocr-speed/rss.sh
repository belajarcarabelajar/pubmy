#!/usr/bin/env bash
# Usage: rss.sh <prefix>; runs ocr.ts and samples VmHWM (peak RSS) since GNU time is not installed.
cd "$(dirname "$0")"
start=$(date +%s.%N)
bun ocr.ts "$1" & pid=$!
hwm=0
while kill -0 $pid 2>/dev/null; do
  v=$(awk '/VmHWM/{print $2}' /proc/$pid/status 2>/dev/null); [ -n "$v" ] && hwm=$v
  sleep 0.2
done
wait $pid; rc=$?
echo "exit=$rc wall=$(awk -v a="$start" -v b="$(date +%s.%N)" 'BEGIN{printf "%.2f", b-a}') s peakRSS(VmHWM)=${hwm} kB"
exit $rc
