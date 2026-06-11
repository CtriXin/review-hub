#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "review-hub.js");
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [cli, "install-commands", "--write", ...args], {
  stdio: "inherit"
});
process.exit(result.status ?? 1);
