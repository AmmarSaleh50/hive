# Security Policy

Hive reads your Claude Code transcripts, so keeping them private is the main thing it has to get right.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through [GitHub's private vulnerability reporting](https://github.com/AmmarSaleh50/hive/security/advisories/new).

Include what the issue is, how to reproduce it, the version or commit, and how you'd like to be credited (or that you'd rather not be).

You can expect an answer within a week, and a fix or a plan within 30 days for anything serious.

## What Hive is designed to guarantee

- It listens on loopback only (`127.0.0.1` and `::1`).
- It answers only to `localhost`, `hive.localhost`, `127.0.0.1`, `[::1]` and, if enabled, this machine's own Tailscale name. Every other host name gets a 403, which blocks DNS-rebinding attacks from websites.
- It never writes inside `~/.claude`.
- The only data that leaves the machine is the recent chat text sent to Claude Haiku for summaries, through the user's own `claude` login. It can be turned off.

Anything that breaks one of these is in scope, for example:

- Reading transcripts from another origin or another machine without Tailscale.
- Getting Hive to serve files outside `public/` or the configured clip folders.
- Script injection through session names or summaries rendered in the page.

## Out of scope

- Someone who already has access to your user account or your tailnet.
- The privacy of the YouTube and Twitch players, which are embedded from those services.
