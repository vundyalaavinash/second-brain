# Second Brain (desktop)

A Tauri shell around the app in `..`, for people you share this with who should never see a
terminal. It is not a rewrite: the actual product is the same Next.js app, the same SQLite
database, the same `scripts/brain.sh` logic that already installs and downloads everything for
the CLI-managed install — this just owns the whole thing as one process instead.

## What it does

1. **Bundles a pre-built server**, not source. `npm run build` (with `output: "standalone"` in
   `next.config.ts`) produces `.next/standalone/`, a self-contained copy of the server plus only
   the `node_modules` it actually needs. That's what ships inside the app — a recipient's machine
   never runs `npm ci` or `npm run build`.
2. **On first launch**, extracts that bundle to
   `~/Library/Application Support/com.second-brain.desktop/current/` (code — deliberately not the
   data directory, the same separation `scripts/brain.sh set-data-dir` enforces for the
   CLI-managed install), then runs `scripts/brain.sh prepare` from there — Homebrew's `llama.cpp`,
   every model, the Swift helper and recorder. Progress streams into the window live; nothing
   silently sits on a blank screen.
3. **Owns the server directly.** Once prepared, it spawns `node server.js` as its own child
   process (not through launchd, not detached) and loads `http://127.0.0.1:3141` in the window.
   Quitting from the tray kills that process; there is no second, independent background service
   this app doesn't control.
4. **Lives in the menu bar.** Closing the window hides it rather than quitting — the server (and
   activity tracking / auto-recording, once running) keeps going, same always-on behaviour the
   CLI-managed launchd install already has, just owned by this one process tree instead of a
   separate one. The tray menu has **Open Second Brain** and **Quit**. It also registers itself as
   a login item, so it comes back after a restart the same way the launchd agent does.

## Known limits (today's build)

- **Node 22+ must already be on the recipient's Mac.** The bundle ships the *built* server, not a
  Node runtime — `node server.js` still needs a real `node` on `PATH`. Bundling Node itself is a
  reasonable next step, not done here.
- **Apple Silicon only.** `better-sqlite3`, `onnxruntime-node`, and the bundled `llama-cli`/model
  files are all arm64. An Intel build would need its own `npm run build` and its own Tauri
  bundle target.
- **Unsigned.** No Apple Developer account is wired into this build, so macOS Gatekeeper will
  warn on first open. Right-click → Open bypasses it on most Macs. If a Mac's "Allow apps from"
  setting is locked to the App Store, that doesn't work at all and there's no "Open Anyway" button
  to fall back on — the reliable fix on any Mac, regardless of that setting, is to strip the
  quarantine flag after installing:
  ```sh
  xattr -cr "/Applications/Second Brain.app"
  ```
  Real signing + notarization is a separate, later step that would remove the need for this.
- **Models download on first launch**, not bundled — the summary model alone is ~4.4 GB, and
  GitHub's own release-asset size limit (2 GB per file) rules out bundling everything anyway. A
  first run needs real time and a real internet connection.
- **Activity tracking / meeting recording need Xcode Command Line Tools** (for `swift build`),
  exactly like the CLI-managed install — `scripts/brain.sh prepare` already skips them gracefully
  and says so if CLT isn't present, rather than failing setup outright.

## Troubleshooting

If the app shows an error (during setup or once it's running), the full log — `prepare`'s output,
line by line, and the Next.js server's own stdout/stderr — is at:

```
~/Library/Logs/com.second-brain.desktop/Second Brain.log
```

## Building it

```sh
cd ..                                   # repo root
npm run build                           # produces .next/standalone/ (output: "standalone")
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
cp scripts/brain.sh .next/standalone/scripts/brain.sh
rm -rf .next/standalone/helper
mkdir -p .next/standalone/helper
rsync -a --exclude='.build' helper/ .next/standalone/helper/
rm -rf .next/standalone/desktop           # see note below -- not optional

cd desktop
cargo tauri build                       # .app + .dmg under src-tauri/target/release/bundle/
```

The `rm -rf .next/standalone/desktop` step is required, not cleanup. `next build` defaults to
Turbopack, whose file tracer swept this entire directory (including `src-tauri/target/`, a
multi-GB Rust build directory) into the standalone bundle wholesale -- `outputFileTracingExcludes`
in `next.config.ts` correctly filters the `.nft.json` trace files themselves (verifiable after a
build), but the actual standalone copy step doesn't consult that filtered result for Turbopack
builds, so the exclude is effectively a no-op here despite looking like it worked. Confirmed by
directly deleting the directory after a build and it not reappearing on its own -- it's a one-time
copy during `next build`, not a live process, so removing it after every build is safe and
sufficient. Ballooned a release from ~120MB to over 5GB before this was caught.

The `helper/` copy above exists for the same reason in reverse: the tracer includes only some of
`helper/`'s files (never `Package.swift`), so a build relying on the tracer alone ships a broken,
partial copy that fails `swift build` with "could not find Package.swift in this directory or any
of its parent". Copying it explicitly and completely, the same way `public/` and `.next/static`
already are, sidesteps the tracer for a directory it was never meant to reason about in the first
place -- it isn't part of the server's module graph at all.

`tauri.conf.json`'s `bundle.resources` maps `../../.next/standalone/` to `server/` inside the app
bundle — `ensure_code_installed` in `src-tauri/src/lib.rs` is what extracts it on first run, and
`.version` next to the extracted copy is what tells a later launch whether it needs to happen
again after an update.

## Where things live

- `src-tauri/src/lib.rs` — everything: resource extraction, `brain.sh prepare`, spawning and
  owning the server process, the tray, the window-hide-not-quit behaviour, autostart.
- `dist/index.html` — the loading screen shown while `prepare` and the server start up. Plain
  HTML/JS on purpose (no bundler): `app.withGlobalTauri` in `tauri.conf.json` exposes
  `window.__TAURI__` directly rather than needing `@tauri-apps/api` resolved through a build step.
  It calls the `frontend_ready` command the instant its `listen()` calls are registered — Rust
  waits for that handshake before emitting anything, rather than emitting on a timer and hoping
  the page has loaded by then (an event emitted before a listener exists is simply lost, not
  queued).
