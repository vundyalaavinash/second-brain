#!/usr/bin/env node
"use strict";

/**
 * Stands in for `whisper-cli`: reads `-of <base>` and writes the output the real
 * binary would for `-otxt` (a `.txt` beside the base) or `-oj` (a `.json` with the
 * `transcription` array `parseWhisperJson` expects).
 *
 *   SB_FAKE_WHISPER_TEXT  the line `-otxt` writes (default "hello world")
 *   SB_FAKE_WHISPER_FAIL  exit 1 with a message on stderr
 */

const fs = require("node:fs");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

if (process.env.SB_FAKE_WHISPER_FAIL) {
  process.stderr.write("error: failed to load model\n");
  process.exit(1);
}

const base = flag("-of");
if (!base) {
  process.stderr.write("error: -of is required\n");
  process.exit(1);
}

if (args.includes("-oj")) {
  const json = {
    transcription: [
      { offsets: { from: 0, to: 1500 }, text: " Hello world" },
      { offsets: { from: 1500, to: 3000 }, text: " this is the meeting" },
      { offsets: { from: 3000, to: 3200 }, text: "  " },
    ],
  };
  fs.writeFileSync(`${base}.json`, JSON.stringify(json));
}

if (args.includes("-otxt")) {
  fs.writeFileSync(`${base}.txt`, `${process.env.SB_FAKE_WHISPER_TEXT ?? "hello world"}\n`);
}

process.exit(0);
