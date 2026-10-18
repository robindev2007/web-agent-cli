import pc from "picocolors";
import figures from "figures";
import stringWidth from "string-width";

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

/**
 * Strip ANSI escape codes to measure true printable character length
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
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

  const lines = summary.trim().split(/\r?\n/);
  for (const l of lines) {
    const visible = stringWidth(stripAnsi(l));
    const pad = Math.max(0, termWidth - visible - 6);
    console.log(pc.green("  │ ") + pc.white(l) + " ".repeat(pad) + pc.green("│"));
  }
  console.log(pc.green(`  ╰─${line}╯`));
  console.log();
}
