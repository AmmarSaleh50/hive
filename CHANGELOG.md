# Changelog

All notable changes to Hive are recorded here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

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
