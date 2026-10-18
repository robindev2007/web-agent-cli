import * as p from "@clack/prompts";
import figures from "figures";
import { resolve } from "node:path";
import pc from "picocolors";
import { AgentLoop } from "../agent/loop";
import { MultiAgentOrchestrator } from "../agent/orchestrator";
import { getPlatformInfo } from "../tools/workspace";
import { createAgentReporter } from "./reporter";
import { renderAgentHeader, renderTaskBoard, type SubTaskItem } from "./tui";

export async function startTerminalUI() {
  const rootWorkspace = resolve(process.cwd(), "..");
  const orchestrator = new MultiAgentOrchestrator(rootWorkspace);
  const mother = orchestrator.getMotherProvider();
  const { platform, shell } = getPlatformInfo();

  console.clear();

  // Render OpenCode-style header
  renderAgentHeader({
    title: "GEMINI AGENT SYSTEM",
    version: "2.1.0",
    platform: platform.toUpperCase(),
    shell,
    workspace: rootWorkspace,
    statusText: mother.isReady() ? "Ready" : "Waiting for Chrome tab...",
    isConnected: mother.isReady(),
  });

  while (true) {
    // ── Input card prompt (Clean & always at the bottom of the previous card) ──
    const goal = await p.text({
      message: pc.bold(
        pc.white(`${figures.pointer} What would you like to build or solve?`),
      ),
      placeholder: "e.g., Build a fast REST API with auth and write unit tests",
      validate(val) {
        if (!val.trim()) return "Task prompt cannot be empty.";
        if (val.trim().length < 1) return "Task description is too short.";
      },
    });

    if (p.isCancel(goal)) {
      console.log();
      p.outro(pc.dim("Exiting Gemini Agent. Have a productive day!"));
      process.exit(0);
    }

    const goalText = (goal as string).trim();

    // ── AI decides the best execution mode ─────────────────────────────────
    const spinner = p.spinner();
    spinner.start("Analyzing task & planning execution strategy...");

    const classification = await orchestrator.aiClassifyTask(goalText);
    const { mode, reason, source, tasks = [] } = classification;

    spinner.stop("Execution Strategy Decided");

    // Can we run multiple sub-agents simultaneously?
    const isParallel = mode === "multi" && tasks.length >= 2;

    const modeBadge = isParallel
      ? pc.bgMagenta(pc.black(" PARALLEL MULTI-AGENT SWARM ")) +
        pc.magenta(` Spawning ${tasks.length} Sub-Agents at once`)
      : mode === "multi"
      ? pc.bgMagenta(pc.black(" MULTI-AGENT PIPELINE ")) +
        pc.magenta(" Mother Architect ➜ Sub-Agents ➜ Reviewer")
      : pc.bgCyan(pc.black(" SOLO AGENT ")) +
        pc.cyan(" Direct Rapid Execution (No overhead)");

    const decisionSource =
      source === "ai"
        ? pc.green(`${figures.tick} Decided by Gemini AI`)
        : pc.dim("⚡ Fast Local Analysis");

    console.log();
    console.log(`  ${figures.bullet} Mode:   ${modeBadge}`);
    console.log(`  ${figures.bullet} Reason: ${pc.white(reason)}`);
    console.log(`  ${figures.bullet} Engine: ${decisionSource}`);
    console.log();

    // ── Render Task Board if tasks exist (Only when task list is needed) ────
    let subTaskItems: SubTaskItem[] = [];
    if (tasks.length > 0) {
      subTaskItems = tasks.map((t, idx) => ({
        id: `task_${idx + 1}`,
        title: t,
        status: "pending",
        agentId: isParallel ? `sub_${idx + 1}` : undefined,
      }));
      renderTaskBoard(subTaskItems);
    }

    // ── Execute (Parallel if multi-task, or standard pipeline / solo) ──────
    const startTime = performance.now();

    try {
      if (isParallel) {
        // Run parallel tasks across dedicated browser tabs at the exact same time
        const parallelMissions = tasks.map((t, idx) => ({
          role: `Coder ${idx + 1}`,
          mission: t,
        }));

        // Update task board items to running
        subTaskItems.forEach((item) => (item.status = "running"));

        await orchestrator.executeParallelTasks(parallelMissions);

        // Update task board items to completed
        subTaskItems.forEach((item) => (item.status = "completed"));
        renderTaskBoard(subTaskItems);
      } else if (mode === "multi") {
        await orchestrator.executeTask(goalText);
      } else {
        // SOLO MODE: Run directly on the already-connected Mother browser tab!
        // No new tab opened, zero RAM overhead, instant response.
        const soloLoop = new AgentLoop(
          orchestrator.getMotherProvider(),
          orchestrator.getWorkspace().getBaseDir(),
          6
        );
        await soloLoop.runTask(
          goalText,
          createAgentReporter("solo", { showTurn: true, showSummary: true }),
        );
      }

      const elapsedSec = ((performance.now() - startTime) / 1000).toFixed(1);
      p.log.message(
        pc.dim(`  ${figures.clock || "⏱"} Total elapsed time: ${elapsedSec}s`),
      );
    } catch (err: any) {
      p.log.error(
        pc.red(`Agent Execution Failed: ${err.message || String(err)}`),
      );
    }

    console.log();

    // Seamless continuous loop: Never ask 'Ready for next coding task?'
    // The previous history remains in the terminal, and the next input appears immediately at the bottom.
  }
}
