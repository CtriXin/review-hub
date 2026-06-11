#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "review-hub-smoke-"));
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "review-hub.js");

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
  "--model", "gpt-5",
  "--model", "claude-sonnet-4-5",
  "--write"
]);

const reviewer = run([
  "reviewer",
  request.request_root,
  "--write"
], {
  ...process.env,
  MMS_SESSION_PACKET_JSON: "",
  MMS_MODEL_NAME: "claude-sonnet-4-5"
});

const slot = run([
  "slot",
  "--request", request.request_root,
  "--model", "qwen3-7",
  "--write"
]);

const launch = JSON.parse(fs.readFileSync(path.join(request.request_root, "launch.json"), "utf8"));
run(["aggregate", "--request", request.request_root, "--write"]);

if (!fs.existsSync(path.join(slot.slot_root, "PROMPT.md"))) {
  throw new Error("slot prompt missing");
}
if (!fs.existsSync(path.join(request.request_root, "LAUNCH.md"))) {
  throw new Error("launch doc missing");
}
if (reviewer.slot_root !== path.join(request.request_root, "reviewers", "claude-sonnet-4-5")) {
  throw new Error("reviewer mode did not resolve the expected slot");
}
if (!Array.isArray(launch.slots) || launch.slots.length !== 3) {
  throw new Error("launch manifest did not record the expected reviewer slots");
}
console.log(JSON.stringify({
  ok: true,
  tmp,
  request_root: request.request_root,
  reviewer_slot: reviewer.slot_root,
  slot_root: slot.slot_root,
  launch_path: path.join(request.request_root, "LAUNCH.md")
}, null, 2));
