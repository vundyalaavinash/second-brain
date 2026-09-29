import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Tauri app runs this build directly (node .next/standalone/server.js) rather than
  // building from source on the recipient's machine -- standalone traces exactly the
  // node_modules the server needs into .next/standalone, so nothing else has to ship separately.
  output: "standalone",
  // onnxruntime-node's own .node binary links against a sibling .dylib that Next's file tracer
  // doesn't follow (it only follows require/import, not a native binary's own dynamic-linker
  // dependencies) -- without this the standalone build starts but semantic search silently fails
  // with a dlopen error the moment it's first used.
  outputFileTracingIncludes: {
    "/*": ["node_modules/onnxruntime-node/bin/**/*"],
  },
  // `instrumentation.ts` -> boot() -> db/client.ts's `path.join(process.cwd(), "drizzle")` is a
  // dynamic path nft can't statically resolve, so it falls back to sweeping the whole project root
  // into the "instrumentation" entry's trace. Exclude keys match the trace *entry name* (no leading
  // slash for non-route entries like this one, unlike the page-route "/*" glob above) -- caught this
  // when a standalone build ballooned to 4GB+, then 20GB+ on a second pass (desktop/src-tauri/target/
  // being swept in wholesale, then re-swept from its own prior build's nested copy).
  outputFileTracingExcludes: {
    instrumentation: ["desktop/**", ".git/**"],
  },
  serverExternalPackages: [
    "better-sqlite3",
    "sqlite-vec",
    "@huggingface/transformers",
    "pdf-parse",
    "tesseract.js",
    "linkedom",
    "@mozilla/readability",
  ],
};

export default nextConfig;
