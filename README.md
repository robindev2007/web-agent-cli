# ⚡ web-agent-cli

> **Autonomous Multi-Tab Browser AI Coding Agent & Orchestration Swarm**

`web-agent-cli` bridges your local workspace to browser-driven AI models (e.g., Gemini Web) across dedicated browser tabs. It coordinates complex coding tasks through a central **Mother AI**, dedicated isolated **Worker Sessions**, and dual independent **Supervisors** with deterministic local fallbacks.

---

## 🌟 Key Features

- **👑 Central Mother AI & Dedicated Workers:**
  - One central Mother AI coordinates planning, decomposes objectives, assigns tasks, and reviews outputs.
  - Strict session isolation: each worker operates in an independent tab without session collisions.
  - Only Mother communicates final responses to the user.

- **📋 Lightweight Task Queue & Auto-Recovery:**
  - Real-time task state tracking (`pending`, `running`, `completed`, `failed`).
  - Auto-retries with configurable limits (`maxRetries = 2`) to avoid infinite loops.
  - Disk-persisted state (`.state/queue_state.json`) preserves completed results across restarts.
  - Automatic replacement of stalled or unresponsive worker sessions.

- **🛡️ Dual Independent Supervisors & Fallback Controller:**
  - **Supervisor A:** Audits requirements completeness and task fulfillment.
  - **Supervisor B:** Detects false successes, hallucinations, and code sanity.
  - **Fallback Controller:** Deterministic disk verification (validates files, non-empty content, and absence of errors) if AI supervisors are unreachable.

- **📊 Live Compact Dashboard & TUI:**
  - Fixed sidebar displaying Mother's current objective, task queue progress, worker statuses, supervisor health, and recovery logs.
  - Footer bar showing active/available AIs, running/queued/done/failed counters, and system health badges.
  - Seamless continuous prompt loop that retains terminal history without prompting "Ready for next task?".

- **🧹 Silent Background Cleanup:**
  - Completed and failed tabs are closed silently in the background to free system RAM without terminal clutter.

---

## 🏗️ Repository Structure

- **`server/` (`web-agent-cli`)**: Bun-powered TypeScript backend, task queue, multi-agent orchestrator, supervisor engine, and terminal CLI.
- **`extension/` (`chrome-mv3`)**: WXT-powered Chrome extension with high-speed DOM driver and decoupled WebSocket message bridge.

---

## 🚀 Getting Started

### 1. Prerequisites
- [Bun](https://bun.com) installed.
- Google Chrome with Gemini Web logged in.

### 2. Build the Extension
```bash
cd extension
bun install
bun run build
```
Load the built extension in Chrome:
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `extension/.output/chrome-mv3`

### 3. Start the CLI Agent
```bash
cd server
bun install
bun run dev
```

### 4. Run Test Suite
```bash
cd server
bun test
```

---

## 📄 License
MIT