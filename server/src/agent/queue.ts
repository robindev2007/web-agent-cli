import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface SupervisorVerdict {
  passed: boolean;
  reason: string;
  timestamp: number;
}

export interface QueuedTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedAgentId?: string | null;
  retries: number;
  maxRetries: number;
  result?: string | null;
  error?: string | null;
  supervisorA?: SupervisorVerdict | null;
  supervisorB?: SupervisorVerdict | null;
  createdAt: number;
  updatedAt: number;
}

export interface QueueStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

export class TaskQueue {
  private tasks: Map<string, QueuedTask> = new Map();
  private stateFilePath?: string;
  private changeListeners: Array<(tasks: QueuedTask[]) => void> = [];

  constructor(workspaceDir?: string, stateFileName: string = "queue_state.json") {
    if (workspaceDir) {
      this.stateFilePath = join(workspaceDir, ".state", stateFileName);
      this.loadFromDisk();
    }
  }

  public onChange(listener: (tasks: QueuedTask[]) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    const list = this.getTasks();
    for (const listener of this.changeListeners) {
      try {
        listener(list);
      } catch {}
    }
    this.saveToDisk();
  }

  public addTask(title: string, description: string = "", maxRetries: number = 2): QueuedTask {
    const id = `task_${this.tasks.size + 1}_${Date.now().toString(36).slice(-4)}`;
    const now = Date.now();
    const task: QueuedTask = {
      id,
      title,
      description: description || title,
      status: "pending",
      assignedAgentId: null,
      retries: 0,
      maxRetries,
      result: null,
      error: null,
      supervisorA: null,
      supervisorB: null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    this.notify();
    return task;
  }

  public addTasks(tasks: Array<{ title: string; description?: string; maxRetries?: number }>): QueuedTask[] {
    return tasks.map((t) => this.addTask(t.title, t.description, t.maxRetries));
  }

  public claimNextTask(agentId: string): QueuedTask | null {
    for (const task of this.tasks.values()) {
      if (task.status === "pending") {
        task.status = "running";
        task.assignedAgentId = agentId;
        task.updatedAt = Date.now();
        this.notify();
        return task;
      }
    }
    return null;
  }

  public completeTask(taskId: string, result: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.status = "completed";
    task.result = result;
    task.error = null;
    task.updatedAt = Date.now();
    this.notify();
    return true;
  }

  public failTask(taskId: string, error: string): { willRetry: boolean; task: QueuedTask | null } {
    const task = this.tasks.get(taskId);
    if (!task) return { willRetry: false, task: null };

    task.error = error;
    task.updatedAt = Date.now();

    if (task.retries < task.maxRetries) {
      task.retries += 1;
      task.status = "pending";
      task.assignedAgentId = null;
      this.notify();
      return { willRetry: true, task };
    }

    task.status = "failed";
    this.notify();
    return { willRetry: false, task };
  }

  public setSupervisorVerdict(
    taskId: string,
    supervisor: "supervisorA" | "supervisorB",
    verdict: { passed: boolean; reason: string }
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task[supervisor] = {
      passed: verdict.passed,
      reason: verdict.reason,
      timestamp: Date.now(),
    };
    task.updatedAt = Date.now();
    this.notify();
    return true;
  }

  public getTask(id: string): QueuedTask | undefined {
    return this.tasks.get(id);
  }

  public getTasks(): QueuedTask[] {
    return Array.from(this.tasks.values());
  }

  public getStats(): QueueStats {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case "pending":
          pending++;
          break;
        case "running":
          running++;
          break;
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
      }
    }

    return {
      total: this.tasks.size,
      pending,
      running,
      completed,
      failed,
    };
  }

  public clear(): void {
    this.tasks.clear();
    this.notify();
  }

  public saveToDisk(): void {
    if (!this.stateFilePath) return;
    try {
      mkdirSync(dirname(this.stateFilePath), { recursive: true });
      const serialized = JSON.stringify(Array.from(this.tasks.entries()), null, 2);
      writeFileSync(this.stateFilePath, serialized, "utf-8");
    } catch {}
  }

  public loadFromDisk(): void {
    if (!this.stateFilePath || !existsSync(this.stateFilePath)) return;
    try {
      const raw = readFileSync(this.stateFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.tasks = new Map(parsed);
      }
    } catch {}
  }
}

