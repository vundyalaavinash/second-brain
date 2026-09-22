#!/usr/bin/env node
"use strict";

/**
 * Stands in for `ffmpeg` in the one shape the transcript job uses:
 * `-y -i <input> -ar 16000 -ac 1 -c:a pcm_s16le <output>`. It writes a real
 * 16 kHz mono WAV of silence at the output path so the rest of the job is
 * exercised without a codec on the machine.
 */

const fs = require("node:fs");

const args = process.argv.slice(2);
const input = args[args.indexOf("-i") + 1];
const output = args[args.length - 1];
if (!input || !fs.existsSync(input)) {
  process.stderr.write(`fake-ffmpeg: no such input ${input}\n`);
  process.exit(1);
}

const frames = 16000;
const data = Buffer.alloc(frames * 2);
const b = Buffer.alloc(44);
b.write("RIFF", 0);
b.writeUInt32LE(36 + data.length, 4);
b.write("WAVE", 8);
b.write("fmt ", 12);
b.writeUInt32LE(16, 16);
b.writeUInt16LE(1, 20);
b.writeUInt16LE(1, 22);
b.writeUInt32LE(16000, 24);
b.writeUInt32LE(32000, 28);
b.writeUInt16LE(2, 32);
b.writeUInt16LE(16, 34);
b.write("data", 36);
b.writeUInt32LE(data.length, 40);
fs.writeFileSync(output, Buffer.concat([b, data]));
process.exit(0);
