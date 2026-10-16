# 🧩 claudemods

**17 mods that change how Claude Code looks and behaves.** You get a colourful control panel, a mascot, live agent status, automatic Sonnet/Opus switching, long-term memory, safety guardrails, a daily budget, undo, and more.

The mods are built with Claude Code's plugin **function hooks**. Each one is a small TypeScript module in its own folder under [`plugins/`](plugins/).

```
╭─ 🧩 MODS CONTROL CENTER ────────── 1 Mods · 2 Sessions · 3 Activity ─╮
│ 🧠 opus · context ██████░░░░ 58% · compacts at 80% · 44k left         │
│ 💰 budget $3.20 / $25 today      ⏱ 5h 31% · 7d 12%                    │
│                                                                       │
│ 🤖 2 AGENTS WORKING                                                   │
│ ⏳ Explore  Summarize auth module                                 12s │
│    ↳ 📖 reading src/auth/session.ts                                   │
│                                                                       │
│ PROFILES  f 🎯 Focus · v 💸 Saver · w 🎓 Learning · d 🌈 Default      │
│ 🎨 LOOK    🗜️ Compact tools ON   c · switch                            │
│            🧘 Zen mode      OFF  z · switch                            │
│ 🧠 SMART   🧭 Model advisor  ON   a · switch                           │
│ 🛡️ SAFETY  🚧 Guardrails     ON   g · switch   (2 blocked)            │
╰───────────────────────────────────────────────────────────────────────╯
```

---

## Requirements

- **Claude Code** with plugin function hooks: a recent build (written and tested on 2.1.29x).
- **Fullscreen mode** for the side panels: run `/tui fullscreen` in a window at least 110 columns wide. In the normal view, panels show above the prompt instead.
- Written and tested on **macOS**. Most mods work anywhere. On other systems, `undo-last` moves created files to `~/.Trash`, so check that this suits you.

## Install

### Option A: from the marketplace (recommended)

In a Claude Code session, install the mods you want. Type `y` to add the marketplace the first time, then pick a scope (user scope covers every session):

```
/plugin install mods-center --marketplace rathialok901/claudemods
```

The control center reads its status from the other mods, so for the full experience install all of them:

```
/plugin install agent-dashboard --marketplace rathialok901/claudemods
/plugin install auto-compact --marketplace rathialok901/claudemods
/plugin install budget-guard --marketplace rathialok901/claudemods
/plugin install done-sound --marketplace rathialok901/claudemods
/plugin install explain-risky --marketplace rathialok901/claudemods
/plugin install guardrails --marketplace rathialok901/claudemods
/plugin install long-term-memory --marketplace rathialok901/claudemods
/plugin install mascot --marketplace rathialok901/claudemods
/plugin install model-advisor --marketplace rathialok901/claudemods
/plugin install mods-center --marketplace rathialok901/claudemods
/plugin install next-step --marketplace rathialok901/claudemods
/plugin install prompt-enhancer --marketplace rathialok901/claudemods
/plugin install session-hud --marketplace rathialok901/claudemods
/plugin install style-rules --marketplace rathialok901/claudemods
/plugin install tidy-view --marketplace rathialok901/claudemods
/plugin install undo-last --marketplace rathialok901/claudemods
/plugin install usage-meter --marketplace rathialok901/claudemods
```

### Option B: run them from a clone

Use this if you want to edit the mods. Clone the repo:

```bash
git clone https://github.com/rathialok901/claudemods ~/claudemods
```

Then list the mod folders in `~/.claude/settings.json`, separated by `:`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/claudemods/plugins/mods-center:~/claudemods/plugins/guardrails:~/claudemods/plugins/mascot"
  }
}
```

Add every folder you want. Claude Code loads them when it starts, and only in folders you have trusted. Saving a file while a session runs reloads that mod.

---

## The mods

Every switch can also be flipped from the control center (`/mods`) with the key shown.

### 🎛️ Control

#### `mods-center`: Mods Control Center
A colourful panel docked on the right that opens at startup.
- **Gauges:** model, context use, when compaction happens, today's spend, and the 5-hour and 7-day rate limits.
- **🤖 Agents working:** every running subagent, its task, elapsed time and current action.
- **Profiles:** `f` Focus (zen on, distractions off) · `v` Saver (model advisor on, compact at 25%) · `w` Learning (full tool output, explanations, prompt enhancer) · `d` Default.
- **One-key switches** for every mod. Your choices are remembered between sessions. Guardrails and budget always start **on**, for safety.
- **Tabs:** `1` Mods · `2` Sessions (every Claude Code session running on this machine, busy or idle, with its folder and last prompt) · `3` Activity (a live log of blocks, model switches, memory saves and agents).
- **Themes:** `t` cycles through Classic, Neon, Pastel, Ocean, Sunset and Mono.
- **Command:** `/mods` reopens it.

### 🎨 Look

#### `tidy-view`: Compact tools and Zen mode
- `/compact-tools` (`c`, on by default): tool calls shrink to one line, and successful output is hidden. Errors still show.
- `/zen` (`z`): hides all tool rows, timings and hints. You see the conversation plus one line saying what Claude is doing.

#### `mascot`: Mascot
A small character above the prompt whose face changes with what Claude is doing: thinking, reading, editing, running, celebrating or worried. Your rate-limit usage shows on the same row. `/mascot` (`m`) hides the face.

#### `session-hud`: Session HUD
`/hud` (`h`) opens a pane with session time, turns, tools used, the model, a context bar with the time until compaction, git changes, task progress and the files touched this session.

#### `agent-dashboard`: Agent panel
Tracks every subagent: its type, task, elapsed time, tool calls and status. It also shows a one-line **"doing"** summary, such as `📖 reading app.ts`, `💻 Run the tests` or `🔍 searching for TODO`. The control center shows the agents that are running. `/agent-panel` (`r`) opens the full view.

#### `usage-meter`: Usage alerts
Shows a toast when your 5-hour or 7-day limit passes 80% and again at 95%, so it never surprises you.

#### `done-sound`: Done sound
Plays a chime when a turn of 20 seconds or longer finishes, and a low tone if it failed. You can walk away and come back when it's done.

### 🧠 Smart

#### `model-advisor`: Automatic Sonnet / Opus
Don't spend Opus on simple things. **While you type**, a quick Haiku check rates the prompt:
- **Simple** (rename, explain, small fix) → **Sonnet**
- **Complex** (design, debug across files, refactor) → **Opus**

It switches before you press Enter. Short follow-ups like "yes" or "do it" keep the current model. If you pick a model yourself with `/model`, the advisor pauses. Your default model is restored when the session ends.
- `/model-advisor on | off | status` (`a`)
- The model in use shows as `🧭 sonnet` next to the prompt.

#### `long-term-memory`: Long-term memory
A global memory that carries across sessions and projects:
- **Preferences** (how you like things done)
- **Decisions** (tagged by project)
- **A short history** of past sessions

It saves on its own during a session, and before compaction. Each new session starts with the memory loaded. It's a plain Markdown file at `~/.claude/long-term-memory/MEMORY.md` that you can read and edit.
- `/brain`: show the memory
- `/brain save`: save now
- `/brain on | off` (`l`)
- `/brain forget <words>`: remove matching entries

#### `style-rules`: Style rules
Your standing preferences, added to every session's system prompt.
- `/style add use pnpm, not npm`
- `/style remove <n>`
- `/style clear`
- `/style` (`s`): list them

#### `prompt-enhancer`: Prompt enhancer
When a prompt is short and vague, like "fix it" or "why is this broken", it attaches the last failed command, its output and the recently edited files, so Claude knows what "it" means. `/enhancer` (`e`) toggles it.

#### `auto-compact`: Auto-compact
Compacts the conversation, keeping the key decisions and open tasks, once context passes a threshold (default 80%).
- `/compact-at 60`: set the threshold
- `/compact-at on | off` (`p`)

#### `next-step`: Next step
After each turn, suggests the obvious next prompt ("fix the failing tests", "run the tests", "commit these changes"). Press **Tab** to take it. `/next-step` (`n`) toggles it.

### 🛡️ Safety

#### `guardrails`: Guardrails
Blocks dangerous actions by Claude **and its subagents**, before they run:
- `rm -r` of `/`, `~`, your home folder or top-level folders
- `sudo`
- Git history and work: force-push, `git reset --hard`, `git clean -f`, discarding all changes, force-deleting a branch
- `curl … | sh`, writing to disk devices, erasing disks, fork bombs
- `chmod 777`, `chmod -R` or `find -delete` across your home folder or the whole disk, `killall`
- Commands that read SSH keys, AWS credentials, GPG keys or keychain passwords
- Reading or editing secret files: `.env`, `~/.ssh`, `~/.aws`, `.pem` and `.key` files. Public keys are allowed.

`/guardrails on | off` (`g`). It always starts **on**.

#### `budget-guard`: Daily budget
Tracks today's spend against a daily limit (default **$25**).
- Warns at 50% and 80%.
- Over the limit, it holds back your prompt. Send it again within 3 minutes to go ahead.
- `/budget`: see today's spend
- `/budget 40`: set the limit
- `/budget on | off` (`b`)

#### `explain-risky`: Explain risky
When Claude asks permission to run a command, a one-line plain-English explanation of what the command does pops up. `/explain-risky` (`x`) toggles it.

#### `undo-last`: Undo last turn
Saves a copy of every file before Claude edits it.
- `/undo-last` (`u`): puts back everything changed in the last turn. Files Claude created are moved to the Trash, never deleted.
- `/checkpoints`: lists the turns you can undo.

---

## Developing

Each mod is a folder:

```
plugins/<mod>/
├── .claude-plugin/plugin.json   # name, version, description
├── hooks/hooks.json             # { "modules": ["./register.tsx"] }
├── hooks/register.tsx           # the hooks
├── types/index.d.ts             # the mod's state contract (if it has state)
└── tests/*.test.ts
```

```bash
claude plugin validate plugins/<mod>   # check it the way Claude Code will load it
claude plugin test plugins/<mod>       # run its tests
```

Pull requests and new mods are welcome.

## Privacy

Everything stays on your machine:
- Memory, style rules, budget and checkpoints live under `~/.claude/`.
- The model advisor, explain-risky and long-term memory make small model calls through your own Claude Code session.

## License

[MIT](LICENSE)
