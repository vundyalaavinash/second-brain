import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
