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
const KNOWN_RUNNER_PROMPT_DIRS = [
  "~/.codex/prompts"
];
const EXPERIMENTAL_COMMAND_DIRS = [
  "~/.config/mimocode/commands"
];
const EXPERIMENTAL_SKILL_DIRS = [
  "~/.config/mimocode/skills"
];
const RUNNER_CATALOG = [
  {
    id: "agents",
    label: "Agents",
    description: "Generic shared command + skill surface",
    surfaces: [
      {
        root: "~/.agents",
        command_dir: "~/.agents/commands",
        skill_dir: "~/.agents/skills",
        preferred: true
      }
    ]
  },
  {
    id: "claude",
    label: "Claude",
    detect_commands: ["claude"],
    surfaces: [
      {
        root: "~/.claude",
        command_dir: "~/.claude/commands",
        skill_dir: "~/.claude/skills",
        preferred: true
      }
    ]
  },
  {
    id: "codex",
    label: "Codex",
    detect_commands: ["codex"],
    surfaces: [
      {
        root: "~/.codex",
        command_dir: "~/.codex/commands",
        prompt_dir: "~/.codex/prompts",
        skill_dir: "~/.codex/skills",
        preferred: true
      }
    ]
  },
  {
    id: "opencode",
    label: "OpenCode",
    detect_commands: ["opencode"],
    surfaces: [
      {
        root: "~/.config/opencode",
        command_dir: "~/.config/opencode/commands",
        skill_dir: "~/.config/opencode/skills",
        preferred: true
      },
      {
        root: "~/.opencode",
        command_dir: "~/.opencode/commands",
        skill_dir: "~/.opencode/skills"
      }
    ]
  },
  {
    id: "mimocode",
    label: "MimoCode",
    detect_commands: ["mimocode"],
    experimental: true,
    surfaces: [
      {
        root: "~/.config/mimocode",
        command_dir: "~/.config/mimocode/commands",
        skill_dir: "~/.config/mimocode/skills",
        preferred: true
      }
    ]
  },
  {
    id: "agy",
    label: "Agy",
    detect_commands: ["agy"],
    manual_only: true,
    manual_hint: "review-hub reviewer '<request-root>' --model '<MODEL_NAME>'"
  },
  {
    id: "pi",
    label: "Pi",
    detect_commands: ["pi"],
    manual_only: true,
    manual_hint: "review-hub reviewer '<request-root>' --model '<MODEL_NAME>'"
  }
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
  if (command === "worker-plan") {
    return handleWorkerPlan(rest);
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
  init                Interactive runner bootstrap, or initialize a local review-hub root with --root
  request             Create a review request root and optional reviewer slots
  slot                Create one reviewer slot from an existing request
  reviewer            Resolve request/slot path into the current model reviewer slot
  aggregate           Summarize reviewer slot completion and verdict snippets
  worker-plan         Write a per-model toolful worker launch plan
  install-commands    Install /review-hub command files and skill links locally
  recommend           Recommend phase/read_policy defaults from task text

Default behavior writes real artifacts.
Add --dry-run when you explicitly want preview/no-write behavior.
Interactive init/install summaries default to human-readable text; add --json for machine output.
`);
}

async function handleInit(argv) {
  const args = parseArgs(argv, {
    list: ["runner"],
    string: ["root", "artifact-mode", "artifact-root"],
    boolean: ["write", "dry-run", "dryrun", "include-experimental", "all-runners", "json"]
  });
  const write = shouldWrite(args);
  const humanOutput = wantsHumanOutput(args);
  const explicitLocalRoot = Boolean(args.root || args["artifact-mode"] || args["artifact-root"]);
  const requestedRunners = ensureList(args.runner).map((item) => slugify(item));

  // Bare `review-hub init` is onboarding-first when an interactive terminal is available.
  if (!explicitLocalRoot && (requestedRunners.length || isInteractiveTerminal())) {
    const bootstrap = await runInitBootstrap({
      requestedRunners,
      includeExperimental: Boolean(args["include-experimental"]),
      selectAll: Boolean(args["all-runners"]),
      write
    });
    if (humanOutput) {
      printBootstrapSummary({ result: bootstrap, write });
      return;
    }
    printJson({ ok: true, mode: "bootstrap", write, ...bootstrap });
    return;
  }

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
  if (write) {
    ensureDir(reviewRoot);
    writeJson(path.join(reviewRoot, "config.json"), config);
    writeText(
      path.join(reviewRoot, "README.md"),
      `# Review Hub\n\n- root: \`${root}\`\n- review_root: \`${reviewRoot}\`\n- created_at: \`${config.created_at}\`\n`
    );
  }
  if (humanOutput) {
    printLocalRootSummary({ root, reviewRoot, write });
    return;
  }
  printJson({ ok: true, mode: "local-root", root, review_root: reviewRoot, wrote: write });
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
    boolean: ["write", "dry-run", "dryrun"]
  });
  const write = shouldWrite(args);

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
    cli_short_invocation: `review-hub reviewer ${shellQuote(requestRoot)} --model '<MODEL_NAME>'`,
    cli_slot_invocation: `review-hub slot --request ${shellQuote(requestRoot)} --model <MODEL_NAME>`,
    short_fallback_prompt: buildReviewerShortPrompt(requestRoot)
  };

  const models = ensureList(args.model);
  for (const model of models) {
    ensureRequestedModel(request, model);
  }

  if (write) {
    persistRequestFiles({ requestRoot, request });
  }

  const slots = [];
  if (models.length) {
    for (const model of models) {
      if (write) {
        slots.push(createReviewerSlot({ requestRoot, request, model }));
      } else {
        slots.push(previewReviewerSlot({ requestRoot, request, model }));
      }
    }
  }

  if (write) {
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
    boolean: ["write", "dry-run", "dryrun"]
  });
  const write = shouldWrite(args);
  const requestRoot = resolvePath(requiredArg(args.request, "--request is required"));
  const request = readJson(path.join(requestRoot, "request.json"));
  const model = args.model || resolveModelNameFromEnv();
  if (!model) {
    throw new Error("model is required; pass --model or provide MMS model env");
  }

  ensureRequestedModel(request, model);
  const slot = write
    ? createReviewerSlot({ requestRoot, request, model })
    : previewReviewerSlot({ requestRoot, request, model });

  if (write) {
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
    boolean: ["write", "dry-run", "dryrun"]
  });
  const write = shouldWrite(args);
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
    const slot = write
      ? createReviewerSlot({ requestRoot: target.request_root, request, model })
      : previewReviewerSlot({ requestRoot: target.request_root, request, model });
    if (write) {
      persistRequestFiles({ requestRoot: target.request_root, request });
    }
    return printJson(buildReviewerResult({
      request,
      slot,
      write,
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
  const slot = write
    ? createReviewerSlot({ requestRoot: target.request_root, request, model })
    : previewReviewerSlot({ requestRoot: target.request_root, request, model });
  if (write) {
    persistRequestFiles({ requestRoot: target.request_root, request });
  }
  return printJson(buildReviewerResult({
    request,
    slot,
    write,
    input,
    resolved_kind: target.kind
  }));
}

function handleAggregate(argv) {
  const args = parseArgs(argv, {
    string: ["request"],
    boolean: ["write", "dry-run", "dryrun"]
  });
  const write = shouldWrite(args);
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
  if (write) {
    ensureDir(path.join(requestRoot, "aggregate"));
    writeJson(path.join(requestRoot, "aggregate", "aggregate.json"), aggregate);
    writeText(path.join(requestRoot, "aggregate", "aggregate.md"), summaryMd);
  }
  printJson({ ok: true, aggregate_path: path.join(requestRoot, "aggregate"), ...aggregate });
}

function handleWorkerPlan(argv) {
  const args = parseArgs(argv, {
    string: ["request", "runner", "agent", "parallel"],
    list: ["model"],
    boolean: ["write", "dry-run", "dryrun"]
  });
  const write = shouldWrite(args);
  const requestRoot = resolvePath(requiredArg(args.request, "--request is required"));
  const request = readJson(path.join(requestRoot, "request.json"));
  const runner = args.runner || "opencode";
  const agent = args.agent || "review-hub-worker";
  const parallel = parsePositiveInt(args.parallel, 0);
  const models = ensureList(args.model, request.requested_models || []);
  if (!models.length) {
    throw new Error("worker-plan requires --model or existing requested_models");
  }

  const slots = [];
  for (const model of models) {
    ensureRequestedModel(request, model);
    slots.push(write
      ? createReviewerSlot({ requestRoot, request, model })
      : previewReviewerSlot({ requestRoot, request, model }));
  }

  const plan = buildWorkerPlan({
    request,
    requestRoot,
    runner,
    agent,
    parallel,
    slots
  });

  if (write) {
    writeWorkerPlanArtifacts({ requestRoot, request, plan });
    persistRequestFiles({ requestRoot, request });
  }

  printJson({
    ok: true,
    write,
    request_root: requestRoot,
    runner,
    plan_path: plan.plan_path,
    plan_doc_path: plan.plan_doc_path,
    worker_count: plan.workers.length,
    workers: plan.workers
  });
}

function handleInstallCommands(argv) {
  const args = parseArgs(argv, {
    boolean: ["write", "dry-run", "dryrun", "include-experimental", "all-runners", "json"],
    string: ["repo-root"],
    list: ["runner"]
  });
  const write = shouldWrite(args);
  const humanOutput = wantsHumanOutput(args);
  const repoRoot = resolvePath(args["repo-root"] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const requestedRunners = ensureList(args.runner).map((item) => slugify(item));
  if (requestedRunners.length || args["all-runners"]) {
    const bootstrap = installRunnerSurfaces({
      repoRoot,
      requestedRunners,
      includeExperimental: Boolean(args["include-experimental"]),
      selectAll: Boolean(args["all-runners"]),
      write
    });
    if (humanOutput) {
      printBootstrapSummary({ result: bootstrap, write });
      return;
    }
    printJson({ ok: true, write, mode: "targeted", ...bootstrap });
    return;
  }
  const commandSource = path.join(repoRoot, "commands", "review-hub.md");
  const promptSource = path.join(repoRoot, "prompts", "review-hub.md");
  const skillSource = repoRoot;
  const commandDirs = [...KNOWN_RUNNER_COMMAND_DIRS];
  const skillDirs = [...KNOWN_RUNNER_SKILL_DIRS];
  const promptDirs = [...KNOWN_RUNNER_PROMPT_DIRS];
  if (args["include-experimental"]) {
    commandDirs.push(...EXPERIMENTAL_COMMAND_DIRS);
    skillDirs.push(...EXPERIMENTAL_SKILL_DIRS);
  }

  const results = [];
  for (const dir of commandDirs) {
    const destination = expandHome(path.join(dir, "review-hub.md"));
    results.push(linkPath(commandSource, destination, write));
  }
  for (const dir of skillDirs) {
    const destination = expandHome(path.join(dir, "review-hub"));
    results.push(linkPath(skillSource, destination, write));
  }
  for (const dir of promptDirs) {
    const destination = expandHome(path.join(dir, "review-hub.md"));
    results.push(linkPath(promptSource, destination, write));
  }
  if (humanOutput) {
    printBulkInstallSummary({ results, write });
    return;
  }
  printJson({ ok: true, write, results });
}

async function runInitBootstrap({ requestedRunners, includeExperimental, selectAll, write }) {
  const repoRoot = resolvePath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const detection = detectRunnerCatalog({
    repoRoot,
    includeExperimental
  });

  if (requestedRunners.length || selectAll) {
    return installRunnerSurfaces({
      repoRoot,
      requestedRunners,
      includeExperimental,
      selectAll,
      write,
      detection
    });
  }

  const installableDetected = detection.installable.filter((runner) => runner.detected);
  const actionableDetected = installableDetected.filter((runner) => isActionableInstallState(runner.install_state));
  const alreadyInstalled = installableDetected.filter((runner) => runner.install_state === "already_installed");
  const manualOnlyDetected = detection.manual_only.filter((runner) => runner.detected);
  if (!installableDetected.length) {
    return {
      status: "no_detected_installable_runners",
      selected_runners: [],
      detected_installable: [],
      manual_only_detected: manualOnlyDetected.map(summarizeRunnerState),
      installation_results: []
    };
  }

  if (!actionableDetected.length) {
    return {
      status: "already_installed",
      selected_runners: [],
      detected_installable: installableDetected.map(summarizeRunnerState),
      installed_runners: alreadyInstalled.map(summarizeRunnerState),
      manual_only_detected: manualOnlyDetected.map(summarizeRunnerState),
      installation_results: []
    };
  }

  const promptResult = await promptRunnerSelection({
    runners: actionableDetected,
    defaultSelectedRunnerIds: actionableDetected.map((runner) => runner.id),
    alreadyInstalled,
    manualOnlyDetected
  });

  if (promptResult.status !== "confirmed" || !promptResult.selected_runner_ids.length) {
    return {
      status: promptResult.status,
      selected_runners: promptResult.selected_runner_ids,
      detected_installable: installableDetected.map(summarizeRunnerState),
      installed_runners: alreadyInstalled.map(summarizeRunnerState),
      manual_only_detected: manualOnlyDetected.map(summarizeRunnerState),
      installation_results: []
    };
  }

  return installRunnerSurfaces({
    repoRoot,
    requestedRunners: promptResult.selected_runner_ids,
    includeExperimental,
    selectAll: false,
    write,
    detection
  });
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
    cli_fallback_command: `review-hub reviewer ${shellQuote(requestRoot)} --model ${shellQuote(model)}`,
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
      cli_fallback_command: `review-hub reviewer ${shellQuote(request.request_root)} --model ${shellQuote(modelName)}`
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
    worker_plans: readWorkerPlans(request.request_root),
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
    `2. \`cd ${shellQuote(request.root)}\``,
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
    `## Toolful worker plans`
  ];

  if (!launch.worker_plans.length) {
    lines.push(`- no worker plan exists yet; run \`review-hub worker-plan --request ${shellQuote(request.request_root)} --model <MODEL_NAME>\` after model selection.`);
  } else {
    for (const plan of launch.worker_plans) {
      lines.push(`- ${plan.runner}: \`${plan.plan_doc_path || plan.plan_path}\``);
    }
  }

  lines.push(
    ``,
    `## Ordered slots`
  );

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

function buildWorkerPlan({ request, requestRoot, runner, agent, parallel, slots }) {
  const runnerId = slugify(runner || "opencode");
  const runnerRoot = path.join(requestRoot, "runner");
  const planPath = path.join(runnerRoot, `${runnerId}-worker-plan.json`);
  const planDocPath = path.join(runnerRoot, `${runnerId}-worker-plan.md`);
  const workerPrompt = buildToolfulWorkerPrompt(requestRoot);
  const workers = slots.map((slot, index) => ({
    order: slot.slot_index || index + 1,
    model_name: slot.model_name,
    model_slug: slot.model_slug,
    slot_root: slot.slot_root,
    prompt_path: slot.prompt_path,
    manifest_path: slot.manifest_path,
    env: {
      REVIEW_HUB_MODEL: slot.model_name,
      MULTI_REVIEW_REVIEWER: slot.model_name,
      REVIEW_HUB_REQUEST_ROOT: requestRoot
    },
    slot_command: [
      `REVIEW_HUB_MODEL=${shellQuote(slot.model_name)}`,
      `MULTI_REVIEW_REVIEWER=${shellQuote(slot.model_name)}`,
      `review-hub reviewer ${shellQuote(requestRoot)}`
    ].join(" "),
    opencode_run_command_without_model_binding: [
      `REVIEW_HUB_MODEL=${shellQuote(slot.model_name)}`,
      `MULTI_REVIEW_REVIEWER=${shellQuote(slot.model_name)}`,
      "opencode run",
      "--pure",
      agent ? `--agent ${shellQuote(agent)}` : "",
      shellQuote(workerPrompt)
    ].filter(Boolean).join(" ")
  }));

  return {
    schema: "review_hub.worker_plan.v1",
    generated_at: nowIso(),
    runner,
    runner_id: runnerId,
    request_id: request.request_id,
    request_root: requestRoot,
    root: request.root,
    phase: request.phase,
    read_policy: request.read_policy,
    adapter: request.adapter,
    focus: request.focus,
    plan_path: planPath,
    plan_doc_path: planDocPath,
    host_role: "interactive model-selection and worker-launch host only; dispatcher context is read from request_root",
    worker_entry_contract: {
      same_command_for_all_workers: `/review-hub ${requestRoot}`,
      cli_entry: `review-hub reviewer ${shellQuote(requestRoot)}`,
      model_identity_env_order: ["REVIEW_HUB_MODEL", "MULTI_REVIEW_REVIEWER", "MMS_MODEL_NAME", "MMS_SESSION_PACKET_JSON"],
      required_worker_behavior: [
        "resolve model identity from env",
        "hydrate or reuse the matching review-hub slot",
        "read prompt_path from the slot",
        "run environment preflight before deep work",
        "write only inside the assigned slot_root"
      ]
    },
    runner_notes: {
      opencode: "MMS should bind the actual OpenCode model route per worker before running opencode; this plan intentionally does not guess provider route refs.",
      mcp_and_skills: "Toolful workers can use MCP/skills only when the runner session-local config exposes those capabilities."
    },
    parallel: parallel || Math.min(4, workers.length),
    worker_prompt: workerPrompt,
    workers
  };
}

function buildToolfulWorkerPrompt(requestRoot) {
  return [
    `Review Hub worker mode for ${requestRoot}.`,
    `Run review-hub reviewer ${shellQuote(requestRoot)} with the current REVIEW_HUB_MODEL/MMS model env, read the returned prompt_path and manifest_path, then execute that prompt exactly.`,
    `Run environment preflight first; if blocked, write the blocked preflight artifact and stop.`,
    `Write only inside the assigned slot_root.`
  ].join(" ");
}

function writeWorkerPlanArtifacts({ requestRoot, plan }) {
  ensureDir(path.join(requestRoot, "runner"));
  writeJson(plan.plan_path, plan);
  writeText(plan.plan_doc_path, buildWorkerPlanDoc(plan));
}

function buildWorkerPlanDoc(plan) {
  const lines = [
    `# Review Hub Worker Plan`,
    ``,
    `- runner: \`${plan.runner}\``,
    `- request_root: \`${plan.request_root}\``,
    `- worker_count: ${plan.workers.length}`,
    `- parallel: ${plan.parallel}`,
    `- host_role: ${plan.host_role}`,
    ``,
    `## Shared worker prompt`,
    ``,
    "```text",
    plan.worker_prompt,
    "```",
    ``,
    `## Worker contract`,
    `- same command: \`${plan.worker_entry_contract.same_command_for_all_workers}\``,
    `- CLI entry: \`${plan.worker_entry_contract.cli_entry}\``,
    `- model identity env order: ${plan.worker_entry_contract.model_identity_env_order.map((item) => `\`${item}\``).join(", ")}`,
    ``,
    `## Workers`
  ];

  for (const worker of plan.workers) {
    lines.push(``);
    lines.push(`### ${String(worker.order).padStart(2, "0")} - ${worker.model_name}`);
    lines.push(`- slot_root: \`${worker.slot_root}\``);
    lines.push(`- prompt_path: \`${worker.prompt_path}\``);
    lines.push(`- slot_command:`);
    lines.push("");
    lines.push("```bash");
    lines.push(worker.slot_command);
    lines.push("```");
    if (plan.runner_id === "opencode") {
      lines.push(`- opencode worker command without MMS model binding:`);
      lines.push("");
      lines.push("```bash");
      lines.push(worker.opencode_run_command_without_model_binding);
      lines.push("```");
    }
  }

  lines.push("");
  return lines.join("\n");
}

function readWorkerPlans(requestRoot) {
  const runnerRoot = path.join(requestRoot, "runner");
  if (!fs.existsSync(runnerRoot)) {
    return [];
  }
  const plans = [];
  for (const entry of fs.readdirSync(runnerRoot)) {
    if (!entry.endsWith("-worker-plan.json")) {
      continue;
    }
    const planPath = path.join(runnerRoot, entry);
    const plan = safeReadJson(planPath);
    if (!plan || plan.schema !== "review_hub.worker_plan.v1") {
      continue;
    }
    plans.push({
      runner: plan.runner || plan.runner_id || entry.replace(/-worker-plan\.json$/, ""),
      runner_id: plan.runner_id || slugify(plan.runner || ""),
      plan_path: planPath,
      plan_doc_path: plan.plan_doc_path || planPath.replace(/\.json$/, ".md"),
      worker_count: Array.isArray(plan.workers) ? plan.workers.length : 0,
      parallel: plan.parallel || 0
    });
  }
  return plans.sort((left, right) => String(left.runner_id).localeCompare(String(right.runner_id)));
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

function detectRunnerCatalog({ repoRoot, includeExperimental }) {
  const runners = RUNNER_CATALOG
    .filter((runner) => includeExperimental || !runner.experimental || runner.manual_only)
    .map((runner) => inspectRunnerState(runner, repoRoot));
  return {
    installable: runners.filter((runner) => !runner.manual_only),
    manual_only: runners.filter((runner) => runner.manual_only)
  };
}

function inspectRunnerState(runner, repoRoot) {
  const surfaces = (runner.surfaces || []).map((surface) => ({
    ...surface,
    root_path: expandHome(surface.root),
    command_dir_path: expandHome(surface.command_dir || ""),
    skill_dir_path: expandHome(surface.skill_dir || ""),
    root_exists: Boolean(surface.root && fs.existsSync(expandHome(surface.root)))
  }));
  const matchedCommands = ensureList(runner.detect_commands).filter(commandExistsOnPath);
  const detected = matchedCommands.length > 0 || surfaces.some((surface) => surface.root_exists);
  const targetSurfaces = resolveRunnerTargetSurfaces({ ...runner, surfaces }, detected);
  const previewResults = previewRunnerLinks({
    repoRoot,
    runner: { ...runner, surfaces: targetSurfaces }
  });
  return {
    ...runner,
    surfaces,
    detected,
    matched_commands: matchedCommands,
    target_surfaces: targetSurfaces,
    preview_results: previewResults,
    install_state: runner.manual_only ? "manual_only" : summarizeRunnerInstallState(previewResults),
    detection_labels: buildRunnerDetectionLabels({ surfaces, matchedCommands }),
    target_labels: targetSurfaces.map((surface) => surface.root)
  };
}

function resolveRunnerTargetSurfaces(runner, detected) {
  const surfaces = Array.isArray(runner.surfaces) ? runner.surfaces : [];
  const detectedSurfaces = surfaces.filter((surface) => surface.root_exists);
  if (detectedSurfaces.length) {
    return detectedSurfaces;
  }
  if (!surfaces.length || runner.manual_only) {
    return [];
  }
  if (!detected) {
    return [];
  }
  const preferred = surfaces.find((surface) => surface.preferred);
  return [preferred || surfaces[0]];
}

function previewRunnerLinks({ repoRoot, runner }) {
  if (runner.manual_only) {
    return [];
  }
  const commandSource = path.join(repoRoot, "commands", "review-hub.md");
  const promptSource = path.join(repoRoot, "prompts", "review-hub.md");
  const skillSource = repoRoot;
  const results = [];
  for (const surface of runner.surfaces || []) {
    if (surface.command_dir) {
      results.push({
        runner_id: runner.id,
        runner_label: runner.label,
        surface_root: surface.root,
        surface_type: "command",
        ...linkPath(commandSource, path.join(surface.command_dir, "review-hub.md"), false)
      });
    }
    if (surface.prompt_dir) {
      results.push({
        runner_id: runner.id,
        runner_label: runner.label,
        surface_root: surface.root,
        surface_type: "prompt",
        ...linkPath(promptSource, path.join(surface.prompt_dir, "review-hub.md"), false)
      });
    }
    if (surface.skill_dir) {
      results.push({
        runner_id: runner.id,
        runner_label: runner.label,
        surface_root: surface.root,
        surface_type: "skill",
        ...linkPath(skillSource, path.join(surface.skill_dir, "review-hub"), false)
      });
    }
  }
  return results;
}

function summarizeRunnerInstallState(results) {
  if (!results.length) {
    return "undetected";
  }
  const statuses = results.map((item) => item.status);
  if (statuses.every((status) => status === "already_linked")) {
    return "already_installed";
  }
  if (statuses.some((status) => status === "skipped_existing_unmanaged" || status === "skipped_stat_error")) {
    return "needs_attention";
  }
  return "needs_install";
}

function buildRunnerDetectionLabels({ surfaces, matchedCommands }) {
  const labels = [];
  for (const surface of surfaces) {
    if (surface.root_exists) {
      labels.push(`path:${surface.root}`);
    }
  }
  for (const command of matchedCommands) {
    labels.push(`command:${command}`);
  }
  return labels;
}

function summarizeRunnerState(runner) {
  return {
    id: runner.id,
    label: runner.label,
    detected: runner.detected,
    experimental: Boolean(runner.experimental),
    manual_only: Boolean(runner.manual_only),
    detection: runner.detection_labels || [],
    targets: runner.target_labels || [],
    install_state: runner.install_state,
    manual_hint: runner.manual_hint || ""
  };
}

function installRunnerSurfaces({
  repoRoot,
  requestedRunners,
  includeExperimental,
  selectAll,
  write,
  detection
}) {
  const catalog = detection || detectRunnerCatalog({ repoRoot, includeExperimental });
  const requested = new Set((requestedRunners || []).map((item) => slugify(item)));
  const installable = catalog.installable;
  const manualOnlyDetected = catalog.manual_only.filter((runner) => runner.detected);

  const selectedRunners = installable.filter((runner) => {
    if (selectAll) {
      return !runner.experimental || includeExperimental;
    }
    if (requested.size) {
      return requested.has(runner.id);
    }
    return runner.detected;
  });

  const unknownRequested = [...requested].filter((id) => !RUNNER_CATALOG.some((runner) => runner.id === id));
  if (unknownRequested.length) {
    throw new Error(`unknown runner ids: ${unknownRequested.join(", ")}`);
  }

  const manualOnlyRequested = catalog.manual_only.filter((runner) => requested.has(runner.id));
  const results = [];
  const promptSource = path.join(repoRoot, "prompts", "review-hub.md");
  for (const runner of selectedRunners) {
    const installSurfaces = runner.target_surfaces.length
      ? runner.target_surfaces
      : resolveBootstrapInstallSurfaces(runner);
    for (const surface of installSurfaces) {
      if (surface.command_dir) {
        results.push({
          runner_id: runner.id,
          runner_label: runner.label,
          surface_root: surface.root,
          surface_type: "command",
          ...linkPath(path.join(repoRoot, "commands", "review-hub.md"), path.join(surface.command_dir, "review-hub.md"), write)
        });
      }
      if (surface.prompt_dir) {
        results.push({
          runner_id: runner.id,
          runner_label: runner.label,
          surface_root: surface.root,
          surface_type: "prompt",
          ...linkPath(promptSource, path.join(surface.prompt_dir, "review-hub.md"), write)
        });
      }
      if (surface.skill_dir) {
        results.push({
          runner_id: runner.id,
          runner_label: runner.label,
          surface_root: surface.root,
          surface_type: "skill",
          ...linkPath(repoRoot, path.join(surface.skill_dir, "review-hub"), write)
        });
      }
    }
  }

  return {
    status: write ? "installed" : "preview",
    selected_runners: selectedRunners.map((runner) => runner.id),
    selected_runner_labels: selectedRunners.map((runner) => runner.label),
    detected_installable: installable.filter((runner) => runner.detected).map(summarizeRunnerState),
    manual_only_detected: manualOnlyDetected.map(summarizeRunnerState),
    manual_only_requested: manualOnlyRequested.map(summarizeRunnerState),
    installation_results: results
  };
}

function resolveBootstrapInstallSurfaces(runner) {
  if (runner.manual_only) {
    return [];
  }
  const surfaces = Array.isArray(runner.surfaces) ? runner.surfaces : [];
  if (!surfaces.length) {
    return [];
  }
  const preferred = surfaces.find((surface) => surface.preferred);
  return [preferred || surfaces[0]];
}

async function promptRunnerSelection({ runners, defaultSelectedRunnerIds, alreadyInstalled, manualOnlyDetected }) {
  if (!isInteractiveTerminal()) {
    return {
      status: "no_tty",
      selected_runner_ids: defaultSelectedRunnerIds
    };
  }

  const selected = new Set(defaultSelectedRunnerIds);
  let cursor = 0;
  const stdin = process.stdin;
  const stderr = process.stderr;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stderr.write("\x1b[?25h");
    };

    const finish = (status) => {
      cleanup();
      stderr.write("\n");
      resolve({
        status,
        selected_runner_ids: [...selected]
      });
    };

    const render = () => {
      stderr.write("\x1b[2J\x1b[H\x1b[?25l");
      stderr.write("Review Hub init\n");
      stderr.write("Space 选择要安装的 runner；Enter 确认；j/k 或 ↑/↓ 移动；a 全选；i 反选；q 跳过。\n\n");
      if (alreadyInstalled.length) {
        stderr.write(`已安装：${alreadyInstalled.map((runner) => runner.label).join("、")}\n\n`);
      }
      stderr.write("待安装 / 需处理：\n");
      runners.forEach((runner, index) => {
        const focused = index === cursor ? ">" : " ";
        const checked = selected.has(runner.id) ? "[x]" : "[ ]";
        const experimental = runner.experimental ? " experimental" : "";
        stderr.write(`${focused} ${checked} ${runner.label}${experimental}  ${formatInstallStateLabel(runner.install_state)}\n`);
        stderr.write(`      -> ${formatRunnerTargetLabel(runner.target_labels)}\n`);
      });
      if (manualOnlyDetected.length) {
        stderr.write("\nManual-only detected runners:\n");
        for (const runner of manualOnlyDetected) {
          stderr.write(`- ${runner.label}: ${runner.manual_hint}\n`);
        }
      }
    };

    const onData = (chunk) => {
      const key = String(chunk);
      if (key === "\u0003") {
        cleanup();
        reject(new Error("init cancelled"));
        return;
      }
      if (key === "\r" || key === "\n") {
        finish("confirmed");
        return;
      }
      if (key === "q" || key === "Q") {
        selected.clear();
        finish("skipped");
        return;
      }
      if (key === " " && runners[cursor]) {
        const id = runners[cursor].id;
        if (selected.has(id)) {
          selected.delete(id);
        } else {
          selected.add(id);
        }
        render();
        return;
      }
      if ((key === "\u001b[A" || key === "k" || key === "K") && runners.length) {
        cursor = (cursor - 1 + runners.length) % runners.length;
        render();
        return;
      }
      if ((key === "\u001b[B" || key === "j" || key === "J") && runners.length) {
        cursor = (cursor + 1) % runners.length;
        render();
        return;
      }
      if (key === "a" || key === "A") {
        for (const runner of runners) {
          selected.add(runner.id);
        }
        render();
        return;
      }
      if (key === "i" || key === "I") {
        for (const runner of runners) {
          if (selected.has(runner.id)) {
            selected.delete(runner.id);
          } else {
            selected.add(runner.id);
          }
        }
        render();
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    render();
  });
}

function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

function wantsHumanOutput(args) {
  return isInteractiveTerminal() && !Boolean(args.json);
}

function printBootstrapSummary({ result, write }) {
  const lines = [];
  const title = bootstrapSummaryTitle(result.status, write);
  if (title) {
    lines.push(title);
  }

  const installedLabels = uniqueRunnerLabels(result.installed_runners);
  if (installedLabels.length) {
    lines.push(`- 已安装: ${installedLabels.join("、")}`);
  }

  const groupedResults = groupInstallationResults(result.installation_results || []);
  const newlyInstalled = groupedResults.filter((item) => item.outcome === "installed");
  const previewInstall = groupedResults.filter((item) => item.outcome === "preview");
  const needsAttention = groupedResults.filter((item) => item.outcome === "needs_attention");
  const alreadyLinked = groupedResults.filter((item) => item.outcome === "already_linked");

  if (newlyInstalled.length) {
    lines.push(`- 已处理: ${newlyInstalled.map(formatGroupedRunnerResult).join("；")}`);
  }
  if (previewInstall.length) {
    lines.push(`- 将处理: ${previewInstall.map(formatGroupedRunnerResult).join("；")}`);
  }
  if (needsAttention.length) {
    lines.push(`- 需手动处理: ${needsAttention.map(formatGroupedRunnerResult).join("；")}`);
  }
  if (alreadyLinked.length && result.status !== "already_installed") {
    lines.push(`- 已存在: ${alreadyLinked.map(formatGroupedRunnerResult).join("；")}`);
  }

  const manualOnly = summarizeManualOnly(result);
  if (manualOnly) {
    lines.push(`- Manual-only: ${manualOnly}`);
  }

  if (result.status === "no_detected_installable_runners" && !installedLabels.length && !groupedResults.length) {
    lines.push("- 未发现 Claude / Codex / OpenCode / Agents 的可自动安装面");
  }
  if (result.status === "skipped") {
    lines.push("- 未做任何改动");
  }

  printLines(lines);
}

function printLocalRootSummary({ root, reviewRoot, write }) {
  printLines([
    write ? "Review Hub 本地根目录已初始化" : "Review Hub 本地根目录预览",
    `- root: ${root}`,
    `- review_root: ${reviewRoot}`
  ]);
}

function printBulkInstallSummary({ results, write }) {
  const grouped = groupInstallationResults(results);
  const counts = summarizeLinkStatuses(results);
  const lines = [
    write ? "Review Hub 安装完成" : "Review Hub 安装预览"
  ];

  if (grouped.length) {
    lines.push(`- 覆盖 runner: ${grouped.map(formatGroupedRunnerResult).join("；")}`);
  }
  if (counts.installed) {
    lines.push(`- 已安装项: ${counts.installed}`);
  }
  if (counts.preview) {
    lines.push(`- 预览项: ${counts.preview}`);
  }
  if (counts.attention) {
    lines.push(`- 需手动处理项: ${counts.attention}`);
  }
  if (!grouped.length) {
    lines.push("- 没有可处理的安装目标");
  }

  printLines(lines);
}

function formatRunnerMetaList(items) {
  return items && items.length ? items.join(", ") : "-";
}

function formatRunnerTargetLabel(items) {
  return items && items.length ? items.join(", ") : "no target surface";
}

function formatInstallStateLabel(state) {
  if (state === "already_installed") {
    return "已安装";
  }
  if (state === "needs_attention") {
    return "需处理";
  }
  return "待安装";
}

function isActionableInstallState(state) {
  return state === "needs_install" || state === "needs_attention";
}

function bootstrapSummaryTitle(status, write) {
  if (status === "already_installed") {
    return "Review Hub 已就绪";
  }
  if (status === "installed") {
    return write ? "Review Hub 安装完成" : "Review Hub 安装预览";
  }
  if (status === "preview") {
    return "Review Hub 安装预览";
  }
  if (status === "skipped") {
    return "已跳过安装";
  }
  if (status === "no_detected_installable_runners") {
    return "未检测到可自动安装的 runner";
  }
  if (status === "no_tty") {
    return "当前不是交互终端";
  }
  return "Review Hub";
}

function groupInstallationResults(results) {
  const grouped = new Map();
  for (const item of results || []) {
    const runnerId = item.runner_id || "unknown";
    const root = item.surface_root || path.dirname(item.destination || "");
    const key = `${runnerId}::${root}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        runner_id: runnerId,
        runner_label: item.runner_label || runnerId,
        surface_root: root,
        statuses: new Set()
      });
    }
    grouped.get(key).statuses.add(item.status || "preview");
  }

  return [...grouped.values()].map((item) => ({
    ...item,
    statuses: [...item.statuses],
    outcome: summarizeGroupedInstallOutcome([...item.statuses])
  }));
}

function summarizeGroupedInstallOutcome(statuses) {
  if (statuses.some((status) => status === "skipped_existing_unmanaged" || status === "skipped_stat_error")) {
    return "needs_attention";
  }
  if (statuses.some((status) => status === "created_symlink" || status === "replaced_symlink")) {
    return "installed";
  }
  if (statuses.some((status) => status === "would_replace_symlink" || status === "preview")) {
    return "preview";
  }
  if (statuses.every((status) => status === "already_linked")) {
    return "already_linked";
  }
  return "preview";
}

function summarizeLinkStatuses(results) {
  const counts = {
    installed: 0,
    preview: 0,
    attention: 0
  };

  for (const item of groupInstallationResults(results)) {
    if (item.outcome === "installed" || item.outcome === "already_linked") {
      counts.installed += 1;
      continue;
    }
    if (item.outcome === "needs_attention") {
      counts.attention += 1;
      continue;
    }
    counts.preview += 1;
  }

  return counts;
}

function uniqueRunnerLabels(items) {
  return [...new Set((items || []).map((item) => item.label).filter(Boolean))];
}

function formatGroupedRunnerResult(item) {
  const suffix = installOutcomeLabel(item.outcome);
  return `${item.runner_label} -> ${item.surface_root}${suffix ? ` (${suffix})` : ""}`;
}

function installOutcomeLabel(outcome) {
  if (outcome === "installed") {
    return "已安装";
  }
  if (outcome === "already_linked") {
    return "已存在";
  }
  if (outcome === "needs_attention") {
    return "需处理";
  }
  if (outcome === "preview") {
    return "预览";
  }
  return "";
}

function summarizeManualOnly(result) {
  const manualOnly = [...(result.manual_only_detected || []), ...(result.manual_only_requested || [])];
  if (!manualOnly.length) {
    return "";
  }
  const deduped = new Map();
  for (const item of manualOnly) {
    if (!deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  }
  return [...deduped.values()]
    .map((item) => `${item.label} -> ${item.manual_hint}`)
    .join("；");
}

function printLines(lines) {
  process.stdout.write(`${lines.filter(Boolean).join("\n")}\n`);
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

function shouldWrite(args) {
  const dryRun = Boolean(args["dry-run"] || args.dryrun);
  if (dryRun && args.write) {
    throw new Error("do not pass both --write and --dry-run");
  }
  return !dryRun;
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

function parsePositiveInt(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function commandExistsOnPath(command) {
  const name = String(command || "").trim();
  if (!name) {
    return false;
  }
  const envPath = process.env.PATH || "";
  for (const segment of envPath.split(path.delimiter)) {
    if (!segment) {
      continue;
    }
    const candidate = path.join(segment, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      // keep scanning
    }
  }
  return false;
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
