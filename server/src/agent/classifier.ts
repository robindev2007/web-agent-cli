/**
 * Smart task complexity classifier.
 * Analyzes a user prompt and decides whether it needs multi-agent orchestration
 * or can be handled by a single focused agent — no user input required.
 *
 * Decision logic:
 *  - MULTI  → complex, multi-step, or multi-concern tasks (build X + test Y + deploy Z)
 *  - SINGLE → focused, single-concern tasks (fix a bug, read a file, quick script)
 */

export type AgentMode = "multi" | "single";

// ─── Signals that push toward MULTI-agent ────────────────────────────────────

/** Keywords/phrases that strongly indicate a complex, multi-step goal */
const MULTI_KEYWORDS = [
  // Scope / architecture words
  "full stack", "fullstack", "full-stack",
  "entire", "complete", "whole", "end-to-end", "end to end",
  "from scratch", "from the ground up", "scaffold", "boilerplate",
  "project", "application", "app", "system", "platform", "service",
  "backend", "frontend", "database", "api", "rest api", "graphql",
  "microservice", "monorepo",
  // Multi-concern conjunctions
  "and then", "then deploy", "and deploy", "and test", "and add",
  "and integrate", "and set up", "and configure", "and connect",
  "and also", "plus", "as well as", "along with",
  // Testing / CI / infra
  "write tests", "unit tests", "integration tests", "e2e tests",
  "ci/cd", "pipeline", "docker", "kubernetes", "k8s", "terraform",
  "github actions", "deploy", "hosting",
  // Complexity signals
  "refactor", "migrate", "redesign", "overhaul", "rewrite",
  "authentication", "auth", "jwt", "oauth", "session",
  "database schema", "prisma", "orm", "migrations",
  "multiple files", "several files",
];

/** High-complexity single words that alone warrant multi-agent */
const MULTI_SINGLE_WORDS = new Set([
  "scaffold", "boilerplate", "refactor", "migrate", "redesign",
  "overhaul", "rewrite", "authentication", "deploy",
]);

// ─── Signals that push toward SINGLE-agent ───────────────────────────────────

/** Phrases indicating a quick, focused, single-step task */
const SINGLE_KEYWORDS = [
  "fix", "fix the", "quick fix", "patch",
  "read", "show", "print", "output", "display",
  "list", "find", "search", "look",
  "rename", "move", "copy", "delete", "remove",
  "add a comment", "add a line", "add one",
  "update the", "change the", "replace the",
  "debug", "check", "verify", "run",
  "echo", "hello world",
  "simple script", "one file", "single file",
  "what is", "what are", "how many",
];

// ─── Scoring engine ───────────────────────────────────────────────────────────

interface ClassificationResult {
  mode: AgentMode;
  reason: string;
  confidence: "high" | "medium" | "low";
  multiScore: number;
  singleScore: number;
}

/**
 * Count how many tasks are implied by the prompt.
 * Detects patterns like "do X, then Y, and Z" or bullet lists.
 */
function countImpliedTasks(text: string): number {
  const lower = text.toLowerCase();
  let count = 1;

  // Conjunction-based chaining
  const conjunctions = [" and ", " then ", " also ", " plus ", " as well as ", " along with "];
  for (const conj of conjunctions) {
    const matches = lower.split(conj).length - 1;
    count += matches;
  }

  // Numbered lists: "1. ... 2. ... 3. ..."
  const numberedItems = (text.match(/\b\d+\.\s/g) || []).length;
  if (numberedItems > 1) count += numberedItems - 1;

  // Bullet/dash lists
  const bulletItems = (text.match(/^[\-\*\•]\s/gm) || []).length;
  if (bulletItems > 1) count += bulletItems - 1;

  return count;
}

/**
 * Count distinct technical areas mentioned (e.g. frontend + database = 2 concerns).
 */
function countDistinctConcerns(lower: string): number {
  const concerns = [
    ["frontend", "ui", "css", "html", "react", "vue", "svelte", "next", "tailwind"],
    ["backend", "server", "api", "express", "fastify", "hono", "bun", "node"],
    ["database", "db", "sql", "postgres", "mysql", "sqlite", "mongo", "prisma", "orm"],
    ["auth", "authentication", "login", "jwt", "oauth", "session", "cookie"],
    ["test", "spec", "jest", "vitest", "playwright", "e2e", "unit test"],
    ["deploy", "docker", "ci", "cd", "github actions", "pipeline", "hosting"],
  ];

  return concerns.filter((group) => group.some((term) => lower.includes(term))).length;
}

/**
 * Classify a user task prompt into multi-agent or single-agent mode.
 * Returns the mode, a human-readable reason, and scoring details.
 */
export function classifyTask(userPrompt: string): ClassificationResult {
  const lower = userPrompt.toLowerCase().trim();
  const words = lower.split(/\s+/);
  const wordSet = new Set(words);

  let multiScore = 0;
  let singleScore = 0;
  const reasons: string[] = [];

  // ── 1. Word length heuristic (longer prompts = more complex) ──────────────
  if (words.length >= 30) { multiScore += 2; reasons.push("long detailed prompt"); }
  else if (words.length >= 15) { multiScore += 1; }
  else if (words.length <= 4) { singleScore += 4; reasons.push("very short command"); }
  else if (words.length <= 8) { singleScore += 2; reasons.push("short focused prompt"); }

  // ── 2. Implied task count ─────────────────────────────────────────────────
  const taskCount = countImpliedTasks(userPrompt);
  if (taskCount >= 4) { multiScore += 3; reasons.push(`~${taskCount} implied steps`); }
  else if (taskCount >= 2) { multiScore += 1; }

  // ── 3. Distinct concern areas ─────────────────────────────────────────────
  const concerns = countDistinctConcerns(lower);
  if (concerns >= 3) { multiScore += 3; reasons.push(`${concerns} technical domains`); }
  else if (concerns >= 2) { multiScore += 2; reasons.push(`${concerns} technical domains`); }
  else if (concerns === 1) { singleScore += 1; }

  // ── 4. MULTI keyword matches ──────────────────────────────────────────────
  for (const kw of MULTI_KEYWORDS) {
    if (lower.includes(kw)) {
      multiScore += kw.includes(" ") ? 2 : 1; // phrases worth more than single words
    }
  }
  for (const word of wordSet) {
    if (MULTI_SINGLE_WORDS.has(word)) { multiScore += 2; }
  }

  // ── 5. SINGLE keyword matches ─────────────────────────────────────────────
  for (const kw of SINGLE_KEYWORDS) {
    if (lower.includes(kw)) {
      singleScore += 1;
    }
  }

  // ── 6. Question form → always single ─────────────────────────────────────
  if (/^(what|how|why|where|when|list|show|find|read|run)\b/.test(lower)) {
    singleScore += 3;
    reasons.push("question/lookup task");
  }

  // ── 7. Explicit "simple" / "quick" modifiers → single ────────────────────
  if (/\b(simple|quick|small|tiny|just|only|single|one)\b/.test(lower)) {
    singleScore += 2;
    reasons.push("explicitly simple scope");
  }

  // ── Final decision ────────────────────────────────────────────────────────
  const gap = multiScore - singleScore;
  const mode: AgentMode = gap > 0 ? "multi" : "single";
  const confidence: "high" | "medium" | "low" =
    Math.abs(gap) >= 4 ? "high" : Math.abs(gap) >= 2 ? "medium" : "low";

  // Build human-readable reason
  const topReason =
    reasons.length > 0
      ? reasons.join(", ")
      : mode === "multi"
      ? "multiple concerns detected"
      : "focused single task";

  return {
    mode,
    reason: topReason,
    confidence,
    multiScore,
    singleScore,
  };
}
