#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "review-hub-smoke-"));
const cli = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "bin", "review-hub.js");

function run(args, env = process.env) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    cwd: tmp,
    env,
    encoding: "utf8"
  });
  if (res.status !== 0) {
    throw new Error(`command failed: ${args.join(" ")}\n${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout);
}

run(["init", "--root", tmp, "--write"]);
const request = run([
  "request",
  "--root", tmp,
  "--title", "Figma reread",
  "--summary", "Check source independently.",
  "--phase", "pre",
  "--adapter", "figma",
  "--focus", "source",
  "--focus", "design",
  "--write"
]);
const slot = run([
  "slot",
  "--request", request.request_root,
  "--model", "qwen3-7",
  "--write"
]);
run(["aggregate", "--request", request.request_root, "--write"]);
if (!fs.existsSync(path.join(slot.slot_root, "PROMPT.md"))) {
  throw new Error("slot prompt missing");
}
console.log(JSON.stringify({ ok: true, tmp, request_root: request.request_root, slot_root: slot.slot_root }, null, 2));
