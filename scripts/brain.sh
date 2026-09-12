#!/usr/bin/env bash
# Second Brain lifecycle: setup, start, stop, restart, status, logs, dev.
# The app runs as a launchd user agent so it starts at login and stays up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.second-brain.app"
PORT="${SB_PORT:-3141}"
DATA_DIR="${SB_DATA_DIR:-$HOME/Library/Application Support/second-brain}"
LOG_DIR="$DATA_DIR/logs"
LOG_FILE="$LOG_DIR/app.log"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
URL="http://localhost:$PORT"

say()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<USAGE
Usage: scripts/brain.sh <command>

  setup            install deps, build, download the embedding model, install the launch agent, start
  start            start the launch agent and open the browser
  stop             stop the launch agent
  restart [--build] stop, optionally rebuild, start
  status           show agent and server state
  logs             tail the server log
  dev              run the dev server in the foreground (port $PORT)

Data directory: $DATA_DIR   (override with SB_DATA_DIR)
USAGE
}

require_node() {
  command -v node >/dev/null || fail "node not found. Install Node 22 or newer."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] || fail "Node 22 or newer required, found $(node -v)."
  command -v npm >/dev/null || fail "npm not found."
}

is_loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }
is_up()     { curl -sf -o /dev/null --max-time 2 "$URL/capture"; }

wait_for_server() {
  local i
  for i in $(seq 1 60); do
    if is_up; then return 0; fi
    sleep 1
  done
  return 1
}

write_plist() {
  local node_bin node_dir
  node_bin="$(command -v node)"
  node_dir="$(dirname "$node_bin")"
  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$ROOT/node_modules/next/dist/bin/next</string>
    <string>start</string>
    <string>-p</string>
    <string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$node_dir:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key><string>production</string>
    <key>SB_DATA_DIR</key><string>$DATA_DIR</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_FILE</string>
  <key>StandardErrorPath</key><string>$LOG_FILE</string>
</dict>
</plist>
PLIST
  ok "launch agent written to $PLIST"
}

download_model() {
  # Same model and dtype as src/providers/embed/transformers.ts; keep them in sync.
  say "downloading the embedding model into $DATA_DIR/models (first time only)"
  mkdir -p "$DATA_DIR/models"
  SB_MODELS="$DATA_DIR/models" node -e '
    const { pipeline, env } = require("@huggingface/transformers");
    env.cacheDir = process.env.SB_MODELS;
    pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8" })
      .then((p) => p(["warmup"], { pooling: "cls", normalize: true }))
      .then(() => console.log("model ready"))
      .catch((e) => { console.error("model download failed:", e.message); process.exit(1); });
  '
}

cmd_setup() {
  require_node
  cd "$ROOT"
  say "installing dependencies"
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  say "building"
  npm run build
  mkdir -p "$DATA_DIR/files" "$LOG_DIR"
  download_model
  if is_loaded; then
    say "stopping the running agent before reinstalling it"
    launchctl bootout "$DOMAIN/$LABEL" || true
    sleep 1
  fi
  write_plist
  cmd_start
  ok "setup complete. Data lives in $DATA_DIR"
}

cmd_start() {
  local open_browser=1
  [ "${1:-}" = "--no-open" ] && open_browser=0
  [ -f "$PLIST" ] || fail "launch agent not installed. Run: scripts/brain.sh setup"
  [ -d "$ROOT/.next" ] || fail "no build found. Run: scripts/brain.sh restart --build"
  if is_loaded; then
    say "agent already loaded"
  else
    launchctl bootstrap "$DOMAIN" "$PLIST"
    ok "agent loaded"
  fi
  say "waiting for $URL"
  if wait_for_server; then
    ok "server is up at $URL"
    if [ "$open_browser" = 1 ] && command -v open >/dev/null; then open "$URL"; fi
  else
    fail "server did not answer within 60 s. Check: scripts/brain.sh logs"
  fi
}

cmd_stop() {
  if is_loaded; then
    launchctl bootout "$DOMAIN/$LABEL"
    # bootout returns before the service is fully removed; wait so a following start can bootstrap.
    local i
    for i in $(seq 1 20); do
      if ! is_loaded; then break; fi
      sleep 0.5
    done
    is_loaded && fail "agent did not unload. Try: launchctl bootout $DOMAIN/$LABEL"
    ok "agent stopped"
  else
    say "agent is not loaded"
  fi
}

cmd_restart() {
  local build=0
  [ "${1:-}" = "--build" ] && build=1
  cmd_stop
  if [ "$build" = 1 ]; then
    require_node
    cd "$ROOT"
    say "rebuilding"
    npm run build
  fi
  cmd_start --no-open
}

cmd_status() {
  if is_loaded; then
    local pid
    pid="$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null | awk '/pid = /{print $3; exit}')"
    ok "agent loaded${pid:+ (pid $pid)}"
  else
    say "agent not loaded"
  fi
  if is_up; then ok "server answering at $URL"; else say "server not answering at $URL"; fi
  say "data: $DATA_DIR"
  say "log:  $LOG_FILE"
}

cmd_logs() {
  [ -f "$LOG_FILE" ] || fail "no log yet at $LOG_FILE"
  tail -n 50 -f "$LOG_FILE"
}

cmd_dev() {
  require_node
  cd "$ROOT"
  exec npm run dev
}

case "${1:-}" in
  setup)   cmd_setup ;;
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart "${2:-}" ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  dev)     cmd_dev ;;
  -h|--help|help|"") usage ;;
  *) usage; fail "unknown command: $1" ;;
esac
