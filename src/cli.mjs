import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const PHASES = ["pre", "mid", "post"];
const READ_POLICY_BY_PHASE = {
  pre: "fresh_required",
  mid: "artifact_first_optional_refresh",
  post: "verify_only"
};
const PHASE_LABEL = {
  pre: "事前 review",
  mid: "事中 review",
  post: "事后 review"
};
const DEFAULT_REQUEST_LAYOUT = {
  pre: [
    "independent/00-preflight.md",
    "independent/01-source-log.md",
    "independent/02-independent-findings.md",
    "independent/03-independent-findings.json",
    "compare/01-vs-request-summary.md",
    "compare/02-gaps.json",
    "compare/03-diffs.json",
    "compare/04-final-verdict.md"
  ],
  mid: [
    "review/00-preflight.md",
    "review/01-findings.md",
    "review/02-gaps.json",
    "review/03-risks.json",
    "review/04-final-verdict.md"
  ],
  post: [
    "verify/00-preflight.md",
    "verify/01-checks.md",
    "verify/02-failures.json",
    "verify/03-residual-risks.json",
    "verify/04-final-verdict.md"
  ]
};
const KNOWN_RUNNER_COMMAND_DIRS = [
  "~/.agents/commands",
  "~/.claude/commands",
  "~/.codex/commands",
  "~/.config/opencode/commands",
  "~/.opencode/commands"
];
const KNOWN_RUNNER_SKILL_DIRS = [
  "~/.agents/skills",
  "~/.claude/skills",
  "~/.codex/skills",
  "~/.config/opencode/skills",
  "~/.opencode/skills"
];
const EXPERIMENTAL_COMMAND_DIRS = [
  "~/.config/mimocode/commands"
];
const EXPERIMENTAL_SKILL_DIRS = [
  "~/.config/mimocode/skills"
];

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    return handleInit(rest);
  }
  if (command === "request") {
    return handleRequest(rest);
  }
  if (command === "slot") {
    return handleSlot(rest);
  }
  if (command === "reviewer") {
    return handleReviewer(rest);
  }
  if (command === "aggregate") {
    return handleAggregate(rest);
  }
  if (command === "install-commands") {
    return handleInstallCommands(rest);
  }
  if (command === "recommend") {
    return handleRecommend(rest);
  }

  throw new Error(`unknown command: ${command}`);
}

function printHelp() {
  console.log(`review-hub

Commands:
  init                Initialize a local review-hub root
  request             Create a review request root and optional reviewer slots
  slot                Create one reviewer slot from an existing request
  reviewer            Resolve request/slot path into the current model reviewer slot
  aggregate           Summarize reviewer slot completion and verdict snippets
  install-commands    Install /review-hub command files and skill links locally
  recommend           Recommend phase/read_policy defaults from task text
`);
}

function handleInit(argv) {
  const args = parseArgs(argv, {
    string: ["root", "artifact-mode", "artifact-root"],
    boolean: ["write"]
  });
  const root = resolvePath(args.root || process.cwd());
  const reviewRoot = defaultReviewRoot({
    root,
    artifactMode: args["artifact-mode"] || "standalone",
    artifactRoot: args["artifact-root"]
  });
  const config = {
    schema: "review_hub.config.v1",
    root,
    review_root: reviewRoot,
    created_at: nowIso()
  };
  if (args.write) {
    ensureDir(reviewRoot);
    writeJson(path.join(reviewRoot, "config.json"), config);
    writeText(
      path.join(reviewRoot, "README.md"),
      `# Review Hub\n\n- root: \`${root}\`\n- review_root: \`${reviewRoot}\`\n- created_at: \`${config.created_at}\`\n`
    );
  }
  printJson({ ok: true, root, review_root: reviewRoot, wrote: Boolean(args.write) });
}

function handleRequest(argv) {
  const args = parseArgs(argv, {
    string: [
      "root",
      "path",
      "title",
      "summary",
      "phase",
      "read-policy",
      "adapter",
      "out-dir",
      "artifact-mode",
      "artifact-root",
      "request-id"
    ],
    list: [
      "focus",
      "source-ref",
      "context-path",
      "local-artifact",
      "required-tool",
      "required-path",
      "instruction",
      "model"
    ],
    boolean: ["write"]
  });

  const phase = requirePhase(args.phase);
  const readPolicy = args["read-policy"] || READ_POLICY_BY_PHASE[phase];
  const root = resolvePath(args.root || args.path || process.cwd());
  const adapter = args.adapter || "mixed";
  const focus = ensureList(args.focus, [defaultFocusForPhase(phase)]);
  const title = args.title || "review-hub-request";
  const summary = args.summary || "";
  const requestId = args["request-id"] || `${dateStamp()}-${slugify(title)}`;
  const requestRoot = args["out-dir"]
    ? resolvePath(args["out-dir"])
    : path.join(defaultReviewRoot({
        root,
        artifactMode: args["artifact-mode"] || "standalone",
        artifactRoot: args["artifact-root"]
      }), "requests", requestId);

  const request = {
    schema: "review_hub.request.v1",
    request_id: requestId,
    created_at: nowIso(),
    root,
    request_root: requestRoot,
    phase,
    phase_label: PHASE_LABEL[phase],
    read_policy: readPolicy,
    adapter,
    focus,
    title,
    summary,
    source_refs: ensureList(args["source-ref"]),
    context_paths: normalizePaths(ensureList(args["context-path"])),
    local_artifacts: normalizePaths(ensureList(args["local-artifact"])),
    required_tools: ensureList(args["required-tool"], inferRequiredTools(adapter, phase)),
    required_paths: normalizePaths(ensureList(args["required-path"])),
    instructions: ensureList(args.instruction),
    recommended_capability: recommendCapability(adapter, readPolicy),
    default_outputs: DEFAULT_REQUEST_LAYOUT[phase],
    requested_models: [],
    reviewer_entry_template: "/review-hub <request-root>",
    short_invocation: `/review-hub ${requestRoot}`,
    cli_short_invocation: `review-hub reviewer ${shellQuote(requestRoot)} --write`,
    cli_slot_invocation: `review-hub slot --request ${shellQuote(requestRoot)} --model <MODEL_NAME> --write`,
    short_fallback_prompt: buildReviewerShortPrompt(requestRoot)
  };

  const models = ensureList(args.model);
  for (const model of models) {
    ensureRequestedModel(request, model);
  }

  if (args.write) {
    persistRequestFiles({ requestRoot, request });
  }

  const slots = [];
  if (models.length) {
    for (const model of models) {
      if (args.write) {
        slots.push(createReviewerSlot({ requestRoot, request, model }));
      } else {
        slots.push(previewReviewerSlot({ requestRoot, request, model }));
      }
    }
  }

  if (args.write) {
    persistRequestFiles({ requestRoot, request });
  }

  printJson({
    ok: true,
    request_id: requestId,
    request_root: requestRoot,
    phase,
    read_policy: readPolicy,
    adapter,
    focus,
    short_invocation: request.short_invocation,
    cli_short_invocation: request.cli_short_invocation,
    launch_path: path.join(requestRoot, "LAUNCH.md"),
    launch_json_path: path.join(requestRoot, "launch.json"),
    slots
  });
}

function handleSlot(argv) {
  const args = parseArgs(argv, {
    string: ["request", "model"],
    boolean: ["write"]
  });
  const requestRoot = resolvePath(requiredArg(args.request, "--request is required"));
  const request = readJson(path.join(requestRoot, "request.json"));
  const model = args.model || resolveModelNameFromEnv();
  if (!model) {
    throw new Error("model is required; pass --model or provide MMS model env");
  }

  ensureRequestedModel(request, model);
  const slot = args.write
    ? createReviewerSlot({ requestRoot, request, model })
    : previewReviewerSlot({ requestRoot, request, model });

  if (args.write) {
    persistRequestFiles({ requestRoot, request });
  }

  printJson({
    ok: true,
    ...slot,
    request_root: requestRoot,
    launch_path: path.join(requestRoot, "LAUNCH.md"),
    launch_json_path: path.join(requestRoot, "launch.json")
  });
}

function handleReviewer(argv) {
  const args = parseArgs(argv, {
    string: ["input", "model"],
    boolean: ["write"]
  });
  const rawInput = args.input || args._[0];
  const input = requiredArg(rawInput, "reviewer requires a request root, slot root, or one of their files");
  const target = resolveReviewerTarget(input);
  const request = readJson(path.join(target.request_root, "request.json"));

  if (target.kind === "request") {
    const model = args.model || resolveModelNameFromEnv();
    if (!model) {
      throw new Error("current reviewer model is unknown; pass --model or provide MMS model env");
    }
    ensureRequestedModel(request, model);
    const slot = args.write
      ? createReviewerSlot({ requestRoot: target.request_root, request, model })
      : previewReviewerSlot({ requestRoot: target.request_root, request, model });
    if (args.write) {
      persistRequestFiles({ requestRoot: target.request_root, request });
    }
    return printJson(buildReviewerResult({
      request,
      slot,
      write: Boolean(args.write),
      input,
      resolved_kind: target.kind
    }));
  }

  const currentManifest = safeReadJson(path.join(target.slot_root, "manifest.json"));
  const manifestModel = currentManifest?.model_name || currentManifest?.model_slug || "";
  const model = manifestModel || args.model || resolveModelNameFromEnv();
  if (!model) {
    throw new Error("could not resolve slot model; pass --model or ensure slot manifest/env is available");
  }
  if (manifestModel && args.model && slugify(args.model) !== slugify(manifestModel)) {
    throw new Error(`slot root is already bound to ${manifestModel}; do not override it with ${args.model}`);
  }

  ensureRequestedModel(request, model);
  const slot = args.write
    ? createReviewerSlot({ requestRoot: target.request_root, request, model })
    : previewReviewerSlot({ requestRoot: target.request_root, request, model });
  if (args.write) {
    persistRequestFiles({ requestRoot: target.request_root, request });
  }
  return printJson(buildReviewerResult({
    request,
    slot,
    write: Boolean(args.write),
    input,
    resolved_kind: target.kind
  }));
}

function handleAggregate(argv) {
  const args = parseArgs(argv, {
    string: ["request"],
    boolean: ["write"]
  });
  const requestRoot = resolvePath(requiredArg(args.request, "--request is required"));
  const request = readJson(path.join(requestRoot, "request.json"));
  const manifests = sortReviewerManifests(request, readReviewerManifests(requestRoot));
  const results = manifests.map((manifest) => {
    const expected = manifest.expected_outputs || [];
    const slotRoot = manifest.slot_root || path.join(requestRoot, "reviewers", manifest.model_slug || slugify(manifest.model_name || "unknown"));
    const missing = expected.filter((item) => !fs.existsSync(path.join(slotRoot, item)));
    const verdictPath = path.join(slotRoot, phaseVerdictPath(request.phase));
    const verdictSnippet = fs.existsSync(verdictPath)
      ? extractSnippet(readText(verdictPath), 6)
      : [];
    return {
      order: resolveSlotIndex(request, manifest.model_name || manifest.model_slug || ""),
      model: manifest.model_name,
      slot_root: slotRoot,
      expected_count: expected.length,
      missing_count: missing.length,
      missing,
      verdict_path: verdictPath,
      verdict_snippet: verdictSnippet,
      complete: missing.length === 0
    };
  });

  const aggregate = {
    schema: "review_hub.aggregate.v1",
    request_id: request.request_id,
    request_root: requestRoot,
    phase: request.phase,
    created_at: nowIso(),
    reviewers_total: results.length,
    reviewers_complete: results.filter((item) => item.complete).length,
    reviewers_incomplete: results.filter((item) => !item.complete).length,
    results
  };
  const summaryMd = buildAggregateDoc(request, aggregate);
  if (args.write) {
    ensureDir(path.join(requestRoot, "aggregate"));
    writeJson(path.join(requestRoot, "aggregate", "aggregate.json"), aggregate);
    writeText(path.join(requestRoot, "aggregate", "aggregate.md"), summaryMd);
  }
  printJson({ ok: true, aggregate_path: path.join(requestRoot, "aggregate"), ...aggregate });
}

function handleInstallCommands(argv) {
  const args = parseArgs(argv, {
    boolean: ["write", "include-experimental"],
    string: ["repo-root"]
  });
  const repoRoot = resolvePath(args["repo-root"] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const commandSource = path.join(repoRoot, "commands", "review-hub.md");
  const skillSource = repoRoot;
  const commandDirs = [...KNOWN_RUNNER_COMMAND_DIRS];
  const skillDirs = [...KNOWN_RUNNER_SKILL_DIRS];
  if (args["include-experimental"]) {
    commandDirs.push(...EXPERIMENTAL_COMMAND_DIRS);
    skillDirs.push(...EXPERIMENTAL_SKILL_DIRS);
  }

  const results = [];
  for (const dir of commandDirs) {
    const destination = expandHome(path.join(dir, "review-hub.md"));
    results.push(linkPath(commandSource, destination, args.write));
  }
  for (const dir of skillDirs) {
    const destination = expandHome(path.join(dir, "review-hub"));
    results.push(linkPath(skillSource, destination, args.write));
  }
  printJson({ ok: true, write: Boolean(args.write), results });
}

function handleRecommend(argv) {
  const args = parseArgs(argv, {
    string: ["title", "summary", "adapter"],
    list: ["focus"]
  });
  const title = args.title || "";
  const summary = args.summary || "";
  const adapter = args.adapter || "mixed";
  const focus = ensureList(args.focus);
  const text = `${title}\n${summary}`.toLowerCase();
  const phase = recommendPhase(text, focus, adapter);
  const readPolicy = READ_POLICY_BY_PHASE[phase];
  const questions = phaseQuestions(phase);
  printJson({ ok: true, recommended_phase: phase, read_policy: readPolicy, questions });
}

function persistRequestFiles({ requestRoot, request }) {
  ensureDir(requestRoot);
  writeJson(path.join(requestRoot, "request.json"), request);
  writeText(path.join(requestRoot, "REQUEST.md"), buildRequestDoc(request));
  writeText(path.join(requestRoot, "PROMPT.template.md"), buildPromptTemplate(request, null, "<assigned reviewer slot>"));
  writeJson(path.join(requestRoot, "manifest.json"), buildRequestManifest(request));
  return writeLaunchArtifacts({ requestRoot, request });
}

function buildRequestManifest(request) {
  return {
    schema: "review_hub.request_manifest.v1",
    request_id: request.request_id,
    request_root: request.request_root,
    created_at: request.created_at,
    phase: request.phase,
    read_policy: request.read_policy,
    adapter: request.adapter,
    focus: request.focus,
    requested_models: request.requested_models || [],
    reviewer_entry_template: request.reviewer_entry_template,
    short_invocation: request.short_invocation,
    cli_short_invocation: request.cli_short_invocation,
    expected_core_files: [
      "request.json",
      "REQUEST.md",
      "PROMPT.template.md",
      "LAUNCH.md",
      "launch.json"
    ]
  };
}

function buildRequestDoc(request) {
  const plannedModels = (request.requested_models || []).length
    ? request.requested_models.map((item) => `- \`${item}\``)
    : ["- (none yet)"];

  return [
    `# Review Request`,
    ``,
    `- request_id: \`${request.request_id}\``,
    `- phase: \`${request.phase}\` (${request.phase_label})`,
    `- read_policy: \`${request.read_policy}\``,
    `- adapter: \`${request.adapter}\``,
    `- focus: ${request.focus.map((item) => `\`${item}\``).join(", ") || "(none)"}`,
    `- root: \`${request.root}\``,
    `- request_root: \`${request.request_root}\``,
    `- title: ${request.title}`,
    `- summary: ${request.summary || "(none)"}`,
    ``,
    `## Reviewer launch`,
    `- preferred runner entry: \`${request.short_invocation}\``,
    `- CLI fallback: \`${request.cli_short_invocation}\``,
    `- short fallback prompt: ${request.short_fallback_prompt}`,
    `- launch doc: \`${path.join(request.request_root, "LAUNCH.md")}\``,
    `- launch json: \`${path.join(request.request_root, "launch.json")}\``,
    ``,
    `## Planned reviewers`,
    ...plannedModels,
    ``,
    `## Required tools`,
    ...request.required_tools.map((item) => `- \`${item}\``),
    ...(request.required_tools.length ? [] : ["- (none)"]),
    ``,
    `## Required paths`,
    ...request.required_paths.map((item) => `- \`${item}\``),
    ...(request.required_paths.length ? [] : ["- (none)"]),
    ``,
    `## Source refs`,
    ...request.source_refs.map((item) => `- ${item}`),
    ...(request.source_refs.length ? [] : ["- (none)"]),
    ``,
    `## Context paths`,
    ...request.context_paths.map((item) => `- \`${item}\``),
    ...(request.context_paths.length ? [] : ["- (none)"]),
    ``,
    `## Local artifacts`,
    ...request.local_artifacts.map((item) => `- \`${item}\``),
    ...(request.local_artifacts.length ? [] : ["- (none)"]),
    ``,
    `## Extra instructions`,
    ...request.instructions.map((item) => `- ${item}`),
    ...(request.instructions.length ? [] : ["- (none)"]),
    ``,
    `## Short invocation`,
    ``,
    "```text",
    request.short_invocation,
    "```",
    ``,
    `## Short fallback prompt`,
    ``,
    "```text",
    request.short_fallback_prompt,
    "```",
    ``
  ].join("\n");
}

function buildPromptTemplate(request, modelName, slotRoot) {
  const phaseInstructions = phasePromptBlock(request.phase, request.read_policy);
  const toolPreflight = request.required_tools.length
    ? request.required_tools.map((item) => `- verify tool/capability: \`${item}\``).join("\n")
    : "- no extra tool requirement declared";
  const pathPreflight = request.required_paths.length
    ? request.required_paths.map((item) => `- verify path exists: \`${item}\``).join("\n")
    : "- no extra path requirement declared";
  const contextPaths = request.context_paths.length
    ? request.context_paths.map((item) => `- \`${item}\``).join("\n")
    : "- none";
  const localArtifacts = request.local_artifacts.length
    ? request.local_artifacts.map((item) => `- \`${item}\``).join("\n")
    : "- none";
  const sourceRefs = request.source_refs.length
    ? request.source_refs.map((item) => `- ${item}`).join("\n")
    : "- none";
  const instructions = request.instructions.length
    ? request.instructions.map((item) => `- ${item}`).join("\n")
    : "- none";
  const outputs = request.default_outputs.map((item) => `- \`${item}\``).join("\n");
  const modelLine = modelName ? `- target_model: \`${modelName}\`` : "- target_model: resolve from current session";

  return `# Review Hub Prompt\n\nYou are running a Review Hub request.\n\n## Request\n\n- request_id: \`${request.request_id}\`\n- title: ${request.title}\n- phase: \`${request.phase}\`\n- read_policy: \`${request.read_policy}\`\n- adapter: \`${request.adapter}\`\n- focus: ${request.focus.map((item) => `\`${item}\``).join(", ")}\n${modelLine}\n- root: \`${request.root}\`\n- request_root: \`${request.request_root}\`\n- slot_root: \`${slotRoot}\`\n\n## Goal\n\n${request.summary || "Review the target task with the declared phase/read policy and produce durable artifacts."}\n\n## Environment preflight (must do first)\n\n1. Confirm your current working root and the request root.\n2. Verify required tools and capabilities before deep work:\n${toolPreflight}\n3. Verify required paths before deep work:\n${pathPreflight}\n4. If any required tool/path is unavailable, write the preflight artifact as blocked and stop. Do not spend time doing partial review without the declared prerequisites.\n\n## Source / context\n\n### source_refs\n${sourceRefs}\n\n### context_paths\n${contextPaths}\n\n### local_artifacts\n${localArtifacts}\n\n### extra_instructions\n${instructions}\n\n## Phase contract\n\n${phaseInstructions}\n\n## Output root\n\nWrite only inside \`${slotRoot}\`.\n\n## Required outputs\n\n${outputs}\n\n## Quality bar\n\n- State uncertainty explicitly; do not guess.\n- If you escalate from verify-only or artifact-first into a fresh reread, explain why.\n- Prefer concise, actionable findings over long prose.\n- Put blockers and missing prerequisites first.\n`;
}

function phasePromptBlock(phase, readPolicy) {
  if (phase === "pre") {
    return `- This is a **pre** review.\n- Because read_policy is \`${readPolicy}\`, treat local interpretations as non-authoritative until your independent source read is complete.\n- If adapter/source requires fresh reread (for example Figma MCP), do that before reading local audit conclusions.\n- Your job is to catch missing source leaves, bad decomposition, wrong assumptions, and hidden contradictions before implementation.`;
  }
  if (phase === "mid") {
    return `- This is a **mid** review.\n- Because read_policy is \`${readPolicy}\`, read the existing request/context/artifacts first, then decide whether a source refresh is needed.\n- Your job is to challenge the current implementation/audit/plan, identify scope drift, and surface risky assumptions or missing checks.`;
  }
  return `- This is a **post** review.\n- Because read_policy is \`${readPolicy}\`, verify the claimed result and evidence first; do not reread source by default.\n- Only escalate into a fresh source read if the claims, evidence, or live state conflict.\n- Your job is to verify correctness, regressions, and whether done-state is justified.`;
}

function createReviewerSlot({ requestRoot, request, model }) {
  const slot = previewReviewerSlot({ requestRoot, request, model });
  const existedBefore = fs.existsSync(slot.slot_root);
  ensureDir(slot.slot_root);
  ensureDir(path.join(slot.slot_root, "raw"));
  writeText(path.join(slot.slot_root, "PROMPT.md"), buildPromptTemplate(request, model, slot.slot_root));
  writeJson(path.join(slot.slot_root, "manifest.json"), {
    schema: "review_hub.slot_manifest.v1",
    request_id: request.request_id,
    request_root: requestRoot,
    model_name: model,
    model_slug: slot.model_slug,
    slot_index: slot.slot_index,
    slot_root: slot.slot_root,
    created_at: nowIso(),
    phase: request.phase,
    read_policy: request.read_policy,
    adapter: request.adapter,
    focus: request.focus,
    prompt_path: path.join(slot.slot_root, "PROMPT.md"),
    launch_path: path.join(requestRoot, "LAUNCH.md"),
    launch_json_path: path.join(requestRoot, "launch.json"),
    short_command: request.short_invocation,
    short_fallback_prompt: request.short_fallback_prompt,
    expected_outputs: slot.expected_outputs
  });
  return { ...slot, existed_before: existedBefore };
}

function previewReviewerSlot({ requestRoot, request, model }) {
  const modelSlug = slugify(model);
  const slotRoot = path.join(requestRoot, "reviewers", modelSlug);
  return {
    model_name: model,
    model_slug: modelSlug,
    slot_index: resolveSlotIndex(request, model),
    slot_root: slotRoot,
    expected_outputs: request.default_outputs,
    prompt_path: path.join(slotRoot, "PROMPT.md"),
    manifest_path: path.join(slotRoot, "manifest.json"),
    short_command: request.short_invocation,
    cli_fallback_command: `review-hub reviewer ${shellQuote(requestRoot)} --model ${shellQuote(model)} --write`,
    short_fallback_prompt: request.short_fallback_prompt
  };
}

function writeLaunchArtifacts({ requestRoot, request }) {
  const manifests = sortReviewerManifests(request, readReviewerManifests(requestRoot));
  const launch = buildLaunchData({ request, reviewerManifests: manifests });
  writeJson(path.join(requestRoot, "launch.json"), launch);
  writeText(path.join(requestRoot, "LAUNCH.md"), buildLaunchDoc(request, launch));
  return launch;
}

function buildLaunchData({ request, reviewerManifests }) {
  const slots = reviewerManifests.map((manifest, index) => {
    const modelName = manifest.model_name || manifest.model_slug || `reviewer-${index + 1}`;
    const modelSlug = manifest.model_slug || slugify(modelName);
    const slotRoot = manifest.slot_root || path.join(request.request_root, "reviewers", modelSlug);
    const expectedOutputs = manifest.expected_outputs || request.default_outputs;
    const missingOutputs = expectedOutputs.filter((item) => !fs.existsSync(path.join(slotRoot, item)));
    return {
      order: manifest.slot_index || resolveSlotIndex(request, modelName) || index + 1,
      model_name: modelName,
      model_slug: modelSlug,
      slot_root: slotRoot,
      prompt_path: manifest.prompt_path || path.join(slotRoot, "PROMPT.md"),
      manifest_path: path.join(slotRoot, "manifest.json"),
      complete: missingOutputs.length === 0,
      missing_outputs: missingOutputs,
      expected_outputs: expectedOutputs,
      short_command: request.short_invocation,
      cli_fallback_command: `review-hub reviewer ${shellQuote(request.request_root)} --model ${shellQuote(modelName)} --write`
    };
  });

  return {
    schema: "review_hub.launch.v1",
    request_id: request.request_id,
    request_root: request.request_root,
    root: request.root,
    phase: request.phase,
    read_policy: request.read_policy,
    adapter: request.adapter,
    focus: request.focus,
    requested_models: request.requested_models || [],
    reviewer_entry_template: request.reviewer_entry_template,
    reviewer_entry_command: request.short_invocation,
    reviewer_cli_command: request.cli_short_invocation,
    reviewer_short_prompt: request.short_fallback_prompt,
    generated_at: nowIso(),
    slots
  };
}

function buildLaunchDoc(request, launch) {
  const lines = [
    `# Review Hub Launch`,
    ``,
    `- request_id: \`${request.request_id}\``,
    `- title: ${request.title}`,
    `- phase: \`${request.phase}\``,
    `- request_root: \`${request.request_root}\``,
    `- runner short command: \`${launch.reviewer_entry_command}\``,
    `- CLI fallback: \`${launch.reviewer_cli_command}\``,
    ``,
    `## Preferred flow`,
    `1. Open the target runner/model session manually.`,
    `2. \`cd ${request.root}\``,
    `3. Run \`${launch.reviewer_entry_command}\`.`,
    `4. The reviewer resolves the current model from MMS env, hydrates or reuses the matching slot, runs preflight first, and writes only inside that slot.`,
    ``,
    `## Short fallback prompt`,
    ``,
    "```text",
    launch.reviewer_short_prompt,
    "```",
    ``,
    `Use the short fallback prompt only when the runner does not support the \`/review-hub\` command surface.`,
    ``,
    `## Ordered slots`
  ];

  if (!launch.slots.length) {
    lines.push(`- no reviewer slots exist yet; the first reviewer session will create one for its current model.`);
    lines.push("");
    return lines.join("\n");
  }

  for (const slot of launch.slots) {
    lines.push(``);
    lines.push(`### ${String(slot.order).padStart(2, "0")} - ${slot.model_name}`);
    lines.push(`- slot_root: \`${slot.slot_root}\``);
    lines.push(`- prompt_path: \`${slot.prompt_path}\``);
    lines.push(`- status: ${slot.complete ? "complete" : "pending"}`);
    if (slot.missing_outputs.length) {
      lines.push(`- missing_outputs:`);
      for (const item of slot.missing_outputs) {
        lines.push(`  - \`${item}\``);
      }
    }
    lines.push(`- short_command: \`${slot.short_command}\``);
    lines.push(`- CLI fallback: \`${slot.cli_fallback_command}\``);
  }
  lines.push("");
  return lines.join("\n");
}

function buildReviewerResult({ request, slot, write, input, resolved_kind }) {
  return {
    ok: true,
    mode: "reviewer",
    resolved_kind,
    input: resolvePath(input),
    request_id: request.request_id,
    request_root: request.request_root,
    phase: request.phase,
    read_policy: request.read_policy,
    model_name: slot.model_name,
    model_slug: slot.model_slug,
    slot_index: slot.slot_index,
    slot_root: slot.slot_root,
    prompt_path: slot.prompt_path,
    manifest_path: slot.manifest_path,
    launch_path: path.join(request.request_root, "LAUNCH.md"),
    launch_json_path: path.join(request.request_root, "launch.json"),
    short_command: request.short_invocation,
    cli_short_invocation: request.cli_short_invocation,
    short_fallback_prompt: request.short_fallback_prompt,
    expected_outputs: slot.expected_outputs,
    write,
    existed_before: slot.existed_before ?? fs.existsSync(slot.slot_root)
  };
}

function buildAggregateDoc(request, aggregate) {
  const lines = [
    `# Review Hub Aggregate`,
    ``,
    `- request_id: \`${request.request_id}\``,
    `- phase: \`${request.phase}\``,
    `- reviewers_total: ${aggregate.reviewers_total}`,
    `- reviewers_complete: ${aggregate.reviewers_complete}`,
    `- reviewers_incomplete: ${aggregate.reviewers_incomplete}`,
    ``
  ];
  for (const item of aggregate.results) {
    lines.push(`## ${item.order ? `${String(item.order).padStart(2, "0")} - ` : ""}${item.model || "unknown"}`);
    lines.push(`- slot_root: \`${item.slot_root}\``);
    lines.push(`- expected_count: ${item.expected_count}`);
    lines.push(`- missing_count: ${item.missing_count}`);
    if (item.missing.length) {
      lines.push(`- missing:`);
      for (const missing of item.missing) {
        lines.push(`  - \`${missing}\``);
      }
    }
    if (item.verdict_snippet.length) {
      lines.push(`- verdict_snippet:`);
      for (const line of item.verdict_snippet) {
        lines.push(`  - ${line}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function resolveReviewerTarget(input) {
  const resolvedInput = resolvePath(input);
  const candidate = normalizeReviewerInputPath(resolvedInput);
  if (fs.existsSync(path.join(candidate, "request.json"))) {
    return { kind: "request", request_root: candidate };
  }

  const manifest = safeReadJson(path.join(candidate, "manifest.json"));
  if (manifest?.schema === "review_hub.request_manifest.v1" && fs.existsSync(path.join(candidate, "REQUEST.md"))) {
    return { kind: "request", request_root: candidate };
  }

  if (isReviewerSlotRoot(candidate, manifest)) {
    return {
      kind: "slot",
      slot_root: candidate,
      request_root: manifest?.request_root || path.resolve(candidate, "..", "..")
    };
  }

  throw new Error(`could not resolve reviewer input: ${resolvedInput}`);
}

function normalizeReviewerInputPath(resolvedInput) {
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`reviewer input does not exist: ${resolvedInput}`);
  }
  const stat = fs.statSync(resolvedInput);
  if (stat.isDirectory()) {
    return resolvedInput;
  }
  return path.dirname(resolvedInput);
}

function isReviewerSlotRoot(candidate, manifest) {
  if (manifest?.schema === "review_hub.slot_manifest.v1") {
    return true;
  }
  if (fs.existsSync(path.join(candidate, "PROMPT.md")) && path.basename(path.dirname(candidate)) === "reviewers") {
    return true;
  }
  return false;
}

function readReviewerManifests(requestRoot) {
  const reviewersRoot = path.join(requestRoot, "reviewers");
  if (!fs.existsSync(reviewersRoot)) {
    return [];
  }
  const manifests = [];
  for (const entry of fs.readdirSync(reviewersRoot)) {
    const slotRoot = path.join(reviewersRoot, entry);
    const manifestPath = path.join(slotRoot, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifest = safeReadJson(manifestPath);
    if (!manifest) {
      continue;
    }
    manifests.push({
      ...manifest,
      slot_root: manifest.slot_root || slotRoot,
      model_slug: manifest.model_slug || entry
    });
  }
  return manifests;
}

function sortReviewerManifests(request, manifests) {
  return [...manifests].sort((left, right) => {
    const leftOrder = left.slot_index || resolveSlotIndex(request, left.model_name || left.model_slug || "") || Number.MAX_SAFE_INTEGER;
    const rightOrder = right.slot_index || resolveSlotIndex(request, right.model_name || right.model_slug || "") || Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return String(left.model_name || left.model_slug || "").localeCompare(String(right.model_name || right.model_slug || ""));
  });
}

function resolveSlotIndex(request, model) {
  const requestedModels = Array.isArray(request.requested_models) ? request.requested_models : [];
  const targetSlug = slugify(model);
  const index = requestedModels.findIndex((item) => slugify(item) === targetSlug);
  if (index === -1) {
    return requestedModels.length ? requestedModels.length + 1 : 1;
  }
  return index + 1;
}

function ensureRequestedModel(request, model) {
  if (!Array.isArray(request.requested_models)) {
    request.requested_models = [];
  }
  const targetSlug = slugify(model);
  if (!request.requested_models.some((item) => slugify(item) === targetSlug)) {
    request.requested_models.push(model);
  }
}

function buildReviewerShortPrompt(requestRoot) {
  return `Review Hub reviewer mode for ${requestRoot}. Resolve the current session model, hydrate or reuse that model's slot, run environment preflight first, and write only inside the assigned slot.`;
}

function recommendPhase(text, focus, adapter) {
  const joinedFocus = (focus || []).join(",").toLowerCase();
  if (/done|acceptance|verify|verification|regression|上线|验收|发布后/.test(text) || joinedFocus.includes("regression") || adapter === "live-site") {
    return "post";
  }
  if (/before|source|figma|annotation|read again|reread|拆解|计划|设计稿|标注/.test(text) || joinedFocus.includes("source") || joinedFocus.includes("design")) {
    return "pre";
  }
  return "mid";
}

function phaseQuestions(phase) {
  if (phase === "pre") {
    return [
      "Do you want an independent source reread before trusting any existing audit?",
      "Should the reviewer avoid local conclusions until source coverage is rebuilt?"
    ];
  }
  if (phase === "mid") {
    return [
      "Do you want the reviewer to challenge the current plan/audit/implementation first?",
      "Should source reread be optional only when the current artifact looks weak?"
    ];
  }
  return [
    "Do you mainly want result verification instead of source reread?",
    "Should the reviewer only escalate to a source reread when evidence and claims conflict?"
  ];
}

function phaseVerdictPath(phase) {
  return DEFAULT_REQUEST_LAYOUT[phase][DEFAULT_REQUEST_LAYOUT[phase].length - 1];
}

function inferRequiredTools(adapter, phase) {
  if (adapter === "figma") {
    return phase === "post" ? ["figma-mcp(optional on conflict)"] : ["figma-mcp"];
  }
  if (adapter === "live-site") {
    return ["browser-or-web-access"];
  }
  return [];
}

function recommendCapability(adapter, readPolicy) {
  if (adapter === "figma" || adapter === "image") {
    return readPolicy === "verify_only" ? "artifact_only_or_visual_native" : "visual_native_preferred";
  }
  if (adapter === "live-site") {
    return "browser_capable";
  }
  return "metadata_first";
}

function defaultFocusForPhase(phase) {
  if (phase === "pre") {
    return "source";
  }
  if (phase === "post") {
    return "acceptance";
  }
  return "source";
}

function defaultReviewRoot({ root, artifactMode, artifactRoot }) {
  if (artifactMode === "mission-control") {
    const resolved = resolvePath(requiredArg(artifactRoot, "--artifact-root is required when --artifact-mode mission-control"));
    return path.join(resolved, ".mission", "reviews");
  }
  return path.join(resolvePath(root), ".review-hub");
}

function linkPath(source, destination, write) {
  const src = resolvePath(source);
  const dest = expandHome(destination);
  const parent = path.dirname(dest);
  let status = "preview";
  if (fs.existsSync(dest)) {
    try {
      const stat = fs.lstatSync(dest);
      if (stat.isSymbolicLink()) {
        const current = path.resolve(parent, fs.readlinkSync(dest));
        if (current === src) {
          return { source: src, destination: dest, write, exists: true, status: "already_linked" };
        }
        if (!write) {
          return { source: src, destination: dest, write, exists: true, status: "would_replace_symlink" };
        }
        fs.rmSync(dest, { recursive: true, force: true });
        status = "replaced_symlink";
      } else {
        return { source: src, destination: dest, write, exists: true, status: "skipped_existing_unmanaged" };
      }
    } catch {
      return { source: src, destination: dest, write, exists: true, status: "skipped_stat_error" };
    }
  }
  if (write) {
    fs.mkdirSync(parent, { recursive: true });
    fs.symlinkSync(src, dest, fs.statSync(src).isDirectory() ? "dir" : "file");
    if (status === "preview") {
      status = "created_symlink";
    }
  }
  return { source: src, destination: dest, write, exists: fs.existsSync(dest), status };
}

function resolveModelNameFromEnv() {
  const ordered = [
    process.env.MULTI_REVIEW_REVIEWER,
    process.env.REVIEW_HUB_MODEL,
    process.env.MMS_MODEL_NAME
  ];
  for (const value of ordered) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  const packetPath = process.env.MMS_SESSION_PACKET_JSON;
  if (packetPath && fs.existsSync(packetPath)) {
    try {
      const packet = readJson(packetPath);
      const primary = packet?.model?.primary;
      if (typeof primary === "string" && primary.trim()) {
        return primary.trim();
      }
    } catch {
      // ignore and keep falling back
    }
  }
  return "";
}

function requirePhase(value) {
  const phase = String(value || "").trim();
  if (!PHASES.includes(phase)) {
    throw new Error(`phase is required and must be one of: ${PHASES.join(", ")}`);
  }
  return phase;
}

function parseArgs(argv, spec = {}) {
  const result = { _: [] };
  const stringFlags = new Set(spec.string || []);
  const listFlags = new Set(spec.list || []);
  const booleanFlags = new Set(spec.boolean || []);
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      result._.push(item);
      continue;
    }
    const key = item.slice(2);
    if (booleanFlags.has(key)) {
      result[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    i += 1;
    if (listFlags.has(key)) {
      if (!Array.isArray(result[key])) {
        result[key] = [];
      }
      result[key].push(value);
    } else if (stringFlags.has(key) || !Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = value;
    }
  }
  return result;
}

function ensureList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [...fallback];
}

function requiredArg(value, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value;
}

function normalizePaths(items) {
  return items.map((item) => resolvePath(item));
}

function resolvePath(value) {
  if (!value) {
    return process.cwd();
  }
  return path.resolve(expandHome(value));
}

function expandHome(value) {
  if (!value.startsWith("~")) {
    return value;
  }
  return path.join(os.homedir(), value.slice(1));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return readJson(filePath);
  } catch {
    return null;
  }
}

function writeText(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, data, "utf8");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function printJson(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function extractSnippet(text, limit) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .slice(0, limit);
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function nowIso() {
  return new Date().toISOString();
}

function dateStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
