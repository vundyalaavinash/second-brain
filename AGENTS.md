<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Production notes

This checkout is also the production directory. A launchd agent serves `next start` from `.next` on port 3141. Use `scripts/brain.sh restart --build` to rebuild and restart; run `scripts/brain.sh stop` before ad-hoc builds or dev servers, and `scripts/brain.sh start` afterwards.
