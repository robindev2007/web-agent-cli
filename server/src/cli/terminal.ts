import * as p from "@clack/prompts";
import figures from "figures";
import { resolve } from "node:path";
import pc from "picocolors";
import { MultiAgentOrchestrator } from "../agent/orchestrator";
import { getPlatformInfo } from "../tools/workspace";
import { createAgentReporter } from "./reporter";
import { renderAgentHeader } from "./tui";

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
    // ── Input card prompt ──────────────────────────────────────────────────
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
    spinner.start("Analyzing task to select optimal agent architecture...");

    const classification = await orchestrator.aiClassifyTask(goalText);
    const { mode, reason, source } = classification;

    spinner.stop("Architecture Selected");

    const modeBadge =
      mode === "multi"
        ? pc.bgMagenta(pc.black(" MULTI-AGENT SWARM ")) +
          pc.magenta(" Mother Architect ➜ Sub-Agents ➜ Reviewer")
        : pc.bgCyan(pc.black(" SOLO AGENT ")) +
          pc.cyan(" Direct Rapid Execution");

    const decisionSource =
      source === "ai"
        ? pc.green(`${figures.tick} Decided by Gemini AI`)
        : pc.dim("⚡ Fast Local Analysis");

    console.log();
    console.log(`  ${figures.bullet} Mode:   ${modeBadge}`);
    console.log(`  ${figures.bullet} Reason: ${pc.white(reason)}`);
    console.log(`  ${figures.bullet} Engine: ${decisionSource}`);
    console.log();

    // ── Execute ────────────────────────────────────────────────────────────
    const startTime = performance.now();

    try {
      if (mode === "multi") {
        await orchestrator.executeTask(goalText);
      } else {
        const sub = orchestrator.createSubAgent("Solo Coder");
        await sub.loop.runTask(
          goalText,
          createAgentReporter(sub.id, { showTurn: true, showSummary: true }),
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

    // ── Loop prompt ────────────────────────────────────────────────────────
    const again = await p.confirm({
      message: pc.bold("Ready for next coding task?"),
      initialValue: true,
    });

    if (p.isCancel(again) || !again) {
      p.outro(pc.dim("Session ended. All work saved to workspace."));
      process.exit(0);
    }

    console.clear();
    renderAgentHeader({
      title: "GEMINI AGENT SYSTEM",
      version: "2.1.0",
      platform: platform.toUpperCase(),
      shell,
      workspace: rootWorkspace,
      statusText: "Ready",
      isConnected: mother.isReady(),
    });
  }
}
