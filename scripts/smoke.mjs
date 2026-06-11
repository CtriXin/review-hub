#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "review-hub-smoke-"));
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "review-hub.js");

function run(args, options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || tmp;
  const res = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env,
    encoding: "utf8"
  });
  if (res.status !== 0) {
    throw new Error(`command failed: ${args.join(" ")}\n${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout);
}

run(["init", "--root", tmp]);
const bootstrapHome = fs.mkdtempSync(path.join(os.tmpdir(), "review-hub-home-"));
const bootstrapCwd = fs.mkdtempSync(path.join(os.tmpdir(), "review-hub-bootstrap-"));
fs.mkdirSync(path.join(bootstrapHome, ".claude"), { recursive: true });
fs.mkdirSync(path.join(bootstrapHome, ".codex"), { recursive: true });
const bootstrap = run([
  "init",
  "--runner", "claude"
], {
  cwd: bootstrapCwd,
  env: {
    ...process.env,
    HOME: bootstrapHome
  }
});
const codexBootstrap = run([
  "init",
  "--runner", "codex"
], {
  cwd: bootstrapCwd,
  env: {
    ...process.env,
    HOME: bootstrapHome
  }
});
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
  "--model", "claude-sonnet-4-5"
]);

const reviewer = run([
  "reviewer",
  request.request_root
], {
  env: {
    ...process.env,
    REVIEW_HUB_MODEL: "",
    MULTI_REVIEW_REVIEWER: "",
    MMS_SESSION_PACKET_JSON: "",
    MMS_MODEL_NAME: "claude-sonnet-4-5"
  }
});

const slot = run([
  "slot",
  "--request", request.request_root,
  "--model", "qwen3-7"
]);

const workerPlan = run([
  "worker-plan",
  "--request", request.request_root,
  "--runner", "opencode",
  "--model", "qwen3-7",
  "--model", "glm-5",
  "--parallel", "2"
]);

const launch = JSON.parse(fs.readFileSync(path.join(request.request_root, "launch.json"), "utf8"));
const opencodePlan = JSON.parse(fs.readFileSync(workerPlan.plan_path, "utf8"));
run(["aggregate", "--request", request.request_root]);

const dryRequest = run([
  "request",
  "--root", tmp,
  "--title", "Preview only",
  "--phase", "post",
  "--adapter", "mixed",
  "--dry-run"
]);

if (!fs.existsSync(path.join(slot.slot_root, "PROMPT.md"))) {
  throw new Error("slot prompt missing");
}
if (!fs.existsSync(path.join(request.request_root, "LAUNCH.md"))) {
  throw new Error("launch doc missing");
}
if (!fs.existsSync(workerPlan.plan_doc_path)) {
  throw new Error("worker plan doc missing");
}
if (reviewer.slot_root !== path.join(request.request_root, "reviewers", "claude-sonnet-4-5")) {
  throw new Error("reviewer mode did not resolve the expected slot");
}
if (!Array.isArray(launch.slots) || launch.slots.length !== 4) {
  throw new Error("launch manifest did not record the expected reviewer slots");
}
if (!Array.isArray(launch.worker_plans) || launch.worker_plans.length !== 1) {
  throw new Error("launch manifest did not record worker plans");
}
if (!Array.isArray(opencodePlan.workers) || opencodePlan.workers.length !== 2) {
  throw new Error("worker plan did not record expected workers");
}
if (!String(opencodePlan.workers[0].slot_command || "").includes("review-hub reviewer")) {
  throw new Error("worker plan missing slot command");
}
if (fs.existsSync(dryRequest.request_root)) {
  throw new Error("dry-run request unexpectedly wrote files");
}
if (bootstrap.mode !== "bootstrap") {
  throw new Error("init bootstrap mode did not trigger");
}
if (!fs.lstatSync(path.join(bootstrapHome, ".claude", "commands", "review-hub.md")).isSymbolicLink()) {
  throw new Error("bootstrap command symlink missing");
}
if (!fs.lstatSync(path.join(bootstrapHome, ".claude", "skills", "review-hub")).isSymbolicLink()) {
  throw new Error("bootstrap skill symlink missing");
}
if (!fs.lstatSync(path.join(bootstrapHome, ".codex", "prompts", "review-hub.md")).isSymbolicLink()) {
  throw new Error("codex prompt symlink missing");
}
if (codexBootstrap.mode !== "bootstrap") {
  throw new Error("codex bootstrap mode did not trigger");
}
if (fs.existsSync(path.join(bootstrapCwd, ".review-hub"))) {
  throw new Error("bootstrap mode unexpectedly initialized a local review root");
}
console.log(JSON.stringify({
  ok: true,
  tmp,
  bootstrap_home: bootstrapHome,
  request_root: request.request_root,
  reviewer_slot: reviewer.slot_root,
  slot_root: slot.slot_root,
  launch_path: path.join(request.request_root, "LAUNCH.md"),
  worker_plan_path: workerPlan.plan_path
}, null, 2));
