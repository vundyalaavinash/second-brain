#!/usr/bin/env node
// Copy every `serverExternalPackages` package -- and its dependency closure -- into the standalone
// build, wholesale, replacing whatever Next's file tracer left there.
//
// Why this exists: those packages are deliberately NOT bundled (that is what serverExternalPackages
// means), so they are resolved by `require()` at runtime and the whole package has to be on disk.
// Turbopack's tracer instead copies only the files it statically saw, and at build time it resolves
// the ESM entry points -- so it copied linkedom's `esm/` but not the `cjs/` its `main` field points
// at, and sqlite-vec's `index.mjs` but not the `index.cjs` it actually loads. Both packages ended up
// present as directories and unusable at runtime: "Module not found".
//
// This never showed up locally because `.next/standalone` sits inside the repo, so Node's upward
// module resolution found the repo's own node_modules and masked the missing files entirely. It only
// breaks once the app extracts the bundle to ~/Library/Application Support, where there is no parent
// node_modules to fall back on. The verify step below deliberately resolves from a directory outside
// the repo for exactly that reason.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcModules = path.join(repoRoot, "node_modules");
const destModules = path.join(repoRoot, ".next/standalone/node_modules");
const require = createRequire(path.join(repoRoot, "package.json"));

function externalPackages() {
  const config = fs.readFileSync(path.join(repoRoot, "next.config.ts"), "utf8");
  const block = config.match(/serverExternalPackages:\s*\[([^\]]+)\]/s);
  if (!block) throw new Error("could not find serverExternalPackages in next.config.ts");
  return block[1]
    .split(",")
    .map((entry) => entry.trim().replace(/["']/g, ""))
    .filter(Boolean);
}

/** Every package the given roots need at runtime, including transitive dependencies. */
function closure(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const manifest = path.join(srcModules, name, "package.json");
    if (!fs.existsSync(manifest)) continue;
    seen.add(name);
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    queue.push(...Object.keys(pkg.dependencies ?? {}));
    // optionalDependencies must be followed too, but only the ones actually installed. This is how
    // native packages ship their platform binaries -- sqlite-vec's real extension lives in
    // sqlite-vec-darwin-arm64, and without it the server dies at boot with "Cannot find package
    // 'sqlite-vec-darwin-arm64'". "Optional" here means "only on matching platforms", not
    // "unnecessary". Filtering by what npm actually installed keeps the other platforms' binaries
    // out without having to know which package uses which naming scheme.
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      if (fs.existsSync(path.join(srcModules, dep))) queue.push(dep);
    }
  }
  return [...seen];
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, dereference: false });
}

const roots = externalPackages();
const packages = closure(roots);
let copied = 0;
for (const name of packages) {
  const src = path.join(srcModules, name);
  if (!fs.existsSync(src)) continue;
  copyDir(src, path.join(destModules, name));
  copied += 1;
}
console.log(`externals: copied ${copied} packages (${roots.length} declared + transitive deps)`);

// Turbopack doesn't require externals by their real name -- it rewrites them to content-hashed
// aliases ("better-sqlite3-90e2652d1716b047") and satisfies those through .next/node_modules/,
// where each alias is a SYMLINK to a directory in the real node_modules.
//
// Those symlinks break twice on the way to a user's machine, and both failures are silent:
// Tauri's resource bundler drops the directory entirely when it packages the .app, and the app's
// own install-time copy (copy_dir_recursive in src-tauri/src/lib.rs) uses fs::copy on them, which
// cannot copy a directory. The server then starts, tries to require the alias, and dies with
// "Cannot find module 'better-sqlite3-90e2652d1716b047'" -- which is exactly the failure that
// shipped. Replacing each symlink with a real directory removes the thing both steps mishandle.
function materializeSymlinks(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = path.resolve(dir, fs.readlinkSync(full));
      if (!fs.existsSync(target)) continue;
      fs.rmSync(full, { recursive: true, force: true });
      fs.cpSync(target, full, { recursive: true, dereference: true });
      count += 1;
    } else if (entry.isDirectory()) {
      count += materializeSymlinks(full);
    }
  }
  return count;
}

// onnxruntime-node ships prebuilt native binaries for every platform it supports, and copying the
// package wholesale brings all of them: 52MB of linux and 124MB of win32 .node/.dylib/.dll files
// that cannot execute on the Apple Silicon Mac this app is built for. Removing them is unambiguous
// -- unlike, say, onnxruntime-web, which is 125MB but genuinely referenced from
// @huggingface/transformers' Node build, so it stays until there is evidence it can go.
const DEAD_PLATFORM_BINARIES = ["linux", "win32"];
let pruned = 0;
for (const platform of DEAD_PLATFORM_BINARIES) {
  const dir = path.join(destModules, "onnxruntime-node/bin/napi-v6", platform);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    pruned += 1;
  }
}
if (pruned) console.log(`externals: pruned ${pruned} non-darwin native binary set(s)`);

const aliasDir = path.join(repoRoot, ".next/standalone/.next/node_modules");
const materialized = materializeSymlinks(aliasDir);
console.log(`externals: materialized ${materialized} Turbopack alias symlinks as real directories`);
if (materialized === 0 && fs.existsSync(aliasDir)) {
  console.log("externals: (none were symlinks -- already real directories)");
}

// Resolve each declared external from a scratch directory *outside* the repo, so Node cannot walk
// up into the repo's own node_modules and report a false pass -- the exact hole that let this ship.
const probe = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "sb-externals-"));
fs.cpSync(destModules, path.join(probe, "node_modules"), { recursive: true, dereference: false });
const probeRequire = createRequire(path.join(probe, "index.js"));
const broken = [];
for (const name of roots) {
  try {
    probeRequire.resolve(name);
  } catch (err) {
    broken.push(`${name} (${err.code ?? err.message})`);
  }
}
fs.rmSync(probe, { recursive: true, force: true });

if (broken.length) {
  console.error("externals: STILL UNRESOLVABLE outside the repo:\n  " + broken.join("\n  "));
  process.exit(1);
}
console.log(`externals: all ${roots.length} resolve from an isolated directory`);
