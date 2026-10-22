# Contributing

Thanks for taking the time. A one-line fix, a bug report that says "this didn't work on my machine, here's what I saw", or a new idea: all of it helps.

## Getting started

```bash
git clone https://github.com/AmmarSaleh50/hive
cd hive
npm run demo     # made-up sessions, no Claude Code needed
npm test         # starts the demo and checks the routes, the host guard and the page
```

There is nothing to install: Hive is plain Node (18+) with no dependencies, and the whole page is one file, `public/index.html`.

## Where things are

| File | What's in it |
|---|---|
| `server.cjs` | Reads Claude Code's files, asks Haiku for progress, serves the page and the API |
| `demo.cjs` | The made-up sessions behind `npm run demo` and every screenshot |
| `public/index.html` | The whole interface: board, session view, timeline, briefing, player |
| `scripts/` | Smoke test, Windows autostart, and the scripts that rebuild the brand and screenshots |
| `docs/brand/` | Logo, wordmark and icons |

## Ground rules

- **No dependencies.** Hive should stay "clone and run". If something really needs a package, open an issue first.
- **Never write inside `~/.claude`.** Hive only reads Claude Code's files.
- **Loopback only.** Anything that listens on another address, or answers to other host names, needs a very good reason.
- **Screenshots come from demo mode.** Never commit a screenshot of real sessions. `node scripts/capture-docs.cjs` regenerates them all.
- **Glanceable first.** The board is for a two-second look. New details belong in the session view or the briefing, not the rows.

## Pull requests

1. Run `npm test` and try the change in `npm run demo`.
2. If you changed the interface, check it on a phone-sized window too.
3. Describe what changed and why; a before and after screenshot (from demo mode) helps a lot.

## Good first ideas

- Packaging: a launchd plist and a systemd unit in `scripts/`.
- More icons Haiku can pick from (they must exist in the pinned Lucide version).
- Tests for the transcript parser with recorded sample lines.
