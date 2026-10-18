import pc from "picocolors";
import figures from "figures";
import stringWidth from "string-width";
import type { QueuedTask } from "../agent/queue";

export interface SubTaskItem {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  agentId?: string;
  detail?: string;
}

export interface HeaderProps {
  title: string;
  version?: string;
  platform: string;
  shell: string;
  workspace: string;
  statusText: string;
  isConnected: boolean;
}

export interface AiSessionInfo {
  id: string;
  role: string;
  taskTitle: string;
  status: string; // "idle" | "planning" | "executing" | "recovering" | "done"
}

export interface SystemDashboardState {
  motherObjective: string;
  motherDecision: string;
  tasks: Array<{
    id: string;
    title: string;
    status: "pending" | "running" | "completed" | "failed";
    assignedAgentId?: string | null;
    retries?: number;
    error?: string | null;
  }>;
  aiSessions: AiSessionInfo[];
  supervisorHealth: {
    supervisorA: "healthy" | "verifying" | "degraded" | "idle";
    supervisorB: "healthy" | "verifying" | "degraded" | "idle";
    fallbackReady: boolean;
  };
  cleanupStatus: string;
  recoveryLogs: string[];
  activeIssues: string[];
  activeAIs: number;
  availableAIs: number;
}

export interface FooterProps {
  activeAIs: number;
  availableAIs: number;
  runningTasks: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  overallHealth: "healthy" | "recovering" | "degraded";
  activeIssuesCount: number;
}

/**
 * Strip ANSI escape codes to measure true printable character length
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function truncateString(str: string, maxLen: number): string {
  const visible = stringWidth(stripAnsi(str));
  if (visible <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 3)) + "...";
}

/**
 * Render a sleek OpenCode / Claude Code style status header block
 */
export function renderAgentHeader(props: HeaderProps): void {
  const termWidth = Math.min(Math.max(process.stdout.columns || 80, 70), 96);
  const line = "─".repeat(termWidth - 2);

  const statusBadge = props.isConnected
    ? pc.bgGreen(pc.black(` ${figures.circleFilled} ONLINE `))
    : pc.bgYellow(pc.black(` ${figures.circle} WAITING CHROME `));

  const modeBadge = pc.bgCyan(pc.black(" GEMINI MULTI-TAB ENGINE "));

  console.log();
  console.log(pc.magenta(`╭─${line}╮`));
  console.log(
    pc.magenta("│ ") +
      pc.bold(pc.white(`⚡ ${props.title}`)) +
      (props.version ? pc.dim(` v${props.version}`) : "") +
      "  " +
      modeBadge +
      " ".repeat(Math.max(1, termWidth - 40 - (props.version?.length || 0))) +
      statusBadge +
      pc.magenta(" │")
  );
  console.log(pc.magenta(`├─${line}┤`));

  // Metadata row
  const metaLeft = ` ${pc.dim("Workspace:")} ${pc.cyan(props.workspace)}`;
  const metaRight = `${pc.dim("OS:")} ${pc.white(props.platform)} (${pc.dim(props.shell)}) `;
  const visibleLeft = stringWidth(stripAnsi(metaLeft));
  const visibleRight = stringWidth(stripAnsi(metaRight));
  const gap = Math.max(2, termWidth - 4 - visibleLeft - visibleRight);

  console.log(pc.magenta("│") + metaLeft + " ".repeat(gap) + metaRight + pc.magenta("│"));
  console.log(pc.magenta(`╰─${line}╯`));
  console.log();
}

/**
 * Render dynamic Task List board (displayed above running agent logs)
 */
export function renderTaskBoard(tasks: SubTaskItem[]): void {
  if (!tasks || tasks.length === 0) return;

  const termWidth = Math.min(Math.max(process.stdout.columns || 80, 60), 96);
  const line = "─".repeat(termWidth - 4);

  console.log();
  console.log(pc.cyan(`  ┌─ ${pc.bold("TASK LIST")} ${line.slice(12)}┐`));

  for (const t of tasks) {
    let icon = pc.dim(figures.circle);
    let titleStr = pc.dim(t.title);

    if (t.status === "running") {
      icon = pc.yellow(figures.pointer);
      titleStr = pc.bold(pc.yellow(t.title));
    } else if (t.status === "completed") {
      icon = pc.green(figures.tick);
      titleStr = pc.green(t.title);
    } else if (t.status === "failed") {
      icon = pc.red(figures.cross);
      titleStr = pc.red(t.title);
    }

    const agentTag = t.agentId ? pc.magenta(`[${t.agentId}] `) : "";
    const detail = t.detail ? pc.dim(` — ${t.detail}`) : "";
    const leftText = `  │  ${icon} ${agentTag}${titleStr}${detail}`;
    const leftVisible = stringWidth(stripAnsi(leftText));
    const pad = Math.max(1, termWidth - leftVisible - 2);

    console.log(leftText + " ".repeat(pad) + pc.cyan("│"));
  }

  console.log(pc.cyan(`  └${line}┘`));
  console.log();
}

/**
 * Return appropriate figure/icon per tool
 */
export function getToolIcon(tool: string): string {
  switch (tool) {
    case "run_command":
      return figures.play || "$";
    case "write_file":
      return "✎";
    case "read_file":
      return "📖";
    case "list_files":
      return "☷";
    case "copy_file":
      return figures.bullet || "📋";
    case "move_file":
      return "⇄";
    case "delete_file":
      return figures.cross || "✖";
    case "ensure_dir":
      return "📁";
    case "glob":
      return "🔍";
    case "file_exists":
      return figures.questionMarkPrefix || "?";
    default:
      return figures.star || "★";
  }
}

/**
 * Render a simple, compact live sidebar dashboard of system state
 */
export function renderSidebarDashboard(state: SystemDashboardState): void {
  const termWidth = Math.min(Math.max(process.stdout.columns || 80, 70), 96);
  const innerWidth = termWidth - 4;
  const line = "─".repeat(innerWidth);

  console.log();
  console.log(pc.cyan(`┌─ ${pc.bold("SYSTEM DASHBOARD & ACTIVE WORKERS")} ${line.slice(36)}┐`));

  // 1. Mother Objective & Decision
  const objText = `🎯 ${pc.bold("MOTHER OBJECTIVE:")} ${truncateString(state.motherObjective || "Idle / Awaiting goal", innerWidth - 24)}`;
  const decText = `💡 ${pc.bold("LATEST DECISION:")} ${truncateString(state.motherDecision || "None", innerWidth - 22)}`;
  
  const padObj = Math.max(1, innerWidth - stringWidth(stripAnsi(objText)));
  console.log(`│ ${objText}${" ".repeat(padObj)}│`);
  const padDec = Math.max(1, innerWidth - stringWidth(stripAnsi(decText)));
  console.log(`│ ${decText}${" ".repeat(padDec)}│`);

  console.log(pc.cyan(`├${line}┤`));

  // 2. Task Queue Status
  console.log(`│ ${pc.bold("📋 TASK QUEUE:")}${" ".repeat(innerWidth - 14)}│`);
  if (!state.tasks || state.tasks.length === 0) {
    const noTasks = pc.dim("  (No active tasks in queue)");
    console.log(`│ ${noTasks}${" ".repeat(Math.max(1, innerWidth - stringWidth(stripAnsi(noTasks))))}│`);
  } else {
    for (const t of state.tasks.slice(0, 6)) {
      let icon = pc.dim(figures.circle);
      let statusLabel = pc.dim("PENDING");
      if (t.status === "running") {
        icon = pc.yellow(figures.pointer);
        statusLabel = pc.yellow("RUNNING");
      } else if (t.status === "completed") {
        icon = pc.green(figures.tick);
        statusLabel = pc.green("COMPLETED");
      } else if (t.status === "failed") {
        icon = pc.red(figures.cross);
        statusLabel = pc.red("FAILED");
      }
      const retryTag = t.retries && t.retries > 0 ? pc.yellow(` (retry #${t.retries})`) : "";
      const agentTag = t.assignedAgentId ? pc.magenta(`[${t.assignedAgentId}] `) : "";
      const maxTitleLen = Math.max(15, innerWidth - 30);
      const row = `  ${icon} [${t.id}] ${agentTag}${truncateString(t.title, maxTitleLen)} ➜ ${statusLabel}${retryTag}`;
      const padRow = Math.max(1, innerWidth - stringWidth(stripAnsi(row)));
      console.log(`│ ${row}${" ".repeat(padRow)}│`);
    }
  }

  console.log(pc.cyan(`├${line}┤`));

  // 3. Worker AI Sessions
  console.log(`│ ${pc.bold("🤖 AI SESSIONS (Session Isolation Active):")}${" ".repeat(innerWidth - 42)}│`);
  if (!state.aiSessions || state.aiSessions.length === 0) {
    const noAi = pc.dim("  (No workers currently spawned)");
    console.log(`│ ${noAi}${" ".repeat(Math.max(1, innerWidth - stringWidth(stripAnsi(noAi))))}│`);
  } else {
    for (const ai of state.aiSessions) {
      const aiStatus = ai.status === "executing" ? pc.green("Executing") :
        ai.status === "planning" ? pc.cyan("Planning") :
        ai.status === "recovering" ? pc.yellow("Recovering") :
        ai.status === "done" ? pc.dim("Done (cleaning tab)") : pc.dim(ai.status);
      const row = `  • ${pc.bold(pc.magenta(ai.id))} (${pc.dim(ai.role)}): ${aiStatus} ─ ${truncateString(ai.taskTitle, Math.max(10, innerWidth - 45))}`;
      const padRow = Math.max(1, innerWidth - stringWidth(stripAnsi(row)));
      console.log(`│ ${row}${" ".repeat(padRow)}│`);
    }
  }

  console.log(pc.cyan(`├${line}┤`));

  // 4. Dual Supervisors & Recovery
  const supA = state.supervisorHealth.supervisorA === "healthy" ? pc.green("HEALTHY") :
    state.supervisorHealth.supervisorA === "verifying" ? pc.yellow("VERIFYING") : pc.dim(state.supervisorHealth.supervisorA);
  const supB = state.supervisorHealth.supervisorB === "healthy" ? pc.green("HEALTHY") :
    state.supervisorHealth.supervisorB === "verifying" ? pc.yellow("VERIFYING") : pc.dim(state.supervisorHealth.supervisorB);
  const fallbackStr = state.supervisorHealth.fallbackReady ? pc.green("READY") : pc.yellow("STANDBY");

  const supLine = `🛡️  ${pc.bold("SUPERVISORS:")} Sup-A: ${supA} │ Sup-B: ${supB} │ Fallback: ${fallbackStr}`;
  const padSup = Math.max(1, innerWidth - stringWidth(stripAnsi(supLine)));
  console.log(`│ ${supLine}${" ".repeat(padSup)}│`);

  const cleanup = `🧹 ${pc.bold("CLEANUP & RECOVERY:")} ${truncateString(state.cleanupStatus || "Background active (Silent)", innerWidth - 30)}`;
  const padClean = Math.max(1, innerWidth - stringWidth(stripAnsi(cleanup)));
  console.log(`│ ${cleanup}${" ".repeat(padClean)}│`);

  if (state.activeIssues && state.activeIssues.length > 0) {
    const issues = pc.red(`⚠️  ${pc.bold("ISSUES:")} ${truncateString(state.activeIssues.join(", "), innerWidth - 14)}`);
    const padIssues = Math.max(1, innerWidth - stringWidth(stripAnsi(issues)));
    console.log(`│ ${issues}${" ".repeat(padIssues)}│`);
  }

  console.log(pc.cyan(`└${line}┘`));
  console.log();
}

/**
 * Render compact footer bar
 */
export function renderFooter(props: FooterProps): void {
  const termWidth = Math.min(Math.max(process.stdout.columns || 80, 70), 96);
  const line = "═".repeat(termWidth - 2);

  const aiBadge = `${pc.bold("AIs:")} ${pc.magenta(props.activeAIs)} Active / ${pc.dim(props.availableAIs)} Available`;
  const taskBadge = `${pc.bold("Tasks:")} ${pc.yellow(props.runningTasks)} Running, ${pc.dim(props.queuedTasks)} Queued, ${pc.green(props.completedTasks)} Done, ${pc.red(props.failedTasks)} Failed`;
  const healthBadge = props.overallHealth === "healthy"
    ? pc.green("Health: 100% OK")
    : props.overallHealth === "recovering"
    ? pc.yellow("Health: Auto-Recovering")
    : pc.red("Health: Degraded");

  const content = `  [${aiBadge}]  [${taskBadge}]  [${healthBadge}]`;
  const pad = Math.max(1, termWidth - stringWidth(stripAnsi(content)) - 2);

  console.log(pc.dim(`╒${line}╕`));
  console.log(pc.dim("│") + content + " ".repeat(pad) + pc.dim("│"));
  console.log(pc.dim(`╘${line}╛`));
  console.log();
}

/**
 * Render task detail card
 */
export function renderTaskDetail(task: QueuedTask): void {
  const termWidth = Math.min(Math.max(process.stdout.columns || 80, 60), 90);
  const line = "─".repeat(termWidth - 4);

  console.log();
  console.log(pc.magenta(`  ╭─ ${pc.bold(`TASK DETAIL [${task.id}]`)} ${line.slice(20)}╮`));
  console.log(pc.magenta("  │ ") + `${pc.bold("Title:")} ${task.title}`);
  console.log(pc.magenta("  │ ") + `${pc.bold("Status:")} ${task.status.toUpperCase()} (Retries: ${task.retries}/${task.maxRetries})`);
  if (task.assignedAgentId) {
    console.log(pc.magenta("  │ ") + `${pc.bold("Worker:")} ${task.assignedAgentId}`);
  }
  if (task.supervisorA) {
    const verdict = task.supervisorA.passed ? pc.green("PASS") : pc.red("FAIL");
    console.log(pc.magenta("  │ ") + `Supervisor A: ${verdict} ─ ${task.supervisorA.reason}`);
  }
  if (task.supervisorB) {
    const verdict = task.supervisorB.passed ? pc.green("PASS") : pc.red("FAIL");
    console.log(pc.magenta("  │ ") + `Supervisor B: ${verdict} ─ ${task.supervisorB.reason}`);
  }
  if (task.error) {
    console.log(pc.magenta("  │ ") + pc.red(`Error: ${task.error}`));
  }
  if (task.result) {
    const preview = task.result.slice(0, 150).replace(/\r?\n/g, " ");
    console.log(pc.magenta("  │ ") + pc.dim(`Result preview: ${preview}...`));
  }
  console.log(pc.magenta(`  ╰─${line}╯`));
  console.log();
}

/**
 * Render an OpenCode-style completion summary card
 */
export function renderTaskCompleteCard(title: string, summary: string): void {
  const termWidth = Math.min(Math.max(process.stdout.columns || 80, 60), 90);
  const line = "─".repeat(termWidth - 4);

  console.log();
  console.log(pc.green(`  ╭─${line}╮`));
  console.log(
    pc.green("  │ ") +
      pc.bold(pc.green(`${figures.tick} ${title}`)) +
      " ".repeat(Math.max(1, termWidth - stringWidth(title) - 8)) +
      pc.green("│")
  );
  console.log(pc.green(`  ├─${line}┤`));

  const maxContentWidth = termWidth - 6;
  const rawLines = summary.trim().split(/\r?\n/);

  for (const rawLine of rawLines) {
    if (!rawLine.trim()) {
      console.log(pc.green("  │ ") + " ".repeat(maxContentWidth) + pc.green("│"));
      continue;
    }

    // Word wrap long lines to fit nicely in terminal card
    const words = rawLine.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (stringWidth(stripAnsi(testLine)) <= maxContentWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          const pad = Math.max(0, maxContentWidth - stringWidth(stripAnsi(currentLine)));
          console.log(pc.green("  │ ") + pc.white(currentLine) + " ".repeat(pad) + pc.green("│"));
        }
        currentLine = word;
      }
    }

    if (currentLine) {
      const pad = Math.max(0, maxContentWidth - stringWidth(stripAnsi(currentLine)));
      console.log(pc.green("  │ ") + pc.white(currentLine) + " ".repeat(pad) + pc.green("│"));
    }
  }

  console.log(pc.green(`  ╰─${line}╯`));
  console.log();
}
