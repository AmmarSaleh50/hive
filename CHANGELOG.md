# Changelog

All notable changes to Hive are recorded here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## 0.6.5 (2026-10-25)

### Fixed

- **Resume opens a session where its conversation is now.** Send to background (Claude Code's /bg) moves the conversation to a new session; Hive kept offering the old one, which stops where it was sent away. The old one is now left out of the lists (unless it was talked to again), and resuming it opens the new one.
- **Sessions moved by /bg are listed at all.** Their file starts with a few hundred KB of file snapshots, and Hive only looked for the first message in the first 256 KB, so it took them for headless runs. It now reads further until it finds it.

## 0.6.4 (2026-10-24)

### Fixed

- **A new session shows under its folder right away**, before its first message (it has no conversation file until then).

## 0.6.3 (2026-10-24)

### Changed

- **Send to background uses Claude Code's own `/bg`**: Hive types it into the session's terminal, as you would. The session keeps working, nothing is stopped (Claude carries the conversation over to a background session, under a new id), and the terminal is freed cleanly. Refused while the session waits for your answer, since the typing would go to that prompt. Windows only. The old way (ending the process and resuming) stopped work in progress and could leave the terminal in mouse mode; it's gone.

## 0.6.2 (2026-10-24)

### Added

- **The Transfer card lists what a transfer had to decide** when both laptops changed something (both versions kept, branches brought in from the other laptop), for a week, and says when the other laptop's changes were last fetched. Status file fields `notes`, `notesAt` and `lastPull`.

## 0.6.1 (2026-10-24)

### Added

- **Send to background** for a session running in a terminal: its terminal process ends and it continues as a background session under the same id (Claude would only start a copy while it's still open). If it's in the middle of something, it asks once more, since that stops. Reach it again with Remote Control or **Open in terminal**.

## 0.6.0 (2026-10-24)

### Added

- **Search on the Folders tab** (`/` to jump in, Esc to clear): folders and sessions by name and last prompt, one typo forgiven, and everything said in every conversation, with the matching line shown and the words marked. All words must match; `"exact phrases"`, `-word`, `in:folder`, `is:running`, `is:closed`. The conversation index is built once in the background and saved in `data/`; after that only new lines are read.
- **New folder opens a small window** instead of a field above the list.

### Fixed

- On phones, a session with two buttons (Open in terminal, End session) no longer squeezes its name away.

## 0.5.1 (2026-10-24)

### Changed

- **Resuming or starting a session from your phone opens it in a terminal tab on that computer**, like at its own screen, instead of hidden in the background. Remote Control still reaches it. `"resume": { "elsewhere": "background" }` brings back the old way.

### Added

- **Open in terminal** for sessions running in the background: opens them in a terminal tab on their computer (`claude attach`).

### Fixed

- **Sessions keep the name you gave them.** A background session reports a name Claude made up (its AI title); Hive now prefers the name you set with /rename.

## 0.5.0 (2026-10-24)

### Added

- **Folders tab** (was Resume): one accordion per folder, its newest three sessions and the rest behind "Show more". Folders remember whether you opened or closed them; the rest open when something happened there in the last two days.
- **New session** in any folder: in a terminal tab at this screen, in the background from your other devices (`resume.new`, `resume.newBackground`).
- **`workspace`**: your folder of projects. Every folder in it is listed, with all its sessions however old, and **New folder** makes one there (a plain name only, never a path).

## 0.4.5 (2026-10-24)

### Fixed

- **A computer that just came back shows right away** when you switch to it, instead of after the next 10-second check.
- **Progress updates show up again.** Newer Claude Code writes a reply that has no text as a progress update: written-out thinking marked `thinkingDisplay: "updates"`, which Claude Code and the Claude app show like a message. Hive skipped them, so a session that only sent updates looked silent. They now appear in "What it said" and reach the progress summary. Thinking that isn't marked as an update stays private.

## 0.4.4 (2026-10-24)

### Fixed

- **"Off" only when it's off.** If the other computer is online in Tailscale but this one can't reach it, the switch says "no link" and the page explains the usual cause: a VPN that takes over all traffic, Tailscale's addresses included (Cisco AnyConnect does this).

## 0.4.3 (2026-10-24)

### Added

- **Unfold the quiet steps.** "33 steps since you asked" is a button now: it lists every step with its time, oldest first, ending with the one it's on.

### Fixed

- **Tables on phones** were squeezed until words broke letter by letter. On a phone each row is now a small card: the first cell as its title, the others under their column's heading. On wider screens, words in table cells no longer break in the middle.

## 0.4.2 (2026-10-23)

### Fixed

- **A session working without a word no longer looks empty.** Under your latest request, Hive now shows what it is doing right now and how many steps it has taken since you asked (or since it last said something). Haiku's progress sees those steps too, so the now-line and steps keep moving during long quiet stretches, for example while a skill runs.
- **Resume shows "Starting…"** on every device until the session is running, and refuses a second press. If Claude would only start a copy of a session (because it's still open somewhere), Hive ends the copy and tells you why.

## 0.4.1 (2026-10-23)

### Fixed

- **Background sessions are recognised as such** when they register themselves (kind "bg"), so End stops them with `claude stop`.
- **The switch works where Tailscale's DNS is off.** Hive looks up the other computer's Tailscale name in Tailscale's own list of devices, so it no longer depends on MagicDNS on that machine.

## 0.4.0 (2026-10-23)

### Added

- **Two computers, one switch.** With `peers` set, a switch at the top shows one computer's sessions at a time, through that computer's own Hive. A computer that's off shows as off.
- **End session** stops a session for good: background sessions with `claude stop`, interactive ones by ending the process. It asks once more first.
- **Background sessions** (`claude --bg`) show up on the board, with their state.
- **Use it from your phone too** with `"launchFrom": "my-devices"`: your own Tailscale devices may resume, end and run things. Resuming from elsewhere starts the session in the background (`resume.background`), for Remote Control.
- **Transfer button** (`sync`): runs your copy command and shows its last result.
- A Hive without clips plays the clips of another computer's Hive.

## 0.3.2 (2026-10-23)

### Fixed

- **Resumed sessions save their transcript again.** When Hive itself had been started from inside a Claude Code session, the tabs it opened inherited that session's markers, and Claude there ran as a sub-session that doesn't save. Hive now leaves those markers out of everything it starts.
- **Tabs look like your other PowerShell tabs**: they open with Windows Terminal's PowerShell profile, so they get its icon and font.

## 0.3.1 (2026-10-23)

### Fixed

- **Resumed sessions open in PowerShell 7**, not the old Windows PowerShell. Hive looked for `pwsh` in a way that misses the Store app alias it's usually installed as.

### Changed

- **New tabs join the terminal window you already have open** (the one you used last) instead of a separate window. Set `"resume": { "window": "hive" }` to keep them apart.

## 0.3.0 (2026-10-23)

### Added

- **Resume tab.** Your sessions from the last two weeks, by project, with your last prompt. One click reopens a session in a new tab of one shared terminal window, in its folder, with your own command (`resume.command`, e.g. with `--dangerously-skip-permissions`). Closed session pages get a Resume button too.
- **Routines.** Buttons that start your day: open apps, run commands, wait for something to be ready, open terminal tabs. The page shows which step a routine is on. `node server.cjs --routine <name>` runs one from a desktop shortcut, `--dry-run` checks it.
- Both only work from the computer Hive runs on, and only for requests carrying Hive's own header.

## 0.2.2 (2026-10-22)

### Fixed

- **Rewinds and edited prompts.** A prompt you escaped and edited, or a part of the conversation you rewound, no longer shows up. Like Claude Code, Hive now follows only the branch you are on, both in "What it said" and in what Haiku reads.

## 0.2.1 (2026-10-22)

### Fixed

- **Messages are back on each session page**, under the heading "What it said". Only the Timeline tab was meant to go in 0.2.0.

## 0.2.0 (2026-10-22)

### Removed

- **Timeline.** The Timeline tab and the message list on each session page are gone. Hive is about where each session stands at a glance, and the steps and briefing already cover that. Hive still reads the messages, because Haiku needs them to write the progress.

## 0.1.0 (2026-10-22)

First public release.

### Added

- **Board** of every running Claude Code session, grouped into Needs you, Working and Finished, with closed sessions from the last hours below.
- **Progress by Haiku:** goal, step list, one "now" line and a briefing (headline, numbers, tagged facts, next step) per session. Finished steps stay finished; a new request moves the old job to "Earlier in this session" as completed, with its own briefing.
- **Needs you detection:** questions, plan approvals and permission prompts always count; a finished turn counts only if it asked for something.
- **Timeline** of everything the sessions said, grouped by your requests, with short updates on one line and results in full. Questions, plans and your answers are included.
- **Stimulation player:** a floating, resizable window with your own clips, Subway Surfers, Minecraft parkour, YouTube links and Twitch streams (`ttv/channel`).
- **Phone support:** home-screen app icons, touch layout, and access over `tailscale serve`.
- **Demo mode** (`npm run demo`) with made-up sessions, used for every screenshot.
- Settings file, Windows autostart script, smoke test and CI.
