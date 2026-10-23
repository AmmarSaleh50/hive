# Changelog

All notable changes to Hive are recorded here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## 0.4.1 (2026-10-23)

### Fixed

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
