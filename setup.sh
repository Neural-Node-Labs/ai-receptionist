#!/usr/bin/env bash
# ============================================================
# AI Receptionist — Setup & Validation Script
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log_step() { echo -e "\n${CYAN}${BOLD}▶ $1${RESET}"; }
log_ok()   { echo -e "  ${GREEN}✓ $1${RESET}"; }
log_warn() { echo -e "  ${YELLOW}⚠ $1${RESET}"; }
log_err()  { echo -e "  ${RED}✗ $1${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 1. Check prerequisites ───────────────────────────────────────────────
log_step "Checking prerequisites"

for cmd in docker docker-compose; do
  if command -v "$cmd" &>/dev/null; then
    log_ok "$cmd found"
  elif [ "$cmd" = "docker-compose" ]; then
    if docker compose version &>/dev/null 2>&1; then
      log_ok "docker compose (plugin) found"
    else
      log_err "docker compose not found. Install Docker Desktop or docker-compose plugin."
      exit 1
    fi
  else
    log_err "$cmd not found"
    exit 1
  fi
done

# ── 2. Check .env ────────────────────────────────────────────────────────
log_step "Checking environment configuration"

if [ ! -f .env ]; then
  log_warn ".env not found — copying from .env.example"
  cp .env.example .env
  echo -e "\n  ${RED}${BOLD}ACTION REQUIRED:${RESET}"
  echo "  Edit .env and set at least one LLM API key:"
  echo "    DEEPSEEK_API_KEY=..."
  echo "    ANTHROPIC_API_KEY=..."
  echo "    OPENAI_API_KEY=..."
  echo ""
  echo "  Also set a strong API_SECRET_KEY."
  echo ""
  read -p "  Press Enter after editing .env to continue..." </dev/tty || true
fi

source .env

# Validate API keys
HAS_KEY=false
for var in DEEPSEEK_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY; do
  val="${!var:-}"
  if [ -n "$val" ] && [ "$val" != "your_deepseek_key_here" ] && [ "$val" != "your_anthropic_key_here" ] && [ "$val" != "your_openai_key_here" ]; then
    log_ok "$var is set"
    HAS_KEY=true
  fi
done

if [ "$HAS_KEY" = false ]; then
  log_err "No valid LLM API key found in .env. Set at least one of: DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY"
  exit 1
fi

if [ "${API_SECRET_KEY:-changeme_replace_in_production}" = "changeme_replace_in_production" ] || [ "${API_SECRET_KEY:-CHANGE_ME}" = "CHANGE_ME_TO_A_STRONG_SECRET_MIN_32_CHARS" ]; then
  log_warn "API_SECRET_KEY is using default value — INSECURE for production"
else
  log_ok "API_SECRET_KEY is set"
fi

# ── 3. Build images ──────────────────────────────────────────────────────
log_step "Building Docker images"

COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
fi

$COMPOSE_CMD build --no-cache 2>&1 | tail -5
log_ok "Images built successfully"

# ── 4. Start services ────────────────────────────────────────────────────
log_step "Starting services"

$COMPOSE_CMD up -d
log_ok "Services started"

# ── 5. Wait for health ───────────────────────────────────────────────────
log_step "Waiting for services to be healthy"

wait_healthy() {
  local name=$1 url=$2 retries=20 i=0
  while [ $i -lt $retries ]; do
    if curl -sf "$url" &>/dev/null; then
      log_ok "$name is healthy"
      return 0
    fi
    i=$((i+1))
    echo -n "."
    sleep 3
  done
  log_err "$name did not become healthy after ${retries} attempts"
  echo ""
  $COMPOSE_CMD logs "$name" | tail -20
  return 1
}

wait_healthy "backend" "http://localhost:3001/api/health"
wait_healthy "frontend" "http://localhost:3000"

# ── 6. Validate API endpoints ────────────────────────────────────────────
log_step "Validating API endpoints"

API_KEY="${API_SECRET_KEY:-changeme_replace_in_production}"

# Health check
HEALTH=$(curl -sf http://localhost:3001/api/health)
log_ok "Health endpoint: $(echo $HEALTH | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"status={d[\"status\"]}, knowledgeChunks={d.get(\"knowledgeChunks\",0)}")' 2>/dev/null || echo "$HEALTH")"

# Providers check
PROVIDERS=$(curl -sf "http://localhost:3001/api/providers" -H "x-api-key: $API_KEY")
log_ok "Providers endpoint: OK"

# Knowledge stats
KB=$(curl -sf "http://localhost:3001/api/knowledge" -H "x-api-key: $API_KEY")
log_ok "Knowledge endpoint: OK"

# ── 7. Summary ───────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║   AI Receptionist is running!            ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Frontend UI:${RESET}  http://localhost:3000"
echo -e "  ${BOLD}Backend API:${RESET}  http://localhost:3001"
echo -e "  ${BOLD}Health:${RESET}       http://localhost:3001/api/health"
echo ""
echo -e "  ${CYAN}Next steps:${RESET}"
echo "  1. Open http://localhost:3000 in your browser"
echo "  2. Click 'KB' to load company knowledge"
echo "  3. Start chatting!"
echo ""
