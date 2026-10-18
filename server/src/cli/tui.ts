import pc from "picocolors";
import figures from "figures";
import stringWidth from "string-width";

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
  const termWidth = Math.min(Math.max(process.stdout.columns || 80, 70), 100);
  const borderChar = "─";
  const line = borderChar.repeat(termWidth - 2);

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
 * Render a high-tech tool execution card inspired by OpenCode
 */
export function renderToolCard(
  tool: string,
  argsStr: string,
  agentId?: string,
  thought?: string
): void {
  const prefix = agentId ? pc.bold(pc.magenta(`[${agentId}]`)) + " " : "";
  const icon = getToolIcon(tool);

  console.log();
  console.log(
    ` ${figures.pointer} ${prefix}${pc.bold(pc.white(icon))} ${pc.bold(pc.cyan(tool))} ${pc.dim(argsStr)}`
  );

  if (thought) {
    console.log(pc.dim(`   ${figures.ellipsis} ${pc.italic(thought)}`));
  }
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
  const borderChar = "─";
  const line = borderChar.repeat(termWidth - 4);

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

