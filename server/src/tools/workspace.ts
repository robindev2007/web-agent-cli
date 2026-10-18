import { readFile as nodeReadFile, writeFile as nodeWriteFile } from "node:fs/promises";
import { resolve, relative, dirname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import fse from "fs-extra";
import fg from "fast-glob";

// ---------------------------------------------------------------------------
// Platform detection — auto-selected at startup, used throughout the module
// ---------------------------------------------------------------------------
export type OSPlatform = "windows" | "mac" | "linux";

function detectPlatform(): OSPlatform {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "mac";
    default:
      return "linux";
  }
}

/** The OS this process is running on — detected once at import time */
export const PLATFORM: OSPlatform = detectPlatform();

/** Handy booleans mirroring PLATFORM */
export const IS_WINDOWS = PLATFORM === "windows";
export const IS_MAC = PLATFORM === "mac";
export const IS_LINUX = PLATFORM === "linux";

/**
 * Normalise any path to forward-slashes (POSIX style).
 * Needed when passing paths to fast-glob patterns on Windows.
 */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolResult {
  success: boolean;
  output?: any;
  error?: string;
}

export interface FileItem {
  name: string;
  type: "file" | "directory" | "symlink";
  /** Size in bytes — 0 for directories */
  size?: number;
  /** Last-modified timestamp (ms since epoch) */
  mtime?: number;
}

export interface CopyOptions {
  /** Overwrite destination if it already exists (default: true) */
  overwrite?: boolean;
}

// ---------------------------------------------------------------------------
// Shell selection — picks the right shell per OS automatically
// ---------------------------------------------------------------------------
function getShell(): { shell: string; args: (cmd: string) => string[] } {
  if (IS_WINDOWS) {
    // PowerShell Core if available, otherwise legacy cmd.exe
    return {
      shell: "cmd.exe",
      args: (cmd) => ["/c", cmd],
    };
  }
  // macOS default shell is zsh since Catalina; Linux usually bash.
  // Fall back through: zsh → bash → sh
  const preferredShell = IS_MAC ? "zsh" : "bash";
  return {
    shell: preferredShell,
    args: (cmd) => ["-c", cmd],
  };
}

// ---------------------------------------------------------------------------
// LocalWorkspace — all file operations normalised across Windows / Mac / Linux
// ---------------------------------------------------------------------------
export class LocalWorkspace {
  private baseDir: string;
  // Shared lock table across all workspace instances so concurrent sub-agents never corrupt the same file
  private static fileLocks: Map<string, Promise<void>> = new Map();

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = resolve(baseDir);
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  /** Resolve a user-supplied relative/absolute path safely inside baseDir */
  private resolveSafe(filePath: string): string {
    return resolve(this.baseDir, normalize(filePath));
  }

  /**
   * Acquire a lock for target path, run the write callback, then release the lock.
   * Other agents attempting to write to the SAME path will queue up in order.
   * Writes to DIFFERENT paths execute concurrently without waiting!
   */
  private async withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = normalize(filePath).toLowerCase();
    const currentLock = LocalWorkspace.fileLocks.get(key) || Promise.resolve();

    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((res) => {
      releaseLock = res;
    });

    LocalWorkspace.fileLocks.set(key, currentLock.then(() => nextLock));

    await currentLock;
    try {
      return await fn();
    } finally {
      releaseLock();
      if (LocalWorkspace.fileLocks.get(key) === nextLock) {
        LocalWorkspace.fileLocks.delete(key);
      }
    }
  }

  // -------------------------------------------------------------------------
  // listFiles — enhanced with size, mtime, and symlink detection
  // -------------------------------------------------------------------------
  /**
   * List files and folders in a directory.
   * Returns FileItem[] with name, type, size, and mtime.
   */
  async listFiles(dirPath: string = "."): Promise<ToolResult> {
    try {
      const target = this.resolveSafe(dirPath);
      const entries = await fse.readdir(target, { withFileTypes: true });

      const items: FileItem[] = await Promise.all(
        entries.map(async (e) => {
          let size = 0;
          let mtime = 0;
          try {
            const st = await fse.stat(join(target, e.name));
            size = st.isFile() ? st.size : 0;
            mtime = st.mtimeMs;
          } catch {
            /* stat may fail for broken symlinks — ignore */
          }
          return {
            name: e.name,
            type: e.isSymbolicLink() ? "symlink" : e.isDirectory() ? "directory" : "file",
            size,
            mtime,
          };
        })
      );

      return { success: true, output: items };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // -------------------------------------------------------------------------
  // glob — find files using fast-glob patterns (cross-platform backslash-safe)
  // -------------------------------------------------------------------------
  /**
   * Find files matching a glob pattern (e.g. "src/**‌/*.ts", "**‌/*.json").
   * Works identically on Windows, Mac, and Linux.
   */
  async glob(
    pattern: string | string[],
    opts?: { ignore?: string[]; onlyFiles?: boolean }
  ): Promise<ToolResult> {
    try {
      const base = toPosix(this.baseDir);
      const patterns = (Array.isArray(pattern) ? pattern : [pattern]).map((p) => toPosix(p));

      const results = await fg(patterns, {
        cwd: base,
        ignore: opts?.ignore ?? ["**/node_modules/**", "**/.git/**"],
        onlyFiles: opts?.onlyFiles ?? false,
        absolute: false,
        dot: false,
        followSymbolicLinks: false,
      });

      return { success: true, output: results };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // -------------------------------------------------------------------------
  // readFile
  // -------------------------------------------------------------------------
  /**
   * Read the UTF-8 contents of a file.
   */
  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const target = this.resolveSafe(filePath);
      const content = await nodeReadFile(target, "utf-8");
      return { success: true, output: content };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // -------------------------------------------------------------------------
  // writeFile — auto-creates parent directories with race-free file locking
  // -------------------------------------------------------------------------
  /**
   * Write a UTF-8 file safely across concurrent sub-agents.
   */
  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const target = this.resolveSafe(filePath);
    return this.withFileLock(target, async () => {
      try {
        await fse.ensureDir(dirname(target)); // cross-platform mkdir -p
        await nodeWriteFile(target, content, "utf-8");
        return {
          success: true,
          output: `File written successfully: ${relative(this.baseDir, target)}`,
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });
  }

  // -------------------------------------------------------------------------
  // copyFile — recursive copy using fs-extra with destination file lock
  // -------------------------------------------------------------------------
  /**
   * Copy a file or directory (recursively) from src to dest with race protection.
   */
  async copyFile(src: string, dest: string, opts?: CopyOptions): Promise<ToolResult> {
    const srcFull = this.resolveSafe(src);
    const destFull = this.resolveSafe(dest);
    return this.withFileLock(destFull, async () => {
      try {
        await fse.copy(srcFull, destFull, { overwrite: opts?.overwrite ?? true });
        return {
          success: true,
          output: `Copied ${relative(this.baseDir, srcFull)} → ${relative(this.baseDir, destFull)}`,
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });
  }

  // -------------------------------------------------------------------------
  // moveFile — cross-platform move/rename with source & destination locking
  // -------------------------------------------------------------------------
  /**
   * Move or rename a file/directory with race protection.
   */
  async moveFile(src: string, dest: string): Promise<ToolResult> {
    const srcFull = this.resolveSafe(src);
    const destFull = this.resolveSafe(dest);
    return this.withFileLock(destFull, async () => {
      try {
        await fse.move(srcFull, destFull, { overwrite: true });
        return {
          success: true,
          output: `Moved ${relative(this.baseDir, srcFull)} → ${relative(this.baseDir, destFull)}`,
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });
  }

  // -------------------------------------------------------------------------
  // deleteFile — recursive delete with race protection
  // -------------------------------------------------------------------------
  /**
   * Delete a file or directory tree with path locking.
   */
  async deleteFile(targetPath: string): Promise<ToolResult> {
    const full = this.resolveSafe(targetPath);
    return this.withFileLock(full, async () => {
      try {
        await fse.remove(full);
        return {
          success: true,
          output: `Deleted ${relative(this.baseDir, full)}`,
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });
  }

  // -------------------------------------------------------------------------
  // ensureDir — mkdir -p across all platforms
  // -------------------------------------------------------------------------
  /**
   * Ensure a directory exists, creating all ancestors as needed.
   */
  async ensureDir(dirPath: string): Promise<ToolResult> {
    try {
      const full = this.resolveSafe(dirPath);
      await fse.ensureDir(full);
      return {
        success: true,
        output: `Directory ready: ${relative(this.baseDir, full)}`,
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // -------------------------------------------------------------------------
  // fileExists — check existence without throwing
  // -------------------------------------------------------------------------
  /**
   * Check whether a file or directory exists.
   */
  async fileExists(targetPath: string): Promise<ToolResult> {
    try {
      const full = this.resolveSafe(targetPath);
      const exists = await fse.pathExists(full);
      return { success: true, output: exists };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // -------------------------------------------------------------------------
  // runCommand — shell command with live stdout/stderr streaming
  // -------------------------------------------------------------------------
  /**
   * Run a terminal command using the OS-native shell:
   *   Windows → cmd.exe /c
   *   macOS   → zsh -c
   *   Linux   → bash -c
   *
   * Streams stdout/stderr in real-time via `onOutput` callback.
   */
  async runCommand(
    command: string,
    timeoutMs: number = 60000,
    onOutput?: (chunk: string, type: "stdout" | "stderr") => void
  ): Promise<ToolResult> {
    if (!command || typeof command !== "string") {
      return {
        success: false,
        error: "No command string provided to run_command",
        output: { exitCode: 1, stdout: "", stderr: "Missing command parameter" },
      };
    }

    return new Promise((resolveResult) => {
      try {
        const { shell, args } = getShell();

        const proc = spawn(shell, args(command), {
          cwd: this.baseDir,
          env: {
            ...process.env,
            // Ensure consistent UTF-8 output on all platforms
            ...(IS_WINDOWS ? { PYTHONIOENCODING: "utf-8" } : {}),
          },
        });

        let stdout = "";
        let stderr = "";
        let finished = false;

        const timer = setTimeout(() => {
          if (!finished) {
            finished = true;
            proc.kill();
            resolveResult({
              success: false,
              error: `Command timed out after ${timeoutMs / 1000}s`,
              output: {
                exitCode: 124,
                stdout: stdout.trim(),
                stderr: `Timed out: ${stderr.trim()}`,
              },
            });
          }
        }, timeoutMs);

        proc.stdout?.on("data", (data) => {
          const chunk = data.toString("utf-8");
          stdout += chunk;
          onOutput?.(chunk, "stdout");
        });

        proc.stderr?.on("data", (data) => {
          const chunk = data.toString("utf-8");
          stderr += chunk;
          onOutput?.(chunk, "stderr");
        });

        proc.on("close", (exitCode) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);

          const success = exitCode === 0;
          const cleanOut = stdout.trim();
          const cleanErr = stderr.trim();

          resolveResult({
            success,
            error: success
              ? undefined
              : cleanErr || cleanOut || `Process exited with code ${exitCode}`,
            output: {
              exitCode: exitCode ?? 1,
              stdout: cleanOut,
              stderr: cleanErr,
            },
          });
        });

        proc.on("error", (err) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolveResult({
            success: false,
            error: err.message || "Failed to spawn process",
            output: { exitCode: 1, stdout: "", stderr: err.message },
          });
        });
      } catch (e: any) {
        resolveResult({
          success: false,
          error: e.message || "Unexpected spawn error",
          output: { exitCode: 1, stdout: "", stderr: e.message },
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Convenience export — platform info readable from anywhere
// ---------------------------------------------------------------------------
export function getPlatformInfo(): {
  platform: OSPlatform;
  arch: string;
  homeDir: string;
  tmpDir: string;
  shell: string;
} {
  const { shell } = getShell();
  return {
    platform: PLATFORM,
    arch: os.arch(),
    homeDir: os.homedir(),
    tmpDir: os.tmpdir(),
    shell,
  };
}
