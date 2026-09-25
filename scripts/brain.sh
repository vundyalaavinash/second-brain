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
DB_FILE="$DATA_DIR/brain.db"
BACKUPS_DIR="$DATA_DIR/backups"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
URL="http://127.0.0.1:$PORT"
HELPER_LABEL="com.second-brain.activity"
HELPER_PLIST="$HOME/Library/LaunchAgents/$HELPER_LABEL.plist"
HELPER_SRC="$ROOT/helper/activity"
HELPER_BIN="$DATA_DIR/bin/sb-activity"
HELPER_LOG="$LOG_DIR/activity.log"
TOKEN_FILE="$DATA_DIR/activity-token"
RECORDER_SRC="$ROOT/helper/recorder"
RECORDER_BIN="$DATA_DIR/bin/sb-recorder"
WHISPER_DIR="$DATA_DIR/models/whisper"
WHISPER_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

say()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<USAGE
Usage: scripts/brain.sh <command>

  setup            install deps, build, download the embedding and whisper models, install the launch agent, the activity helper and the recorder, start
  update           after pulling changes: install deps, rebuild the app and both helpers, fetch any missing models, restart
  start            start the launch agent and open the browser
  stop             stop the launch agent and the activity helper
  restart [--build] [--helpers]
                   stop, rebuild the app (--build) and/or the Swift helpers (--helpers), start
  helpers          rebuild and reinstall the activity helper and the recorder, then bounce the helper
  status           show agent, server, tool and helper state
  logs             tail the server log
  open             open the app in the browser
  dev              run the dev server in the foreground (port $PORT)
  backup           take a backup right now and verify it
  verify           open every backup, print one line each, and fail if any is unsound
  restore [file]   with no file, list what is available and stop; with one, replace the
                   live database with it -- see docs/superpowers/runbook.md first

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

helper_loaded() { launchctl print "$DOMAIN/$HELPER_LABEL" >/dev/null 2>&1; }

ensure_token() {
  if [ ! -s "$TOKEN_FILE" ]; then
    mkdir -p "$DATA_DIR"
    (umask 077; head -c 32 /dev/urandom | xxd -p -c 64 > "$TOKEN_FILE")
    ok "activity token written"
  fi
}

build_helper() {
  if ! command -v swift >/dev/null; then
    say "swift not found; skipping the activity helper. Install the Xcode command line tools and rerun setup to enable it."
    return 1
  fi
  say "building the activity helper"
  if ! (cd "$HELPER_SRC" && swift build -c release 2>&1 | tail -3); then
    say "the activity helper did not build; skipping it"
    return 1
  fi
  mkdir -p "$(dirname "$HELPER_BIN")"
  cp "$HELPER_SRC/.build/release/sb-activity" "$HELPER_BIN" || return 1
  ok "helper built at $HELPER_BIN"
}

write_helper_plist() {
  cat > "$HELPER_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$HELPER_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$HELPER_BIN</string>
    <string>--server</string>
    <string>$URL</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SB_DATA_DIR</key><string>$DATA_DIR</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HELPER_LOG</string>
  <key>StandardErrorPath</key><string>$HELPER_LOG</string>
</dict>
</plist>
PLIST
  ok "helper launch agent written to $HELPER_PLIST"
}

build_recorder() {
  if ! command -v swift >/dev/null; then
    say "swift not found; skipping the meeting recorder. Install the Xcode command line tools and rerun setup to enable it."
    return 1
  fi
  say "building the meeting recorder"
  if ! (cd "$RECORDER_SRC" && swift build -c release 2>&1 | tail -3); then
    say "the meeting recorder did not build; skipping it"
    return 1
  fi
  mkdir -p "$(dirname "$RECORDER_BIN")"
  cp "$RECORDER_SRC/.build/release/sb-recorder" "$RECORDER_BIN" || return 1
  ok "recorder built at $RECORDER_BIN"
}

# Download a model unless it is already there. An existing model is never touched,
# and a download that fails leaves only its .part file behind, never a half model.
fetch_model() {
  local dest="$1" url="$2" label="$3"
  if [ -s "$dest" ]; then
    ok "$label already at $dest"
    return 0
  fi
  say "downloading the $label model ($url)"
  if curl -L --fail --progress-bar -o "$dest.part" "$url"; then
    mv "$dest.part" "$dest"
    ok "$label downloaded to $dest"
  else
    rm -f "$dest.part"
    say "could not download the $label model; meetings will not transcribe until it is there"
    return 1
  fi
}

download_whisper_models() {
  mkdir -p "$WHISPER_DIR"
  local base="$WHISPER_DIR/ggml-base.en.bin"
  local final="$WHISPER_DIR/ggml-medium.en.bin"
  local brew_final="$HOME/.whisper-cpp/models/ggml-medium.en.bin"
  fetch_model "$base" "$WHISPER_URL/ggml-base.en.bin" "whisper base.en" || true
  if [ -s "$final" ]; then
    ok "whisper medium.en already at $final"
  elif [ -s "$brew_final" ]; then
    # whisper-cpp from Homebrew already has it; link rather than fetch 1.5 GB
    # again. The link, not its target, is the one path everything else names.
    ln -sf "$brew_final" "$final"
    ok "linked the medium.en model already at $brew_final"
  else
    fetch_model "$final" "$WHISPER_URL/ggml-medium.en.bin" "whisper medium.en" || true
  fi
  write_model_settings "$base" "$final"
}

# The live and the final transcription models, as meetings.whisperBase and
# meetings.whisperFinal. Before the first run of the app there is no database to
# write to; the defaults in src/domain/meetings/tools.ts already name these paths.
write_model_settings() {
  (cd "$ROOT" && SB_DB="$DATA_DIR/brain.db" SB_BASE="$1" SB_FINAL="$2" node -e '
    const fs = require("fs");
    const file = process.env.SB_DB;
    if (!fs.existsSync(file)) { console.log("  settings skipped until the app has created its database (defaults match)"); process.exit(0); }
    const db = new (require("better-sqlite3"))(file);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get("table", "settings");
    if (!table) { console.log("  settings skipped until the app has created its database (defaults match)"); process.exit(0); }
    const set = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    set.run("meetings.whisperBase", process.env.SB_BASE);
    set.run("meetings.whisperFinal", process.env.SB_FINAL);
    console.log("  whisper models recorded in settings");
  ')
}

# The first run raises the macOS prompts; nothing can be recorded before they are answered.
probe_recorder() {
  if [ ! -x "$RECORDER_BIN" ]; then
    say "recorder not installed; skipping the permission check"
    return 0
  fi
  say "checking recording permissions - macOS asks for Microphone and, on 14.2+, System Audio Recording. Allow both."
  if "$RECORDER_BIN" --probe; then
    ok "recorder captured audio"
  else
    say "the recorder captured nothing. Grant the prompts, then run: $RECORDER_BIN --probe"
  fi
}

helper_start() {
  if [ ! -f "$HELPER_PLIST" ] || [ ! -x "$HELPER_BIN" ]; then
    say "activity helper not installed (run setup with swift available)"
    return 0
  fi
  if helper_loaded; then say "helper already loaded"; else launchctl bootstrap "$DOMAIN" "$HELPER_PLIST"; ok "helper loaded"; fi
}

helper_stop() {
  if helper_loaded; then launchctl bootout "$DOMAIN/$HELPER_LABEL" || true; ok "helper stopped"; fi
}

helper_status() {
  if helper_loaded; then ok "activity helper loaded"; else say "activity helper not loaded"; fi
  if [ -x "$HELPER_BIN" ]; then
    local out
    out="$(SB_DATA_DIR="$DATA_DIR" "$HELPER_BIN" --once 2>/dev/null || true)"
    if [ -n "$out" ]; then
      printf '%s' "$out" | node -e '
        let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          try { const p = JSON.parse(s).permissions;
            console.log(`  accessibility: ${p.accessibility ? "granted" : "missing"}  calendar: ${p.calendar ? "granted" : "missing"}`);
          } catch { console.log("  helper check failed"); }
        });'
    fi
  fi
  local status
  status="$(is_up && curl -sf --max-time 2 "$URL/api/activity/status" 2>/dev/null || true)"
  if [ -n "$status" ]; then
    printf '%s' "$status" | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        try { const n = JSON.parse(s).helper.calendarsSeen;
          console.log(`  calendars: ${typeof n === "number" ? n : "unknown"}`);
        } catch { console.log("  calendars: unknown"); }
      });'
  else
    printf '  calendars: unknown\n'
  fi
}

# Homebrew prefixes are searched explicitly: launchd agents do not inherit them.
tool_path() {
  local name="$1" dir
  if command -v "$name" >/dev/null 2>&1; then command -v "$name"; return 0; fi
  for dir in /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$dir/$name" ]; then echo "$dir/$name"; return 0; fi
  done
  return 1
}

tool_line() {
  if [ -n "${2:-}" ] && [ -x "${2:-}" ]; then ok "$1: ok"; else say "$1: missing"; fi
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
    <string>-H</string>
    <string>127.0.0.1</string>
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
  helper_stop
  ensure_token
  if build_helper; then write_helper_plist; fi
  build_recorder || true
  download_whisper_models
  probe_recorder
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
    helper_start
    if [ "$open_browser" = 1 ] && command -v open >/dev/null; then open "$URL"; fi
  else
    fail "server did not answer within 60 s. Check: scripts/brain.sh logs"
  fi
}

cmd_stop() {
  helper_stop
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

# Rebuilds both Swift helpers and puts the binaries where the launch agents expect them.
# The activity helper's agent is written again in case the paths in it changed.
build_helpers() {
  if build_helper; then write_helper_plist; fi
  build_recorder || true
}

cmd_restart() {
  local build=0 helpers=0 arg
  for arg in "$@"; do
    case "$arg" in
      --build)   build=1 ;;
      --helpers) helpers=1 ;;
      *) fail "unknown option: $arg (use --build and/or --helpers)" ;;
    esac
  done
  cmd_stop
  if [ "$build" = 1 ]; then
    require_node
    cd "$ROOT"
    say "rebuilding"
    npm run build
  fi
  if [ "$helpers" = 1 ]; then build_helpers; fi
  cmd_start --no-open
}

cmd_helpers() {
  helper_stop
  build_helpers
  helper_start
  probe_recorder
}

# Everything setup does for code that changed, without touching the app's launch agent.
cmd_update() {
  require_node
  cd "$ROOT"
  say "installing dependencies"
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  cmd_stop
  say "building"
  npm run build
  mkdir -p "$DATA_DIR/files" "$LOG_DIR"
  download_model
  ensure_token
  build_helpers
  download_whisper_models
  cmd_start --no-open
  ok "update complete"
}

cmd_open() {
  is_up || fail "server not answering at $URL. Run: scripts/brain.sh start"
  open "$URL"
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
  tool_line "recorder" "$RECORDER_BIN"
  tool_line "whisper" "$(tool_path whisper-cli || true)"
  tool_line "ffmpeg" "$(tool_path ffmpeg || true)"
  helper_status
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

cmd_backup() {
  require_node
  cd "$ROOT"
  say "taking a backup"
  SB_DATA_DIR="$DATA_DIR" npx tsx src/scripts/take-backup.ts
  ok "backup complete"
}

cmd_verify() {
  require_node
  cd "$ROOT"
  SB_DATA_DIR="$DATA_DIR" npx tsx src/scripts/verify-backups.ts
}

# Resolves $1 (a bare filename or an absolute path) against the backups directory and refuses
# anything that would land outside it -- an absolute path elsewhere, a `../` escape, or a symlink
# that points outside (realpath resolves it before the prefix check, so a link inside the
# directory cannot be used to read anything beyond it). Nothing has been touched by the time this
# returns; it only decides what "the file" in `restore <file>` actually names.
resolve_backup_file() {
  local name="$1" dir="$2" dir_real candidate resolved
  [ -d "$dir" ] || fail "no backups directory at $dir"
  dir_real="$(cd "$dir" && pwd -P)"
  case "$name" in
    /*) candidate="$name" ;;
    *)  candidate="$dir_real/$name" ;;
  esac
  resolved="$(realpath "$candidate" 2>/dev/null)" || fail "no such backup: $name"
  case "$resolved" in
    "$dir_real"/*) ;;
    *) fail "refusing: $name is outside the backups directory ($dir_real)" ;;
  esac
  [ -f "$resolved" ] || fail "no such backup: $resolved"
  printf '%s\n' "$resolved"
}

# Moves $1 (a database file) and any -wal/-shm beside it to $2, as a full set, unconditionally --
# never gated on whether the base file itself exists. A crash can leave sidecars with no base (the
# exact state that sends someone to `restore` in the first place); a version of this that only
# moved the sidecars when the base was also present left a foreign -wal sitting beside whatever
# was copied in next. Refuses outright if anything already sits at $2 or its sidecars, rather than
# silently overwriting a previous replaced database -- two restores landing in the same instant
# must not collide. Echoes 1 if anything was moved, 0 if there was nothing at $1 to move.
move_db_aside() {
  local src="$1" dest="$2" suffix moved=0
  for suffix in "" "-wal" "-shm"; do
    [ -e "$dest$suffix" ] && fail "refusing: $dest$suffix already exists; wait a moment and try again"
  done
  for suffix in "" "-wal" "-shm"; do
    if [ -f "$src$suffix" ]; then
      mv "$src$suffix" "$dest$suffix"
      moved=1
    fi
  done
  echo "$moved"
}

# Copies $1 (a database file) and any -wal/-shm beside it to $2, as a set, never the base alone --
# a base copied without its -wal can silently drop rows that are still only in the log (design
# §1's own trap, and exactly what `brain-replaced-*.db` looks like right after step 4 makes one:
# `verifyDatabaseFile` at step 2 already verifies it together with its -wal, so installing the
# base alone here would put back something different from what was just pronounced sound). Clears
# $2's own -wal/-shm first, so a stale sidecar left over from whatever previously occupied $2 can
# never survive beside a $1 that has none of its own.
copy_db_set() {
  local src="$1" dest="$2"
  rm -f "$dest-wal" "$dest-shm"
  cp "$src" "$dest"
  [ -f "$src-wal" ] && cp "$src-wal" "$dest-wal"
  [ -f "$src-shm" ] && cp "$src-shm" "$dest-shm"
  return 0
}

# Restores $2/attachments-$1 over $3/attachments when that dated backup exists -- moving any
# current attachments aside first, to $3/attachments-replaced-$4, never deleting them (the rule
# for this whole procedure is move, never delete, and it applies here exactly as it applies to the
# database). The replaced directory goes in the *data* directory, beside the live one, never in
# the backups directory: the nightly job's own attachments prune (`ATTACHMENTS_NAME_RE` in
# `jobs/handlers/backup.ts`) owns every `attachments-*` name in the backups directory, and a
# `attachments-replaced-<stamp>` sitting there sorted ahead of every real dated backup and got the
# genuine ones deleted around it instead (N2) -- putting it somewhere that prune never looks is the
# fix, not a smarter name. Does nothing at all, silently, when $1 is empty or there is no matching
# dated backup -- the caller reports that. Echoes the path attachments were moved to, or nothing if
# there were none to move -- this echoed value, not a later filesystem check, is what the caller
# must treat as the record of whether anything happened.
restore_attachments_for_date() {
  local date_part="$1" backups_dir="$2" data_dir="$3" stamp="$4" src dest_replaced
  [ -z "$date_part" ] && return 0
  src="$backups_dir/attachments-$date_part"
  [ -d "$src" ] || return 0
  if [ -d "$data_dir/attachments" ]; then
    dest_replaced="$data_dir/attachments-replaced-$stamp"
    [ -e "$dest_replaced" ] && fail "refusing: $dest_replaced already exists; wait a moment and try again"
    mv "$data_dir/attachments" "$dest_replaced"
    echo "$dest_replaced"
  fi
  cp -R "$src" "$data_dir/attachments"
}

# Puts $2 (and any of its sidecars) back at $1 -- but only when $3 is exactly "1", the *recorded*
# result `move_db_aside` echoed when it actually moved something there. Never asks the filesystem
# "does something exist at $2" to decide whether to act: a file happening to sit at $2 -- most
# concretely, the very collision that made `move_db_aside` refuse and return without moving
# anything at all -- is not evidence that this run put it there, and pulling it over a live
# database that was never touched is exactly the bug this function exists to make impossible (N1).
# Prints nothing and echoes "ok" as a pure no-op when $3 is not "1". When it is, echoes "ok" if the
# move-back completed, or "failed" if it could not (rare: a second failure during recovery itself)
# -- the caller reports either outcome; this function never does.
rollback_db_if_moved() {
  local db_file="$1" replaced_path="$2" moved="$3"
  if [ "$moved" != 1 ]; then
    echo ok
    return 0
  fi
  rm -f "$db_file" "$db_file-wal" "$db_file-shm"
  if ! mv "$replaced_path" "$db_file"; then
    echo failed
    return 0
  fi
  if [ -f "$replaced_path-wal" ] && ! mv "$replaced_path-wal" "$db_file-wal"; then
    echo failed
    return 0
  fi
  if [ -f "$replaced_path-shm" ] && ! mv "$replaced_path-shm" "$db_file-shm"; then
    echo failed
    return 0
  fi
  echo ok
}

# The same recorded-state discipline as `rollback_db_if_moved`, for attachments: acts only when $3
# is exactly the path `restore_attachments_for_date` echoed (non-empty), never on whether a
# directory happens to exist at $2.
rollback_attachments_if_moved() {
  local data_dir="$1" replaced_path="$2"
  if [ -z "$replaced_path" ]; then
    echo ok
    return 0
  fi
  rm -rf "$data_dir/attachments"
  if mv "$replaced_path" "$data_dir/attachments"; then
    echo ok
  else
    echo failed
  fi
}

# restore                 lists what is available, sound or not, and stops -- it never guesses.
# restore <file>          the full procedure, each step announced as it happens. Steps 1-3 are
#                          reversible (nothing on disk has changed yet); a typed "restore"
#                          confirmation is required before step 4, which is not -- and from that
#                          point on, any failure rolls back to the original database (and
#                          attachments, if they were touched) and restarts the server, rather than
#                          leaving the app down with half a restore on disk. The rollback acts only
#                          on what this run *recorded* having moved (`db_moved`,
#                          `attachments_moved`), never on what merely happens to exist on disk.
cmd_restore() {
  require_node
  cd "$ROOT"
  local arg="${1:-}"

  if [ -z "$arg" ]; then
    say "available backups:"
    SB_DATA_DIR="$DATA_DIR" npx tsx src/scripts/verify-backups.ts || true
    say "restore <file> to restore one of these"
    return 0
  fi

  # Must come before anything is stopped: `read` at EOF (a non-interactive invocation, a closed
  # stdin over ssh) returns non-zero under `set -e` and would otherwise abort mid-procedure with
  # the server already down and nothing printed.
  [ -t 0 ] || fail "restore needs an interactive terminal to type the confirmation; refusing to run unattended"

  say "1/8 resolving $arg"
  local target
  target="$(resolve_backup_file "$arg" "$BACKUPS_DIR")"
  ok "resolved to $target"

  say "2/8 verifying it -- nothing is touched until this passes"
  SB_DATA_DIR="$DATA_DIR" npx tsx src/scripts/verify-backups.ts "$(basename "$target")" \
    || fail "backup failed verification; refusing to restore. Nothing has changed."
  ok "backup verified sound"

  # One restore at a time: a stale lock (a previous run that crashed instead of cleaning up after
  # itself) has to be removed by hand, deliberately -- this never removes one on its own. See
  # docs/superpowers/runbook.md for what to do about a stale one; a stale lock only ever blocks a
  # *new* restore from starting, never the rollback of one already in flight (the trap below
  # releases it unconditionally, on every exit, success or failure).
  local lock_dir="$DATA_DIR/.restore.lock"
  mkdir "$lock_dir" 2>/dev/null || fail "another restore appears to be in progress ($lock_dir exists) -- see docs/superpowers/runbook.md; remove it with: rmdir \"$lock_dir\", once you are sure that is not true"

  # Recorded state, not inferred: every flag below starts at 0/empty and is set to its true value
  # by the one line that performs the action it names, immediately after that action reports
  # success -- never re-derived later by asking the filesystem "does X exist". `server_stopped` is
  # what tells the rollback whether the server needs restarting at all, independently of *why*
  # this function is exiting: a non-"restore" answer, Ctrl-C at the prompt, and a failure ten lines
  # later all reach the same trap, and all three must restart the server the same way (N4) -- there
  # is exactly one place that decides "was the server stopped by this run", and it is this flag.
  local server_stopped=0 db_moved=0 db_replaced_path="" attachments_moved=0 attachments_replaced_path=""
  restore_failed() {
    local ec=$?
    set +e
    rmdir "$lock_dir" 2>/dev/null

    local db_result="ok" attachments_result="ok"
    if [ "$db_moved" = 1 ]; then
      echo
      say "restore failed partway through; putting the original database back"
      db_result="$(rollback_db_if_moved "$DB_FILE" "$db_replaced_path" "$db_moved")"
      if [ "$db_result" = ok ]; then
        say "database restored to $DB_FILE"
      else
        printf '\033[31m✗\033[0m %s\n' "could not automatically finish restoring the database." >&2
        printf '\033[31m✗\033[0m %s\n' "check both of these by hand before doing anything else: $DB_FILE and $db_replaced_path" >&2
      fi
    fi

    if [ "$attachments_moved" = 1 ]; then
      say "putting the original attachments back"
      attachments_result="$(rollback_attachments_if_moved "$DATA_DIR" "$attachments_replaced_path")"
      if [ "$attachments_result" = ok ]; then
        say "attachments restored to $DATA_DIR/attachments"
      else
        printf '\033[31m✗\033[0m %s\n' "could not automatically finish restoring attachments." >&2
        printf '\033[31m✗\033[0m %s\n' "check both of these by hand: $DATA_DIR/attachments and $attachments_replaced_path" >&2
      fi
    fi

    # Everything the owner needs to know is printed above this line, before the one call in this
    # handler that can itself exit without returning: `cmd_start`'s own failure path is `fail`,
    # which is `exit`, and an `exit` inside a running EXIT trap ends the process immediately --
    # nothing after it in this function would run. So the diagnosis comes first and the restart
    # attempt comes last, on purpose, not printed together with it.
    if [ "$server_stopped" = 1 ]; then
      say "restarting the server"
      cmd_start --no-open
    fi

    # No early return on `ec -eq 0`: a Ctrl-C at the confirmation prompt has been observed to
    # leave `$?` at 0 even though nothing this function did completed normally, and by the time
    # this trap runs at all `trap - EXIT` has already disabled it on the one path where nothing
    # here needs to run (step 8's clean success) -- so reaching this line at all means something
    # was interrupted, whatever `$ec` says, and the flags below (not `$ec`) decide what to report.
    if [ "$db_moved" = 1 ] && [ "$db_result" != ok ]; then
      fail "restore failed and could not be fully rolled back automatically -- see above for exactly where things are"
    elif [ "$db_moved" = 1 ]; then
      fail "restore failed and was rolled back; the original database is back at $DB_FILE"
    else
      fail "restore did not proceed; nothing on disk has changed"
    fi
  }
  trap restore_failed EXIT

  say "3/8 stopping the server"
  cmd_stop
  is_up && fail "server is still answering; refusing to continue"
  server_stopped=1
  ok "server is down"

  echo
  echo "This will move the current database aside and replace it with:"
  echo "  $target"
  printf 'Type "restore" to continue, anything else (or Ctrl-C) to stop here: '
  local confirm=""
  read -r confirm || true
  [ "$confirm" = "restore" ] || fail "confirmation not given; restore cancelled"

  say "4/8 moving the current database aside"
  mkdir -p "$BACKUPS_DIR"
  local stamp moved_db
  stamp="$(node -e 'process.stdout.write(new Date().toISOString().replace(/[:.]/g, "-"))')"
  db_replaced_path="$BACKUPS_DIR/brain-replaced-$stamp.db"
  moved_db="$(move_db_aside "$DB_FILE" "$db_replaced_path")"
  # Reached only if the line above did not refuse (refusing exits the whole function via `set -e`
  # before this assignment, leaving db_moved at its safe initial 0) -- see rollback_db_if_moved.
  db_moved="$moved_db"
  if [ "$db_moved" = 1 ]; then
    ok "current database (and any sidecars) moved to $db_replaced_path"
  else
    say "no current database or sidecars at $DB_FILE; nothing to move aside"
  fi

  say "5/8 copying the backup into place"
  copy_db_set "$target" "$DB_FILE"
  ok "backup (and any sidecars) copied to $DB_FILE"

  say "6/8 restoring attachments for that date"
  local base date_part
  base="$(basename "$target")"
  date_part=""
  if [[ "$base" =~ ^brain-([0-9]{4}-[0-9]{2}-[0-9]{2})\.db$ ]]; then
    date_part="${BASH_REMATCH[1]}"
  fi
  if [ -n "$date_part" ] && [ -d "$BACKUPS_DIR/attachments-$date_part" ]; then
    attachments_replaced_path="$(restore_attachments_for_date "$date_part" "$BACKUPS_DIR" "$DATA_DIR" "$stamp")"
    if [ -n "$attachments_replaced_path" ]; then
      attachments_moved=1
      ok "attachments restored from attachments-$date_part; the previous ones are at $attachments_replaced_path"
    else
      ok "attachments restored from attachments-$date_part (there were none before)"
    fi
  else
    say "no attachments backup for that date; current attachments left as they are, unchanged"
  fi

  say "7/8 starting the server"
  local log_offset=0
  [ -f "$LOG_FILE" ] && log_offset="$(wc -l < "$LOG_FILE" | tr -d ' ')"
  cmd_start --no-open
  local boot_line=""
  [ -f "$LOG_FILE" ] && boot_line="$(tail -n "+$((log_offset + 1))" "$LOG_FILE" | grep "database integrity check" | tail -1 || true)"
  if [ -n "$boot_line" ]; then
    say "boot check: $boot_line"
  else
    say "boot check: no result yet from this restart in $LOG_FILE"
  fi

  say "8/8 done"
  trap - EXIT
  rmdir "$lock_dir" 2>/dev/null || true
  if [ "$db_moved" = 1 ]; then
    ok "the replaced database is at: $db_replaced_path"
  else
    ok "restore complete (there was no previous database to keep)"
  fi
}

case "${1:-}" in
  setup)   cmd_setup ;;
  update)  cmd_update ;;
  helpers) cmd_helpers ;;
  open)    cmd_open ;;
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) shift; cmd_restart "$@" ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  dev)     cmd_dev ;;
  backup)  cmd_backup ;;
  verify)  cmd_verify ;;
  restore) shift; cmd_restore "$@" ;;
  -h|--help|help|"") usage ;;
  *) usage; fail "unknown command: $1" ;;
esac
