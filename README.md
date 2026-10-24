<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/wordmark/on-dark.png">
    <img alt="hive" src="docs/brand/wordmark/on-light.png" width="380">
  </picture>
</p>

<p align="center">
  A live board for every Claude Code session on your machine: where each one stands, what it needs from you, and what it said, without the tool calls.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f5b700" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933" alt="Node 18+" />
  <img src="https://img.shields.io/badge/dependencies-0-111" alt="Zero dependencies" />
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code-d97757" alt="Works with Claude Code" />
  <a href="https://github.com/AmmarSaleh50/hive/actions/workflows/ci.yml"><img src="https://github.com/AmmarSaleh50/hive/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

---

<p align="center">
  <img src="docs/screenshots/demo.gif" alt="Hive updating live as four sessions work" width="860" />
</p>

## Why

I often run eight Claude Code sessions at once. Each one writes useful things between its tool calls ("found the bug, it's the cache key", "tests pass, one question for you"), and those lines get buried under hundreds of tool calls. To find out where a session stands I had to scroll through its whole terminal. With eight of them I lost track of which one was waiting on me.

Hive is one page that answers that at a glance.

## What you get

**A board, grouped by what matters.** Sessions that **need you** (a question, an approval, something to test) come first, then the ones still **working**, then the **finished** ones. Each row shows what the session is working on, one line saying what it's doing right now, and its progress as a strip of honeycomb cells.

<p align="center"><img src="docs/screenshots/board.png" alt="The board: needs you, working, finished" width="860" /></p>

**Progress you can trust.** A small, cheap model (Claude Haiku) reads each session's recent messages and keeps a step list: what's done, what's happening now, what's left. Finished steps stay finished. When you give a session something new, the old job moves to "Earlier in this session" with its own summary.

<p align="center"><img src="docs/screenshots/session.png" alt="A session: goal, progress, steps" width="860" /></p>

**What it said, without the tool calls.** Under its steps, each session page lists what the session said to you, grouped by what you asked. Short "now doing X" lines stay on one line, results show in full, and questions and plans it put to you are included.

**A briefing instead of a wall of text.** One headline, the numbers that matter (before → after), a few tagged facts and one box that says what's next or what's your move.

<p align="center"><img src="docs/screenshots/briefing.png" alt="A briefing: headline, numbers, facts, next step" width="560" /></p>

**Resume with one click, or start fresh.** The **Folders** tab lists your folders with their sessions and your last prompt in each. Start a **New session** in any folder, or make a new folder first. Press **Resume** and the session opens as a new tab in the terminal window you already have open, in the right folder, with your usual flags. Close the terminal by accident and it's one click to get back. **End session** stops a session for good, also one you started from your phone.

**Two computers, one switch.** Run Hive on both and a switch at the top shows one computer's sessions at a time. One that's off says so. Resume and End act on the computer you're looking at. See [Two computers](#two-computers).

**Routines for the start of your day.** One button that starts everything you open before work: Docker and its containers, your dev servers (each in its own terminal tab), the apps you need. Also works from a desktop shortcut. See [Folders, resume and routines](#folders-resume-and-routines).

**On your phone too.** Hive works as a home-screen app, privately over [Tailscale](https://tailscale.com).

<p align="center">
  <img src="docs/screenshots/phone-board.png" alt="Hive on a phone: the board" width="280" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/phone-session.png" alt="Hive on a phone: a session waiting for an answer" width="280" />
</p>

**Stimulation, if you need it.** Waiting on eight agents is boring, and boredom is how you end up in another tab. Press **Stimulation** for a floating player you can drag anywhere and resize to any shape: **Subway Surfers** and **Minecraft parkour** gameplay built in (each starts at a random point), **your own clips** from any folder, and **any YouTube video or Twitch stream** (type `ttv/channel`). Its controls sit above the video, never on top of the board or the player's own buttons.

<p align="center">
  <img src="docs/screenshots/stimulation-subway.png" alt="Subway Surfers playing in the Stimulation player over the board" width="425" />
  &nbsp;
  <img src="docs/screenshots/stimulation-parkour.png" alt="Minecraft parkour playing in the Stimulation player over the board" width="425" />
</p>

## Try it

You need [Node.js 18+](https://nodejs.org). Nothing to install.

```bash
git clone https://github.com/AmmarSaleh50/hive
cd hive
npm run demo        # made-up sessions that play out by themselves
```

Open <http://localhost:4747>.

## Use it with your sessions

You also need [Claude Code](https://code.claude.com) installed and signed in, because Hive uses your `claude` command for the progress summaries.

```bash
npm start
```

Open <http://localhost:4747>, then start or keep using Claude Code as usual. Sessions appear on their own.

**Start it with your computer** (optional):

- **Windows:** `powershell -ExecutionPolicy Bypass -File scripts\autostart-windows.ps1` (add `-Remove` to undo)
- **macOS / Linux:** run `node /path/to/hive/server.cjs` from a launchd agent or a systemd user service.

**Type `hive.localhost` instead of the port:** add `"extraPorts": [80]` to your settings (see below). On Windows that works as is; on macOS and Linux port 80 needs extra privileges.

## Open it from your phone (Tailscale)

Hive only ever listens on `localhost`, so nothing on your network can reach it. To use it from your phone, publish it on your private tailnet:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:4747
```

Now `https://<this-computer>.<your-tailnet>.ts.net` opens Hive on any device signed in to your Tailscale, and nowhere else. Hive accepts that name by itself. On your phone, use "Add to Home Screen" to get it as an app. To stop sharing: `tailscale serve --https=443 off`.

## Folders, resume and routines

All of these start things on your computer, so by default they only show up on the computer Hive runs on. To use them from your phone too, see [Two computers](#two-computers).

**Folders** lists your sessions by folder, one accordion each: its newest three sessions, the rest behind "Show more". Every folder has **New session**. Point `workspace` at your folder of projects and the tab lists every folder in it, with all of its sessions however old (folders you haven't used yet too), and lets you make new folders there (**New folder** opens a small window):

```json
"workspace": "~/code"
```

**Search** (press `/`) finds folders and sessions by name and by your last prompt, forgiving a typo, and looks inside every conversation: what you and Claude said, with the matching line shown. Several words must all match; use `"exact phrases"`, `-word` to leave something out, `in:folder` and `is:running` or `is:closed`. Hive builds its index of the conversations once in the background (about a minute for a few GB of transcripts) and keeps it in `data/`.

**Resume** opens each session with `claude --resume <id>` in a new tab of the terminal window you used last, so every session you resume lands next to your others. Sessions that are still running say so instead. To add your own flags:

```json
"resume": {
  "command": "claude --resume {id} --dangerously-skip-permissions",
  "new": "claude --dangerously-skip-permissions"
}
```

On Windows it uses Windows Terminal with PowerShell 7 (or Windows PowerShell when 7 isn't installed), on macOS Terminal, on Linux GNOME Terminal. To give resumed sessions a window of their own instead, set `"window": "hive"`.

**Routines** are lists of steps under one button. A step can open an app, run a command, wait until a command succeeds, or open a terminal tab:

```json
"routines": [{
  "name": "Work", "icon": "briefcase",
  "steps": [
    { "label": "Docker", "open": "C:/Program Files/Docker/Docker/Docker Desktop.exe", "unlessRunning": "Docker Desktop" },
    { "label": "Waiting for Docker", "waitFor": "docker info", "timeout": 240 },
    { "label": "Database", "run": "docker start my-postgres my-redis" },
    { "label": "API", "tab": { "title": "API", "cwd": "~/code/my-app/backend", "command": "npm run dev" } },
    { "label": "Web", "tab": { "title": "Web", "cwd": "~/code/my-app/frontend", "command": "npm run dev" } }
  ]
}]
```

| Step | What it does |
|---|---|
| `open`, with optional `args`, `cwd`, `unlessRunning` | Starts an app. Skipped when a process called `unlessRunning` is already running. |
| `run`, with optional `timeout` (seconds) | Runs a command and waits for it. The routine stops if it fails. |
| `waitFor`, with optional `timeout` (seconds) | Retries a command every 3 seconds until it succeeds. |
| `tab`: `{ title, cwd, command }` | Opens a terminal tab, next to your resumed sessions. |

`icon` is any [Lucide](https://lucide.dev/icons) icon name. Hive shows which step a routine is on and where it stopped if something failed.

**End session** (on a running session's page and in the Resume list) asks once more, then stops it: a background session with `claude stop`, an interactive one by ending its process. The conversation stays, so you can resume it later.

**From a desktop shortcut:** `node /path/to/hive/server.cjs --routine Work` hands the routine to the running Hive (so the page shows its progress), or runs it by itself when Hive isn't running. Add `--dry-run` to only check that every app and folder in it exists.

## Two computers

Run Hive on each computer and tell each about the other. Each reads its own sessions; the switch at the top asks the other Hive over Tailscale.

```json
"machine": "desktop",
"peers": [{ "name": "laptop", "url": "https://laptop.your-tailnet.ts.net" }],
"launchFrom": "my-devices"
```

With `"launchFrom": "my-devices"` your own devices may resume, end and run things too, for example from your phone while you're away. Nobody is at that computer's screen then, so a session you resume from elsewhere starts in the background (`resume.background`, by default `claude --bg --resume {id}`), where [Remote Control](https://code.claude.com/docs/en/remote-control) reaches it. "Your own devices" means requests through `tailscale serve` whose Tailscale identity is this computer's owner, from an address that belongs to one of that owner's devices. Other people on your tailnet and the internet still can't start anything.

**A transfer button** (optional) runs your own copy or sync command and shows its last result from a status file:

```json
"sync": { "label": "Transfer now", "command": "node sync.cjs now", "status": "~/sync/status.json" }
```

The status file can hold `running`, `startedAt`, `finishedAt`, `result` (`ok`, `partial` or `error`), `counts` (`pushed`, `pulled`), `errors` and `error`.

## How it works

```
~/.claude/sessions/*.json   which sessions are running, and whether they're busy, idle or waiting on you
~/.claude/projects/**.jsonl each session's transcript (Hive reads only new lines, and only the text)
~/.claude/tasks/<id>/       the session's own task list, if it keeps one
            │
            ▼
        server.cjs ──── recent messages ───▶ claude -p --model haiku   (goal, steps, now-line, briefing)
            │
            ▼
   http://localhost:4747   one page, live updates over server-sent events
```

- **Read-only.** Hive never writes inside `~/.claude`.
- **Summaries only when useful.** Every 12 seconds per session at most while the board is open, every 5 minutes while it's closed, and right away when a session changes state. Each update is one short `claude -p` run with no tools, no settings and nothing saved.
- **Its own files** live in `data/`: a cache of the progress it has worked out, and a log of the tokens each Haiku run used.

## Settings

Copy `hive.config.example.json` to `hive.config.json` and change what you need. Everything is optional.

| Setting | Default | What it does |
|---|---|---|
| `port` | `4747` | Port on `localhost` |
| `extraPorts` | `[]` | More ports, e.g. `[80]` for `http://hive.localhost` |
| `claudeDir` | `~/.claude` | Where Claude Code keeps its sessions |
| `claudeBin` | found by itself | Path to the `claude` command |
| `summaries.enabled` | `true` | Turn the Haiku summaries off |
| `summaries.model` | `haiku` | Model used for summaries |
| `summaries.openEverySeconds` | `12` | Fastest update rate per session while the board is open |
| `summaries.backgroundEverySeconds` | `300` | Update rate while no board is open |
| `closedHours` | `6` | How long closed sessions stay listed |
| `clips` | `[]` | Folders of your own videos for the player: `[{ "path": "~/Videos/Clips", "label": "Gameplay" }]` |
| `tailscale` | `true` | Accept this machine's Tailscale name |
| `dataDir` | `./data` | Where Hive keeps its own files |
| `resume.days` | `14` | How far back the Resume list goes |
| `resume.command` | `claude --resume {id}` | Command a resumed session runs |
| `resume.background` | `claude --bg --resume {id}` | Command for resuming from another of your devices |
| `resume.new` | `claude` | Command for a new session in a folder |
| `resume.newBackground` | `claude --bg` | Command for a new session started from another of your devices |
| `workspace` | none | Your folder of projects: every folder in it shows in Folders, with all its sessions, and new folders can be made there |
| `resume.window` | `0` | Windows Terminal window for new tabs: `0` is the one you used last, a name like `hive` gives them their own |
| `routines` | `[]` | Your routine buttons, see [Folders, resume and routines](#folders-resume-and-routines) |
| `machine` | host name | This computer's name in the switch |
| `peers` | `[]` | Other computers' Hives: `[{ "name": "2060", "url": "https://...ts.net" }]` |
| `launchFrom` | `this-computer` | `my-devices` lets your own Tailscale devices resume, end and run things |
| `sync` | none | A transfer button: `{ "label", "command", "status" }` |

## Privacy and cost

- **What leaves your machine:** only the summaries. The recent chat text of a session (never its tool calls or files) goes to Claude Haiku through your own `claude` login, the same way your sessions talk to Claude. Turn it off with `"summaries": { "enabled": false }`.
- **What it costs:** one update is about 9,000 tokens in and 1,300 out, roughly $0.0025 at API list prices. With a Claude subscription it counts toward your normal usage limits; next to an active Opus session it's around half a percent. `data/usage.jsonl` records every run so you can check.
- **Who can open it:** only you. Hive listens on loopback, refuses requests for any other host name (so other websites can't reach it), and is only visible to your other devices if you publish it with `tailscale serve`.
- **Who can start things:** this computer, and with `"launchFrom": "my-devices"` your own Tailscale devices. Resume, End, routines and the transfer run only commands from your own settings file, never for other people on your tailnet or the internet, and only for requests carrying Hive's own header, which other websites can't send.

## Good to know

- Hive reads files Claude Code keeps for itself. They aren't a public API, so a Claude Code update can change them. If sessions stop showing up, please open an issue.
- Built and used daily on Windows 11 with Chrome. It's plain Node with no dependencies, so macOS and Linux should work. Reports are welcome.
- Twitch streams only play when Hive is opened over HTTPS (the Tailscale address), because Twitch refuses to embed on plain-HTTP pages.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).
