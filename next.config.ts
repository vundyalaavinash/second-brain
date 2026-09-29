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
