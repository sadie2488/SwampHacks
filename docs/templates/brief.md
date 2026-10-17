# 🎵 Your brief: {NAME} · Task {TASK_ID} ({TASK_TITLE})
*{LAPTOP} · Generated {TIME} · Brief #{N}*

> **First time? Type `/start`.** I'll walk you through setup step by step.
> **Get further information by typing `/explain` + the item number** (e.g. `/explain 5.3`).
> - Your Claude answers from the project docs, in plain words
> - Can't answer? Type `/ask` + your question (goes to the main laptop), or email `[MUSIC] ask ...`

> ⭐ **How you can help right now (only humans can do these)**
> {HUMAN_TASKS — only open items, your interests first}

### 1. What's actively being worked on
- **1.1** {who → what}

### 2. What's changed since your last brief
- **2.1** {change, or "First check-in — nothing to compare"}

### 3. Hard rules
- **3.1** Only work inside: {OWNED_PATHS}. Everything else gives a warning
- **3.2** Locked for everyone: `contracts/`, `tests/`, `.github/`, `.claude/`, root config files
- **3.3** Never paste API keys or passwords into chat, email, or files
- **3.4** You can't merge into the main project — the main laptop does that after checks
- **3.5** No AI attribution or tool credits in commits or pull requests
- **3.6** Leaving or done? Type `/handback` — don't just close the laptop
- **3.7** You can override any rule; you'll get a warning first, and it's logged

### 4. Your task: {TASK_TITLE}
- **4.1** Goal: {INTENT — the ask, word for word}
- **4.2** Why it matters: {WHY}
- **4.3** You're done when: {ACCEPTANCE — plain English}
- **4.4** Read these first: {FILES}
- **4.5** Not your job right now: {OUT_OF_SCOPE}
- **4.6** Fake data you can use: {FIXTURES}
- **4.7** Watch out for: {RISKS}

### 5. Additional information
- **5.1** Deadline Sunday 6:00 AM. New features stop at 3:00 AM Sunday
- **5.2** Awake to approve things: {AWAKE}
- **5.3** Your Claude stops to answer you whenever you type. Press **Esc** to stop it immediately
- **5.4** Assumed (tell us if wrong): {ASSUMPTIONS relevant to this task}

### 6. Example questions
**Ask your Claude:**
- **6.1** {task-specific}
- **6.2** "Run my task's tests and tell me in plain words what failed"
- **6.3** "Am I staying inside my allowed folders?"

**Ask the main laptop (`/ask`):**
- **6.4** "Can I take another task when I'm done?"
- **6.5** "The contract is missing something I need — can it change?"

### Want the bigger picture?
- `/explain ai-setup` — how the AI agents are organized and why there are rules
- `/explain plan` — the overall plan and timeline
- `/explain features` — what the app does, mode by mode
- `/explain team` — who's working on what right now
- `/explain demo` — what the final demo shows
