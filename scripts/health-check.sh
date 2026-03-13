#!/bin/bash
# Formly Health Check — checks staging + production
# Usage: ./scripts/health-check.sh [staging|prod|all]

ENV="${1:-all}"

check_service() {
  local name="$1"
  local url="$2"

  printf "%-25s " "$name:"
  
  local start=$(python3 -c "import time; print(int(time.time()*1000))")
  local response=$(curl -sS --max-time 15 -w "\n%{http_code}" "$url" 2>&1)
  local end=$(python3 -c "import time; print(int(time.time()*1000))")
  local elapsed=$(( end - start ))
  
  local http_code=$(echo "$response" | tail -1)
  local body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" = "200" ]; then
    local status=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null)
    if [ "$status" = "ok" ]; then
      echo "✅ UP (${elapsed}ms)"
    elif echo "$body" | grep -q '<!doctype html\|<!DOCTYPE html'; then
      echo "✅ UP (${elapsed}ms) [static]"
    else
      echo "⚠️  DEGRADED — status=$status (${elapsed}ms)"
    fi
  elif [ "$http_code" = "503" ]; then
    echo "❌ DOWN — service unavailable (${elapsed}ms)"
  else
    echo "❌ DOWN — HTTP $http_code (${elapsed}ms)"
  fi
}

check_deep() {
  local name="$1"
  local url="$2"

  echo ""
  echo "  Deep check: $name"
  local response=$(curl -sS --max-time 20 "$url" 2>&1)
  
  if [ $? -ne 0 ]; then
    echo "  ❌ Failed to reach $url"
    return
  fi

  echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for check in d.get('checks', []):
        icon = '✅' if check['status'] == 'ok' else '⚠️ ' if check['status'] == 'degraded' else '❌'
        line = f\"  {icon} {check['name']} ({check['responseMs']}ms)\"
        if check.get('details'):
            details = ', '.join(f'{k}={v}' for k,v in check['details'].items() if v is not None and v != [])
            if details:
                line += f' — {details}'
        if check.get('error'):
            line += f' — {check[\"error\"]}'
        print(line)
    print(f'  Overall: {d[\"status\"].upper()} ({d[\"totalMs\"]}ms, uptime {d.get(\"uptime\",0)}s)')
except Exception as e:
    print(f'  ⚠️  Parse error: {e}')
" 2>/dev/null
}

echo "=== Formly Health Check ==="
echo ""

if [ "$ENV" = "staging" ] || [ "$ENV" = "all" ]; then
  echo "── Staging ──"
  check_service "API" "https://formly-staging-api.onrender.com/health"
  check_service "Web" "https://formly-staging-web.onrender.com"
  check_deep "Staging API" "https://formly-staging-api.onrender.com/health/deep"
fi

if [ "$ENV" = "prod" ] || [ "$ENV" = "all" ]; then
  echo ""
  echo "── Production ──"
  check_service "API" "https://tax-agent-api-1glq.onrender.com/health"
  check_service "Web" "https://tax-agent-web-87iw.onrender.com"
  check_deep "Prod API" "https://tax-agent-api-1glq.onrender.com/health/deep"
fi

echo ""
