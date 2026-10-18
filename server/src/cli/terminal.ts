import * as p from "@clack/prompts";
import figures from "figures";
import { resolve } from "node:path";
import pc from "picocolors";
import { AgentLoop } from "../agent/loop";
import { MultiAgentOrchestrator } from "../agent/orchestrator";
import { getPlatformInfo } from "../tools/workspace";
import { createAgentReporter } from "./reporter";
import {
  renderAgentHeader,
  renderSidebarDashboard,
  renderFooter,
  renderTaskCompleteCard,
  type SubTaskItem,
} from "./tui";

export async function startTerminalUI() {
  const rootWorkspace = resolve(process.cwd(), "..");
  const orchestrator = new MultiAgentOrchestrator(rootWorkspace);
  const mother = orchestrator.getMotherProvider();
  const queue = orchestrator.getTaskQueue();
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
    spinner.start("Mother AI is analyzing task & planning execution strategy...");

    const classification = await orchestrator.aiClassifyTask(goalText);
    const { mode, reason, source, tasks = [] } = classification;

    spinner.stop("Execution Strategy Decided");

    const isParallel = mode === "multi" && tasks.length >= 2;

    const modeBadge = isParallel
      ? pc.bgMagenta(pc.black(" PARALLEL MULTI-AGENT SWARM ")) +
        pc.magenta(` Spawning ${tasks.length} Sub-Agents at once`)
      : mode === "multi"
      ? pc.bgMagenta(pc.black(" MULTI-AGENT PIPELINE ")) +
        pc.magenta(" Mother Architect ➜ Sub-Agents ➜ Supervisors")
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

    // Update Mother objective in orchestrator
    orchestrator.setMotherObjective(
      goalText,
      isParallel
        ? `Deploying parallel worker swarm (${tasks.length} sub-tasks)`
        : mode === "multi"
        ? `Executing multi-step pipeline`
        : `Executing direct solo task`
    );

    // ── Render Live Sidebar Dashboard with real system state ──────────────
    renderSidebarDashboard(orchestrator.getDashboardState());

    // ── Execute (Parallel if multi-task, or standard pipeline / solo) ──────
    const startTime = performance.now();

    try {
      if (isParallel) {
        const parallelMissions = tasks.map((t, idx) => ({
          role: `Worker ${idx + 1}`,
          mission: `OVERALL MISSION: "${goalText}"\n\nYOUR SPECIFIC SUB-TASK:\n${t}\n\nInspect the workspace files or execute tools directly on disk.`,
        }));

        await orchestrator.executeParallelTasks(parallelMissions);
      } else if (mode === "multi") {
        const result = await orchestrator.executeTask(goalText);
        if (result.finalAnswer) {
          renderTaskCompleteCard("Mission Accomplished (Mother Final Verdict)", result.finalAnswer);
        }
      } else {
        // SOLO MODE: Run directly on the already-connected Mother browser tab!
        // No new tab opened, zero RAM overhead, instant response.
        const soloLoop = new AgentLoop(
          orchestrator.getMotherProvider(),
          orchestrator.getWorkspace().getBaseDir(),
          6
        );
        const soloOutput = await soloLoop.runTask(
          goalText,
          createAgentReporter("solo", { showTurn: true, showSummary: true }),
        );

        // Verification by Fallback/Supervisors for consistency
        const dualSup = orchestrator.getDualSupervisor();
        const supReport = await dualSup.reviewWorkerTask(goalText, "Solo Task", soloOutput, 5000);
        if (!supReport.allPassed && supReport.alertForMother) {
          p.log.warn(pc.yellow(`Supervisor Note: ${supReport.alertForMother}`));
        }
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

    // ── Render live footer with updated system counts ─────────────────────
    const stats = queue.getStats();
    renderFooter({
      activeAIs: orchestrator.getDashboardState().activeAIs,
      availableAIs: 4,
      runningTasks: stats.running,
      queuedTasks: stats.pending,
      completedTasks: stats.completed,
      failedTasks: stats.failed,
      overallHealth: stats.failed > 0 ? "degraded" : "healthy",
      activeIssuesCount: stats.failed,
    });

    console.log();
  }
}
