#!/usr/bin/env node
// Hive: one page showing every Claude Code session on this machine, where it stands, what it needs from you
// and what it said, without the tool calls.
// Reads ~/.claude only (never writes there). Serves the board to this machine only (loopback).
// Each session's progress (goal, steps, what it's doing now, a briefing) is written by Haiku from its messages.
// No dependencies: Node 18+ and the `claude` CLI.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');

// ---- Settings: defaults, overridden by hive.config.json (see hive.config.example.json) ----------
const ROOT = __dirname;
const home = p => String(p || '').replace(/^~(?=$|[\\/])/, os.homedir());
const DEFAULTS = {
  port: 4747,          // always listens on loopback (127.0.0.1 and ::1) only
  extraPorts: [],      // e.g. [80], so http://hive.localhost works without a port
  claudeDir: '~/.claude',
  claudeBin: '',       // empty: find `claude` by itself
  summaries: { enabled: true, model: 'haiku', openEverySeconds: 12, backgroundEverySeconds: 300 },
  closedHours: 6,      // closed sessions stay on the board this long
  clips: [],           // folders of your own videos for the Stimulation player: [{ "path": "~/Videos/Clips", "label": "Gameplay" }]
  tailscale: true,     // also answer to this machine's Tailscale name (for `tailscale serve`)
  dataDir: './data',   // where Hive keeps its progress cache and Haiku usage log
  // The Resume list: sessions from the last `days`, reopened with `command` in a new terminal tab. `window` (Windows
  // Terminal): "0" = the window you used last, or a name such as "hive" to give resumed sessions a window of their own.
  // `background` is used when you resume from another of your devices (your phone): nobody is at this screen then.
  resume: { days: 14, command: 'claude --resume {id}', background: 'claude --bg --resume {id}', window: '0' },
  // Buttons that start your day: [{ "name": "Work", "icon": "briefcase", "steps": [...] }]; see hive.config.example.json.
  routines: [],
  machine: '',         // this computer's name in the laptop switch (empty: its host name)
  peers: [],           // other computers' Hives to switch to: [{ "name": "laptop", "url": "https://laptop.<tailnet>.ts.net" }]
  launchFrom: 'this-computer', // or "my-devices": your own devices on Tailscale may resume, end and run things too
  sync: null,          // a transfer button: { "label": "Transfer now", "command": "...", "status": "path/to/status.json" }
};
function loadConfig() {
  const file = process.env.HIVE_CONFIG || path.join(ROOT, 'hive.config.json');
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.log(`Ignoring ${file}: ${e.message}`); }
  const c = { ...DEFAULTS, ...user, summaries: { ...DEFAULTS.summaries, ...(user.summaries || {}) }, resume: { ...DEFAULTS.resume, ...(user.resume || {}) } };
  if (process.env.PORT) c.port = +process.env.PORT;
  if (process.env.CLAUDE_DIR) c.claudeDir = process.env.CLAUDE_DIR;
  return c;
}
const config = loadConfig();
const DEMO = process.argv.includes('--demo') || process.env.HIVE_DEMO === '1';
const MACHINE = String(config.machine || os.hostname());

const CLAUDE = home(config.claudeDir);
const REG = path.join(CLAUDE, 'sessions'), PROJ = path.join(CLAUDE, 'projects'), TASKS = path.join(CLAUDE, 'tasks');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.resolve(ROOT, home(config.dataDir));
const CACHE = path.join(DATA, 'progress-cache.json');
const USAGE = path.join(DATA, 'usage.jsonl'); // one line per Haiku run: tokens used
const KEEP = 400;              // messages kept per session
const TAIL = 12 * 2 ** 20;     // bytes read from the end of a transcript on first sight
const CLOSED_FOR = config.closedHours * 3600e3;
const SUMMARY_GAP = config.summaries.openEverySeconds * 1e3;           // per session, while a board tab is open
const BACKGROUND_GAP = config.summaries.backgroundEverySeconds * 1e3;  // and while it's closed, so the tracker never loses the thread
const SUMMARY_CHARS = 20000;   // conversation text sent to Haiku per update
if (!DEMO) fs.mkdirSync(DATA, { recursive: true });

const sessions = new Map(); // sessionId -> session state
const ownPids = new Set();  // our Haiku runs, kept off the board
let cache = {};
if (!DEMO) try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch {}
for (const p of Object.values(cache)) for (const h of (p && p.history) || []) { delete h.filling; h.done = h.total; } // archived = finished
let version = 0;
const clients = new Set();

function bump() { version++; for (const res of clients) res.write(`data: ${version}\n\n`); }

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function safeDir(d) { try { return fs.readdirSync(d); } catch { return []; } }

function transcriptFor(id, cwd) {
  if (cwd) {
    const f = path.join(PROJ, cwd.replace(/[^a-zA-Z0-9]/g, '-'), id + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  for (const d of safeDir(PROJ)) {
    const f = path.join(PROJ, d, id + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function session(id) {
  let s = sessions.get(id);
  if (!s) {
    s = { id, name: '', title: '', cwd: '', pid: 0, kind: '', status: '', startedAt: 0, running: false,
      endedAt: 0, file: null, offset: 0, rest: null, msgs: [], parents: new Map(), leaf: null, todos: null, tasks: null, tasksSig: '', lastAt: 0,
      prog: cache[id] || null, dirty: false, summarizing: false, lastRun: 0 };
    sessions.set(id, s);
  }
  return s;
}

// Background sessions (`claude --bg`) aren't in that registry: the background service lists its live ones in
// daemon/roster.json, and each keeps its state in jobs/<short id>/state.json.
function readBackground() {
  let roster;
  try { roster = JSON.parse(fs.readFileSync(path.join(CLAUDE, 'daemon', 'roster.json'), 'utf8')); } catch { return []; }
  if (!roster.supervisorPid || !alive(roster.supervisorPid)) return [];
  const out = [];
  for (const [short, w] of Object.entries(roster.workers || {})) {
    if (!w || !w.sessionId || !w.pid || !alive(w.pid)) continue;
    let j = {};
    try { j = JSON.parse(fs.readFileSync(path.join(CLAUDE, 'jobs', short, 'state.json'), 'utf8')); } catch {}
    // Its states are working, blocked and done. One waiting for its first prompt is idle, not blocked on you.
    const status = /send a prompt/i.test(j.needs || j.detail || '') || j.state === 'done' || j.tempo === 'idle' ? 'idle'
      : j.state === 'blocked' || j.tempo === 'blocked' ? 'waiting' : 'busy';
    out.push({ sessionId: w.sessionId, short, pid: w.pid, cwd: w.cwd || j.cwd || '', name: j.name || '', kind: 'background', status,
      startedAt: w.startedAt || 0, statusUpdatedAt: Date.parse(j.updatedAt) || 0 });
  }
  return out;
}

// Running sessions come from Claude Code's own registry: ~/.claude/sessions/<pid>.json
function scanRegistry() {
  let changed = false;
  const seen = new Set(), entries = [];
  for (const f of safeDir(REG)) {
    if (!f.endsWith('.json')) continue;
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(REG, f), 'utf8')); } catch { continue; }
    if (r.sessionId && !ownPids.has(r.pid) && alive(r.pid)) entries.push(r);
  }
  for (const r of [...entries, ...readBackground()]) {
    if (seen.has(r.sessionId)) continue;
    seen.add(r.sessionId);
    const s = session(r.sessionId);
    const next = { name: r.name || '', cwd: r.cwd || '', pid: r.pid, kind: r.kind || '', short: r.short || '', status: r.status || '',
      startedAt: r.startedAt || 0, stateSince: r.statusUpdatedAt || 0, running: true, endedAt: 0 };
    if (s.status !== next.status) { s.dirty = true; s.stateChanged = true; }
    for (const k in next) if (s[k] !== next[k]) { s[k] = next[k]; changed = true; }
    if (!s.file) s.file = transcriptFor(s.id, s.cwd);
  }
  for (const s of sessions.values()) {
    if (s.running && !seen.has(s.id)) { s.running = false; s.endedAt = Date.now(); s.status = ''; changed = true; }
  }
  return changed;
}

// Sessions that ended recently (before the board started, or headless runs) are found by file age.
function scanClosed() {
  const cutoff = Date.now() - CLOSED_FOR;
  for (const d of safeDir(PROJ)) {
    for (const f of safeDir(path.join(PROJ, d))) {
      if (!f.endsWith('.jsonl')) continue;
      const id = f.slice(0, -6);
      if (sessions.has(id)) continue;
      let st;
      try { st = fs.statSync(path.join(PROJ, d, f)); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const s = session(id);
      s.file = path.join(PROJ, d, f);
      s.endedAt = st.mtimeMs;
    }
  }
  for (const [id, s] of sessions) if (!s.running && s.endedAt < cutoff) sessions.delete(id);
}

const SKIP_USER = /^<(system-reminder|command-|task-notification|local-command|bash-|user-memory|ide_|teammate)/;

function push(s, m) {
  s.msgs.push(m);
  if (s.msgs.length > KEEP) s.msgs.splice(0, s.msgs.length - KEEP);
}

function ingest(s, line) {
  if (line.length > 4e6) return;
  let o;
  try { o = JSON.parse(line); } catch { return; }
  // A transcript is a tree: rewinding, or pressing Esc and editing a prompt, starts a new branch from an earlier
  // entry. Like Claude Code, Hive shows only the branch that ends at the newest entry (or at the end point
  // Claude Code records after a rewind).
  if (o.type === 'last-prompt' && o.leafUuid) { if (s.parents.has(o.leafUuid)) s.leaf = o.leafUuid; return; }
  if (o.uuid && !o.isSidechain && s.parents.size < 500000) { s.parents.set(o.uuid, o.parentUuid || o.logicalParentUuid || null); s.leaf = o.uuid; }
  if (o.type === 'custom-title' && o.customTitle) { s.title = o.customTitle; return; }
  if (!o.cwd || o.isSidechain) { if (o.cwd && !s.cwd) s.cwd = o.cwd; return; }
  if (!s.cwd) s.cwd = o.cwd;
  if (o.type !== 'assistant' && o.type !== 'user') return;
  const c = o.message && o.message.content;
  const at = Date.parse(o.timestamp) || Date.now();
  s.lastAt = Math.max(s.lastAt, at);
  if (o.type === 'assistant') {
    if (!Array.isArray(c)) return;
    const t = c.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
    if (t) push(s, { role: 'agent', text: t, at, uuid: o.uuid });
    for (const b of c) {
      if (b.type !== 'tool_use') continue;
      s.pending = { id: b.id, name: b.name };
      const inp = b.input || {};
      if (b.name === 'TodoWrite' && Array.isArray(inp.todos))
        s.todos = inp.todos.map((t, i) => ({ id: String(i + 1), subject: t.content, activeForm: t.activeForm, status: t.status }));
      // Questions and plans are addressed to you, so they belong in the messages.
      if (b.name === 'AskUserQuestion' && Array.isArray(inp.questions))
        push(s, { role: 'agent', at, uuid: o.uuid, text: inp.questions.map(q => `**Question:** ${q.question}\n` +
          (q.options || []).map(o => `- ${o.label}${o.description ? `: ${o.description}` : ''}`).join('\n')).join('\n\n') });
      if (b.name === 'ExitPlanMode' && inp.plan) push(s, { role: 'agent', at, uuid: o.uuid, text: `**Plan for your approval:**\n\n${inp.plan}` });
    }
    return;
  }
  const answer = Array.isArray(c) && s.pending && c.find(b => b.type === 'tool_result' && b.tool_use_id === s.pending.id);
  if (answer) {
    if (s.pending.name === 'AskUserQuestion') {
      const a = typeof answer.content === 'string' ? answer.content : (answer.content || []).map(x => x.text || '').join('\n');
      const picks = [...a.matchAll(/"(?:[^"\\]|\\.)*"="((?:[^"\\]|\\.)*)"/g)].map(x => x[1]);
      const text = picks.length ? picks.join('\n') : a.trim();
      if (text) push(s, { role: 'you', kind: 'answer', at, uuid: o.uuid, text });
    }
    s.pending = null;
  }
  if (o.isMeta || o.isCompactSummary) return;
  let t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n\n') : '';
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!t || SKIP_USER.test(t) || t.startsWith('[Request interrupted')) return;
  push(s, { role: 'you', text: t, at, uuid: o.uuid });
}

// The messages on the branch you're on: walk back from the end point through each entry's parent.
function active(s) {
  if (!s.leaf || !s.parents.has(s.leaf)) return s.msgs;
  const key = s.leaf + ':' + s.msgs.length + ':' + (s.msgs.length && s.msgs[s.msgs.length - 1].at);
  if (s.activeKey !== key) {
    const on = new Set();
    for (let u = s.leaf; u && s.parents.has(u) && !on.has(u);) { on.add(u); u = s.parents.get(u); }
    s.activeMsgs = s.msgs.filter(m => !m.uuid || on.has(m.uuid));
    s.activeKey = key;
  }
  return s.activeMsgs;
}

function readNew(s) {
  if (!s.file) return false;
  let st;
  try { st = fs.statSync(s.file); } catch { return false; }
  if (st.size < s.offset) { s.offset = 0; s.rest = null; s.msgs = []; s.parents = new Map(); s.leaf = null; }
  if (st.size === s.offset) return false;
  let start = s.offset, partial = false;
  if (start === 0 && st.size > TAIL) { start = st.size - TAIL; partial = true; }
  const b = Buffer.alloc(st.size - start);
  const fd = fs.openSync(s.file, 'r');
  try { fs.readSync(fd, b, 0, b.length, start); } finally { fs.closeSync(fd); }
  s.offset = st.size;
  let buf = s.rest ? Buffer.concat([s.rest, b]) : b;
  const end = buf.lastIndexOf(10);
  if (end < 0) { s.rest = buf; return false; }
  s.rest = buf.subarray(end + 1);
  const lines = buf.subarray(0, end).toString('utf8').split('\n');
  if (partial) lines.shift();
  const before = s.msgs.length && s.msgs[s.msgs.length - 1];
  for (const l of lines) if (l) ingest(s, l);
  return s.msgs.length !== 0 && s.msgs[s.msgs.length - 1] !== before;
}

// Task lists (TaskCreate/TaskUpdate) are stored by Claude Code in ~/.claude/tasks/<sessionId>/<n>.json
function readTasks(s) {
  const dir = path.join(TASKS, s.id);
  const list = [];
  for (const f of safeDir(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (t.status !== 'deleted') list.push({ id: String(t.id), subject: t.subject, activeForm: t.activeForm, status: t.status });
    } catch {}
  }
  list.sort((a, b) => (+a.id || 0) - (+b.id || 0));
  const sig = JSON.stringify(list);
  if (sig === s.tasksSig) return false;
  s.tasksSig = sig;
  s.tasks = list.length ? list : null;
  return true;
}

function displayName(s) {
  if (s.name) return s.name;
  if (s.title) return s.title;
  const first = active(s).find(m => m.role === 'you');
  if (first) return first.text.replace(/\s+/g, ' ').slice(0, 48);
  return s.id.slice(0, 8);
}

// ---- Progress, written by Haiku -------------------------------------------------------------
const BRIEF_RULES = `brief: a briefing on this piece of work for an owner who hates reading. Pick only what matters most; leave out routine steps.
- headline: the single most important result or status so far, at most 10 words.
- stats: 0 to 4 real numbers from the conversation that matter (measurements, counts, sizes, before and after). value at most 14 characters, like "1.6 W" or "4.5 → 2.6 GHz" or "36 GB"; label at most 4 words. Never invent or estimate a number; use [] if there are none.
- facts: 2 to 5 items, each at most 9 words. k is "done" (finished work), "found" (something learned), "problem" (something wrong or blocked) or "decided" (a choice made).
- next: at most 10 words, what happens next. you: true if that is something the user must do.`;
// Icons are Lucide names (lucide 0.460.0, all checked to exist); anything else becomes a plain circle.
const ICONS = ('search wrench bug code file-text folder database server cloud upload download git-branch git-commit-horizontal rocket play ' +
  'flask-conical circle-check shield lock key globe wifi network cpu gauge thermometer battery zap monitor smartphone laptop palette image ' +
  'video music layout-dashboard list-checks settings sliders-horizontal trash-2 refresh-cw clock calendar message-square mail bell eye ' +
  'sparkles brain book-open chart-line package box terminal link map gamepad-2 crosshair trophy flame fan power hard-drive scissors pencil ' +
  'type undo-2 hexagon move maximize hand mouse-pointer-click smile ruler layers puzzle activity wind snowflake tv-minimal mic headphones circle').split(' ');
const ICON_SET = new Set(ICONS);
const icon = i => ICON_SET.has(String(i)) ? String(i) : 'circle';
const ICON_RULES = `Icons ("icon" and every "i"): pick the one name from this list that best shows what that line is about, so the owner recognises it at a glance: ${ICONS.join(', ')}. Use exactly these names; "circle" only if nothing fits.`;
const STYLE = `Plain words the owner uses, no file paths unless essential. Never use em dashes or the character "·".`;

const TRACKER = `You keep a progress tracker for one Claude Code session. Its owner glances at a dashboard and must understand in two seconds where the session stands.
Describe only the CURRENT piece of work: the one started by the most recent request from the user that began new work. Ignore earlier finished work.
Reply with JSON only, no markdown:
{"same": boolean, "ask": boolean, "goal": string, "icon": string, "steps": [{"t": string, "s": "done" | "now" | "todo", "i": string}], "now": string,
 "brief": {"headline": string, "stats": [{"value": string, "label": string, "i": string}], "facts": [{"k": "done" | "found" | "problem" | "decided", "t": string, "i": string}], "next": string, "you": boolean}}
${ICON_RULES}
same: true if this is still the same piece of work as the previous tracker, false if the user started something new (or there is no previous tracker).
ask: true only if the session is not working and cannot go on or call the work complete without the user: it asked a question, wants a decision or an approval, or explicitly asked the user to test something and report back. false if it is working, or if it finished: optional tips like "reload to see it", "empty the bin whenever you like" or "you can now open X" do not count. Example: "I removed it. Reload the page and the settings tab shows just the buttons." is finished, ask false. "Does the settings tab look right now?" is ask true.
Never add a step for the user (like "You reload to check") unless ask is true.
goal: what is being done, 3 to 6 plain words.
steps: 4 to 10 steps covering the whole piece of work from start to finish, in the order they happen, including steps not started yet (use the plan the assistant described). 2 to 7 words each. Finished steps always come first in the list, then the current one, then the rest. Finished steps "done", the step in progress "now" (at most one), the rest "todo". A step is "done" only if the assistant said it succeeded; a step that failed, was blocked, or was handed to the user stays "todo".
If a previous tracker is given and it is the same piece of work, keep every one of its steps that is done, with the same wording, and keep its other step wording wherever it still fits; change steps only when the plan really changed. Older messages are shortened; the previous tracker remembers what they said.
now: one line, at most 10 words, what it is doing at this moment. If ask is true, write "Your turn: " plus what to answer, decide, approve or test, in at most 10 words. If the session finished and ask is false, write "Done: " plus the main result in a few words.
${BRIEF_RULES}
Keep the previous brief's facts and numbers unless they changed; older messages are shortened, so the previous brief is your memory of them.
${STYLE}`;
// For jobs that were archived before they got a briefing: one brief, written from that job's own messages.
const BACKFILL = `You write a briefing about one earlier piece of work in a Claude Code session. Reply with JSON only, no markdown:
{"icon": string, "brief": {"headline": string, "stats": [{"value": string, "label": string, "i": string}], "facts": [{"k": "done" | "found" | "problem" | "decided", "t": string, "i": string}], "next": string, "you": boolean}}
Describe only the piece of work named below; the conversation may contain other work, ignore it. Write it as finished history: next says what was left open, or "Nothing left open".
${BRIEF_RULES}
${ICON_RULES}
${STYLE}`;
const ICONIZE = `Pick an icon for each piece of work in the numbered list. Reply with JSON only, no markdown: {"icons": [string, ...]}, one per line, in the same order.
${ICON_RULES}`;
const clean = t => String(t || '').replace(/\s*[—·]\s*/g, ', ').trim();

// The prompts go to the CLI as files: no command-line length or quoting limits on any OS.
const PROMPTS = {};
function promptFile(name, text) {
  if (!PROMPTS[name]) {
    const dir = path.join(DATA, 'prompts');
    fs.mkdirSync(dir, { recursive: true });
    PROMPTS[name] = path.join(dir, name + '.txt');
    fs.writeFileSync(PROMPTS[name], text);
  }
  return PROMPTS[name];
}

// Finds the `claude` CLI: the configured path, then the usual install places, then PATH.
function findClaude() {
  if (config.claudeBin) return home(config.claudeBin);
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const dirs = [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.claude', 'local'), ...String(process.env.PATH || '').split(path.delimiter)];
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); if (d && fs.existsSync(f)) return f; }
  return 'claude';
}
const CLAUDE_BIN = findClaude();

// One Haiku run: no tools, no settings, nothing saved. Logs its token use; hands back the parsed JSON.
function runHaiku(name, system, input, label, done) {
  const args = ['-p', '--model', config.summaries.model, '--no-session-persistence', '--tools', '', '--strict-mcp-config',
    '--setting-sources', '', '--system-prompt-file', promptFile(name, system), '--output-format', 'json'];
  const viaShell = /\.cmd$/i.test(CLAUDE_BIN); // npm installs on Windows are .cmd scripts, which need a shell
  const child = spawn(viaShell ? `"${CLAUDE_BIN}"` : CLAUDE_BIN, viaShell ? args.map(a => `"${a}"`) : args,
    { cwd: os.tmpdir(), windowsHide: true, shell: viaShell });
  ownPids.add(child.pid);
  let out = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', () => {});
  child.on('error', () => {});
  child.on('close', () => {
    ownPids.delete(child.pid);
    let p = null;
    try {
      const res = JSON.parse(out), u = res.usage || {};
      fs.appendFile(USAGE, JSON.stringify({ at: Date.now(), session: label, chars: input.length,
        input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
        output: u.output_tokens || 0, listUsd: res.total_cost_usd || 0 }) + '\n', () => {});
      const r = res.result || '';
      p = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1));
    } catch {}
    done(p);
  });
  child.stdin.end(input);
}

function saveCache() { fs.writeFile(CACHE, JSON.stringify(cache), () => {}); }

const ORDER = { done: 0, now: 1, todo: 2 }; // the comb fills left to right

// Keep Haiku's briefing to the shape and sizes the pop-up is designed for.
function cleanBrief(b) {
  if (!b || typeof b !== 'object') return null;
  const arr = x => Array.isArray(x) ? x : [];
  return {
    headline: clean(b.headline).slice(0, 90),
    stats: arr(b.stats).filter(x => x && x.value).slice(0, 4).map(x => ({ value: clean(x.value).slice(0, 16), label: clean(x.label).slice(0, 40), i: icon(x.i) })),
    facts: arr(b.facts).filter(x => x && x.t).slice(0, 5).map(x => ({ k: ['done', 'found', 'problem', 'decided'].includes(x.k) ? x.k : 'found', t: clean(x.t).slice(0, 90), i: icon(x.i) })),
    next: clean(b.next).slice(0, 90),
    you: !!b.you,
  };
}

// Newest messages in full, older ones shortened, the user's requests always kept: reaches far back cheaply.
function transcriptText(s) {
  const parts = [], msgs = active(s);
  let used = 0;
  for (let i = msgs.length - 1; i >= 0 && used < SUMMARY_CHARS; i--) {
    const m = msgs[i];
    const cap = m.role === 'you' ? 1500 : msgs.length - i <= 6 ? 3000 : 280;
    const t = m.text.length > cap ? m.text.slice(0, cap) + ' [...]' : m.text;
    const line = `${m.role === 'you' ? 'USER' : 'ASSISTANT'} (${new Date(m.at).toISOString().slice(11, 16)}): ${t}`;
    used += line.length;
    parts.unshift(line);
  }
  return parts.join('\n\n');
}

function summarize(s) {
  s.summarizing = true; s.dirty = false; s.stateChanged = false; s.lastRun = Date.now();
  const tasks = s.tasks || s.todos;
  const input = [
    `Session name: ${displayName(s)}  Folder: ${s.cwd}`,
    `Session state right now: ${s.status === 'busy' ? 'working'
      : s.status === 'waiting' ? `blocked in the middle of the work until the user ${s.pending && s.pending.name === 'AskUserQuestion' ? 'answers the question it just asked'
        : s.pending && s.pending.name === 'ExitPlanMode' ? 'approves its plan' : `approves running a tool (${s.pending ? s.pending.name : 'unknown'})`} in the terminal`
      : 'finished its turn, waiting for the user\'s next message'}`,
    s.prog ? `Previous tracker: ${JSON.stringify({ goal: s.prog.goal, steps: s.prog.steps, now: s.prog.now, brief: s.prog.brief || null })}` : '',
    tasks ? `The session's own task list (authoritative for steps): ${JSON.stringify(tasks.map(t => ({ t: t.subject, s: t.status })))}` : '',
    'Conversation (oldest first, tool calls omitted):',
    transcriptText(s),
  ].filter(Boolean).join('\n\n');
  runHaiku('tracker', TRACKER, input, displayName(s), p => {
    s.summarizing = false;
    try {
      if (p && p.goal && Array.isArray(p.steps) && p.steps.length) {
        const prev = s.prog, same = !!(prev && p.same);
        const steps = p.steps.map(x => ({ t: clean(x.t), s: ['done', 'now', 'todo'].includes(x.s) ? x.s : 'todo', i: icon(x.i) }));
        // Finished steps are locked in for the same piece of work, even if Haiku leaves one out.
        // (Only when the done count drops, so a reworded step isn't added twice.)
        const doneCount = l => l.filter(x => x.s === 'done').length;
        if (same && doneCount(steps) < doneCount(prev.steps)) {
          const key = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
          const have = new Set(steps.map(x => key(x.t)));
          for (const x of prev.steps) if (x.s === 'done' && !have.has(key(x.t))) steps.push({ t: x.t, s: 'done', i: x.i || 'circle' });
        }
        // A new piece of work moves the old one into this session's history. Moving on means it's finished.
        const history = (prev && prev.history) || [];
        s.prog = { goal: clean(p.goal), icon: icon(p.icon), now: clean(p.now), ask: !!p.ask, brief: cleanBrief(p.brief),
          steps: steps.sort((a, b) => ORDER[a.s] - ORDER[b.s]), at: Date.now(),
          history: same || !prev ? history : [{ goal: prev.goal, icon: prev.icon, done: prev.steps.length, total: prev.steps.length,
            at: prev.at, brief: prev.brief || null }, ...history].slice(0, 6) };
        cache[s.id] = s.prog;
        saveCache();
        bump();
      }
    } catch {}
  });
}

let backfilling = 0;
function backfill(s, i) {
  const h = s.prog && s.prog.history[i];
  if (!h || h.brief || h.filling) return;
  h.filling = true; backfilling++;
  const start = (s.prog.history[i + 1] || {}).at || 0, end = (h.at || Date.now()) + 60e3;
  const msgs = active(s).filter(m => m.at > start && m.at <= end);
  let used = 0;
  const lines = [];
  for (let j = msgs.length - 1; j >= 0 && used < SUMMARY_CHARS; j--) {
    const m = msgs[j], t = m.text.length > 1500 ? m.text.slice(0, 1500) + ' [...]' : m.text;
    lines.unshift(`${m.role === 'you' ? 'USER' : 'ASSISTANT'}: ${t}`);
    used += t.length;
  }
  const input = `Piece of work: ${h.goal}\n\nConversation (oldest first, tool calls omitted):\n\n${lines.join('\n\n') || '(no messages kept)'}`;
  runHaiku('backfill', BACKFILL, input, displayName(s) + ' (earlier)', p => {
    backfilling--;
    delete h.filling;
    const b = p && cleanBrief(p.brief || p);
    h.brief = b && b.headline ? b : { headline: h.goal, stats: [], facts: [], next: 'No messages from this job were kept', you: false };
    if (p && p.icon) h.icon = icon(p.icon);
    saveCache();
    bump();
  });
}

function iconize(s) {
  const items = s.prog.history.filter(h => !h.icon);
  backfilling++;
  runHaiku('iconize', ICONIZE, items.map((h, i) => `${i + 1}. ${h.goal}`).join('\n'), displayName(s) + ' (icons)', p => {
    backfilling--;
    items.forEach((h, i) => { h.icon = icon(p && Array.isArray(p.icons) ? p.icons[i] : ''); });
    saveCache();
    bump();
  });
}

// Fast updates while a board tab is open or a session just changed state, slow ones otherwise.
function scheduleSummaries() {
  if (!config.summaries.enabled) return;
  let running = [...sessions.values()].filter(s => s.summarizing).length;
  for (const s of sessions.values()) {
    if (running >= 2) break;
    if (!s.running || !s.msgs.length || s.summarizing) continue;
    const gap = clients.size || s.stateChanged ? SUMMARY_GAP : BACKGROUND_GAP;
    const stale = s.dirty || !s.prog || (s.prog.at || 0) < s.lastAt;
    if (stale && Date.now() - s.lastRun > gap) { summarize(s); running++; }
  }
  // Spare capacity goes to earlier jobs that never got a briefing or an icon, one call at a time.
  if (running + backfilling >= 2 || backfilling) return;
  for (const s of sessions.values()) {
    const hs = (s.prog && s.prog.history) || [];
    const i = hs.findIndex(h => !h.brief);
    if (i >= 0 && s.msgs.length) return backfill(s, i);
    if (hs.some(h => !h.icon)) return iconize(s);
  }
}

// Haiku's verdict once it has seen the finished turn; until then, a last message ending in a question.
function needsYou(s) {
  if (s.prog && (s.prog.at || 0) >= (s.stateSince || 0) && typeof s.prog.ask === 'boolean') return s.prog.ask;
  const msgs = active(s);
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'agent') return /\?\s*$/.test(msgs[i].text.trim());
  return false;
}

function summary(s) {
  const tasks = s.tasks || s.todos;
  let progress = null;
  if (s.prog) {
    const steps = s.prog.steps;
    const done = steps.filter(x => x.s === 'done').length;
    progress = { goal: s.prog.goal, icon: s.prog.icon || 'circle', now: s.prog.now, brief: s.prog.brief || null, steps, done,
      total: steps.length, pct: Math.round(100 * done / steps.length), history: s.prog.history || [] };
  }
  let last = null;
  const msgs = active(s);
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'agent') { last = msgs[i]; break; }
  // Claude Code reports busy, idle (turn finished) or waiting (blocked on a question or permission).
  // Blocked always needs you; a finished turn needs you only if it asked for something.
  const state = !s.running ? 'closed' : s.status === 'waiting' ? 'waiting' : s.status === 'idle' ? (needsYou(s) ? 'waiting' : 'finished') : 'working';
  return { id: s.id, name: displayName(s), project: s.cwd ? path.basename(s.cwd) : '', cwd: s.cwd, state, background: s.kind === 'background',
    startedAt: s.startedAt, endedAt: s.endedAt, lastAt: s.lastAt, stateSince: s.stateSince || s.lastAt, progress, tasks: tasks || [], last };
}

// A message is a turn's result when it's Claude's last word before your next prompt, or before the
// session stopped working.
function withFinal(s) {
  const working = summary(s).state === 'working';
  const msgs = active(s);
  return msgs.map((m, i) => {
    if (m.role !== 'agent') return m;
    const next = msgs[i + 1];
    const final = next ? next.role === 'you' && next.kind !== 'answer' : !working;
    return final ? { ...m, final } : m;
  });
}

function tick() {
  let changed = scanRegistry();
  for (const s of sessions.values()) {
    if (readNew(s)) { changed = true; s.dirty = true; }
    if (s.running && readTasks(s)) { changed = true; s.dirty = true; }
  }
  if (changed) bump();
  scheduleSummaries();
}

function list() {
  const cutoff = Date.now() - CLOSED_FOR;
  return [...sessions.values()].filter(s => s.running || (s.msgs.length && (s.lastAt >= cutoff || DEMO))).map(summary)
    .sort((a, b) => (a.state === 'closed') - (b.state === 'closed') || (a.state === 'closed' ? b.endedAt - a.endedAt : a.startedAt - b.startedAt));
}

function json(res, v) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(v));
}

// ---- Stimulation: your own clips, played in the floating window ----------------------------------
let clips = [];
function scanClips() {
  clips = [];
  for (const c of config.clips || []) {
    const dir = home(c.path), label = c.label || path.basename(dir);
    for (const f of safeDir(dir)) if (/\.(mp4|webm|mov)$/i.test(f)) clips.push({ file: path.join(dir, f), name: f.replace(/\.[^.]+$/, ''), label });
  }
}

// Streams a video with byte ranges so the player can seek.
function sendVideo(req, res, file) {
  let st;
  try { st = fs.statSync(file); } catch { res.writeHead(404); return res.end(); }
  const type = /\.webm$/i.test(file) ? 'video/webm' : /\.mov$/i.test(file) ? 'video/quicktime' : 'video/mp4';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!m) {
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes' });
    return fs.createReadStream(file).pipe(res);
  }
  let start = m[1] ? +m[1] : st.size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
  if (start >= st.size || start < 0) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
  res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}

// ---- Resume and routines: open sessions in terminal tabs, start your day's apps -------------------
// Recent sessions come straight from the transcripts: their folder, name and your last prompt.
const recentCache = new Map(); // file -> { key, info }
function readSlice(file, start, len) {
  const b = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, b, 0, len, start); } finally { fs.closeSync(fd); }
  return b.toString('utf8').split('\n');
}
function promptText(o) {
  const c = o.message && o.message.content;
  let t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ') : '';
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  return !t || SKIP_USER.test(t) || t.startsWith('[Request interrupted') ? '' : t.replace(/\s+/g, ' ');
}
function sessionInfo(file, st) {
  const key = st.size + ':' + st.mtimeMs, hit = recentCache.get(file);
  if (hit && hit.key === key) return hit.info;
  let cwd = '', first = '', title = '', last = '';
  for (const l of readSlice(file, 0, Math.min(st.size, 256 * 1024))) {
    if (cwd && first) break;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (!cwd && o.cwd) cwd = o.cwd;
    if (!first && o.type === 'user' && !o.isSidechain && !o.isMeta) first = promptText(o);
  }
  const from = Math.max(0, st.size - 256 * 1024);
  for (const l of readSlice(file, from, st.size - from)) {
    if (!l.includes('"custom-title"') && !l.includes('"last-prompt"')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type === 'custom-title' && o.customTitle) title = o.customTitle;
    if (o.type === 'last-prompt' && o.lastPrompt) last = String(o.lastPrompt).replace(/\s+/g, ' ');
  }
  const info = first ? { cwd, name: title || first.slice(0, 60), last: (last || first).slice(0, 160) } : null; // no prompt = headless run
  recentCache.set(file, { key, info });
  return info;
}
function recentSessions() {
  const cutoff = Date.now() - config.resume.days * 86400e3, out = [];
  for (const d of safeDir(PROJ)) {
    for (const f of safeDir(path.join(PROJ, d))) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(PROJ, d, f);
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const info = sessionInfo(file, st);
      if (!info || !info.cwd) continue;
      const id = f.slice(0, -6), live = sessions.get(id);
      out.push({ id, ...info, name: (live && live.running && live.name) || info.name, project: path.basename(info.cwd),
        lastAt: st.mtimeMs, running: !!(live && live.running), folderExists: fs.existsSync(info.cwd) });
    }
  }
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

// A tab in the terminal window you already have open, so every session you resume lands next to the others.
const fill = (cmd, vars) => cmd.replace(/\{(\w+)\}/g, (m, k) => vars[k] !== undefined ? vars[k] : m);
// What a Claude Code session marks its child processes with. If Hive was started from inside a session, these would
// reach the terminals it opens, and Claude there would think it's a sub-session (which doesn't save its transcript).
const SESSION_MARKS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT|CLAUDE_CODE_(CHILD_SESSION|ENTRYPOINT|EXECPATH|SESSION_\w+|MESSAGING_\w+|SSE_PORT|SHELL_\w+))$/i;
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!SESSION_MARKS.test(k)) env[k] = v;
  return env;
}
// Windows Terminal's own profiles for the two PowerShells (the ids are the same on every PC), so a tab gets your icon and font.
const WT_PROFILES = { pwsh: '{574e775e-4f2a-5b96-ac1e-a2962a402336}', powershell: '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}' };
// PowerShell 7 when it's installed, else the built-in Windows PowerShell. pwsh usually sits behind a Store
// app alias that Node's fs can't see, so ask `where` like a shell would.
let winShell = '';
function windowsShell() {
  if (!winShell) try { execFileSync('where.exe', ['pwsh'], { stdio: 'ignore', windowsHide: true }); winShell = 'pwsh'; } catch { winShell = 'powershell'; }
  return winShell;
}
function openTab({ title, cwd, command }) {
  const dir = home(cwd || os.homedir()), opts = { detached: true, stdio: 'ignore', env: cleanEnv() };
  if (process.platform === 'win32') {
    const shell = windowsShell();
    // `wt -w 0` adds the tab to the terminal window you used last (a name instead keeps a window of its own).
    // The command goes in encoded, because quotes and ";"
    // would otherwise be read by wt.exe itself before PowerShell ever sees them.
    const lit = s => s.replace(/;/g, '\\;'); // a bare ";" would start a new wt command
    const args = ['-w', config.resume.window, 'new-tab', '-p', WT_PROFILES[shell], '--title', lit(title || 'Hive'), '-d', lit(dir),
      shell, '-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')];
    spawn('wt.exe', args, { ...opts, windowsHide: false }).on('error', e => console.log('Could not open Windows Terminal:', e.message)).unref();
  } else if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script "cd ${JSON.stringify(dir).slice(1, -1)} && ${command.replace(/"/g, '\\"')}"`;
    spawn('osascript', ['-e', script, '-e', 'tell application "Terminal" to activate'], opts)
      .on('error', e => console.log('Could not open Terminal:', e.message)).unref();
  } else {
    spawn('gnome-terminal', ['--tab', `--title=${title || 'Hive'}`, `--working-directory=${dir}`, '--', 'bash', '-lc', `${command}; exec bash`], opts)
      .on('error', () => spawn('x-terminal-emulator', ['-e', `bash -lc 'cd "${dir}" && ${command}; exec bash'`], opts)
        .on('error', e => console.log('Could not open a terminal:', e.message)).unref()).unref();
  }
}
// At this screen a session opens in a terminal tab; from your phone it starts in the background, where Remote
// Control reaches it. (`--bg --resume` needs the full session id, or it starts a copy under a new one.)
async function resumeSession(id, mode = 'here') {
  const s = /^[\w-]+$/.test(id) && recentSessions().find(x => x.id === id);
  if (!s) return 'That session is not in the Resume list.';
  if (s.running) return 'That session is already running.';
  if (!s.folderExists) return `Its folder no longer exists: ${s.cwd}`;
  if (mode === 'here') { openTab({ title: s.name.slice(0, 40), cwd: s.cwd, command: fill(config.resume.command, { id }) }); return ''; }
  const r = await sh(fill(config.resume.background, { id }), 60e3, s.cwd);
  return r.ok ? '' : r.out.split('\n').filter(Boolean).pop() || 'It did not start.';
}

// End a session for good: a background one is stopped (its conversation stays), an interactive one's process ends.
async function endSession(id) {
  const s = sessions.get(id);
  if (!s || !s.running) return 'That session is not running.';
  let r;
  if (s.kind === 'background') {
    if (!/^[0-9a-f]{8}$/.test(s.short)) return 'Unknown background session.';
    r = await sh(`"${CLAUDE_BIN}" stop ${s.short}`, 30e3); // stop takes the short id
  } else if (process.platform === 'win32') {
    r = await sh(`taskkill /PID ${+s.pid} /T /F`, 15e3);
  } else {
    try { process.kill(+s.pid, 'SIGTERM'); r = { ok: true }; } catch (e) { r = { ok: false, out: e.message }; }
  }
  if (r.ok) setTimeout(tick, 500);
  return r.ok ? '' : String(r.out || '').split('\n').filter(Boolean).pop() || 'It did not end.';
}

// The transfer button: a command you set up, and the status file it writes (lastPush, lastPull, running, result, error).
const syncRun = { running: false, error: '' };
let syncSeen = 0;
function syncState() {
  if (!config.sync) return null;
  let status = null;
  try { status = JSON.parse(fs.readFileSync(home(config.sync.status), 'utf8')); } catch {}
  return { label: config.sync.label || 'Transfer now', status, running: syncRun.running || !!(status && status.running), error: syncRun.error };
}
function runSync() {
  if (!config.sync || !config.sync.command) return 'No transfer is set up here.';
  if (syncRun.running) return 'A transfer is already running.';
  Object.assign(syncRun, { running: true, error: '' }); bump();
  sh(config.sync.command, 3 * 3600e3).then(r => { Object.assign(syncRun, { running: false, error: r.ok ? '' : r.out.split('\n').filter(Boolean).pop() || 'failed' }); bump(); });
  return '';
}
function watchSync() { // the transfer also runs on its own schedule; show its new status when the file changes
  if (!config.sync || !config.sync.status) return;
  let m = 0;
  try { m = fs.statSync(home(config.sync.status)).mtimeMs; } catch {}
  if (m !== syncSeen) { syncSeen = m; bump(); }
}

// ---- Other computers (the laptop switch) ---------------------------------------------------------
// Each computer runs its own Hive. This one shows another's sessions by asking its Hive, which answers this
// computer as one of your devices: viewing is open to them, launching only with "launchFrom": "my-devices" there.
const peers = (config.peers || []).filter(p => p && p.name && p.url).map(p => ({ name: String(p.name), url: String(p.url).replace(/\/+$/, ''), online: false }));
async function pingPeers() {
  for (const p of peers) {
    const was = p.online;
    try { p.online = (await fetch(p.url + '/api/ping', { signal: AbortSignal.timeout(4000) })).ok; } catch { p.online = false; }
    if (p.online !== was) bump();
  }
}
const machines = () => [{ name: MACHINE, self: true, online: true }, ...peers.map(p => ({ name: p.name, online: p.online }))]
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
function toPeer(p, route, body) {
  return fetch(p.url + route, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers: { 'x-hive': '1', 'content-type': 'application/json' }, signal: AbortSignal.timeout(body ? 90e3 : 8000) });
}
// The clips live on one computer; a Hive without clips plays the first online one's.
let clipPeer = null;

// Routine steps: { open, args, cwd, unlessRunning } starts an app, { run } runs a command and waits for it,
// { waitFor, timeout } retries a command until it succeeds, { tab: { title, cwd, command } } opens a terminal tab.
function sh(cmd, timeoutMs = 120e3, cwd = os.homedir()) {
  return new Promise(resolve => {
    const child = spawn(cmd, { shell: true, windowsHide: true, cwd, env: cleanEnv() });
    let out = '';
    child.stdout && child.stdout.on('data', d => out += d);
    child.stderr && child.stderr.on('data', d => out += d);
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, out: 'timed out' }); }, timeoutMs);
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, out: e.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, out: out.trim() }); });
  });
}
async function isRunning(name) {
  if (!name) return false;
  // (macOS pgrep leaves out its own parents, Hive among them; that's fine for the apps a routine opens.)
  const r = process.platform === 'win32' ? await sh(`tasklist /FI "IMAGENAME eq ${name.replace(/\.exe$/i, '')}.exe" /NH`, 15e3) : await sh(`pgrep -if "${name}"`, 15e3);
  return process.platform === 'win32' ? r.out.toLowerCase().includes(name.replace(/\.exe$/i, '').toLowerCase() + '.exe') : r.ok;
}
async function openApp(step) {
  const exe = home(step.open), cwd = home(step.cwd || path.dirname(exe));
  if (await isRunning(step.unlessRunning)) return 'already running';
  if (process.platform === 'win32') {
    // Start-Process handles apps that ask for administrator rights, and sets the working folder.
    const q = s => `'${String(s).replace(/'/g, "''")}'`;
    const args = (step.args || []).length ? ` -ArgumentList ${(step.args).map(q).join(',')}` : '';
    const r = await sh(`powershell -NoProfile -Command "Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(cwd)}${args}"`, 60e3);
    if (!r.ok) throw new Error((r.out.split('\n')[0] || 'could not start').replace(/^Start-Process : /, '').trim());
  } else {
    // macOS apps are folders (Foo.app) that `open -a` starts; anything else is run directly.
    const [bin, args] = process.platform === 'darwin' && /\.app\/?$/.test(exe)
      ? ['open', ['-a', exe, ...((step.args || []).length ? ['--args', ...step.args] : [])]] : [exe, step.args || []];
    await new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd, detached: true, stdio: 'ignore', env: cleanEnv() });
      child.on('error', reject).on('spawn', () => { child.unref(); resolve(); });
    });
  }
  return 'started';
}
const routine = { name: '', step: 0, total: 0, label: '', error: '', doneAt: 0 };
async function runRoutine(name, { dryRun = false, log = () => {} } = {}) {
  const r = (config.routines || []).find(x => x.name.toLowerCase() === String(name).toLowerCase());
  if (!r) throw new Error(`No routine called "${name}" in hive.config.json`);
  if (routine.name && !routine.doneAt) throw new Error(`"${routine.name}" is still running`);
  Object.assign(routine, { name: r.name, step: 0, total: r.steps.length, label: '', error: '', doneAt: 0 });
  bump();
  try {
    for (const [i, step] of r.steps.entries()) {
      const label = step.label || step.open || step.run || step.waitFor || (step.tab && step.tab.title) || `step ${i + 1}`;
      Object.assign(routine, { step: i + 1, label }); bump();
      log(`${i + 1}/${r.steps.length} ${label}`);
      if (dryRun) {
        const p = step.open ? home(step.open) : step.tab && step.tab.cwd ? home(step.tab.cwd) : step.cwd ? home(step.cwd) : '';
        if (p && !fs.existsSync(p)) throw new Error(`${label}: not found: ${p}`);
        continue;
      }
      if (step.open) log('   ' + await openApp(step).catch(e => { throw new Error(`${label}: ${e.message}`); }));
      else if (step.run) { const x = await sh(step.run, (step.timeout || 120) * 1e3); if (!x.ok) throw new Error(`${label}: ${x.out.split('\n').pop()}`); }
      else if (step.waitFor) {
        const until = Date.now() + (step.timeout || 120) * 1e3;
        while (!(await sh(step.waitFor, 20e3)).ok) {
          if (Date.now() > until) throw new Error(`${label}: still not ready after ${step.timeout || 120} s`);
          await new Promise(res => setTimeout(res, 3000));
        }
      } else if (step.tab) openTab(step.tab);
    }
    Object.assign(routine, { label: 'Done', doneAt: Date.now() });
  } catch (e) {
    Object.assign(routine, { error: e.message, doneAt: Date.now() });
    throw e;
  } finally { bump(); }
}

// Who may launch things: this computer; with "launchFrom": "my-devices" also your own devices on Tailscale.
// Never other people on your tailnet, never the internet, never other websites (see the POST checks in handle()).
let tsIPs = [], tsOwner = '', tsOwnerIPs = new Set();
const loopback = req => /^(127\.0\.0\.1|::1)$/.test(String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''));
const forwardedFor = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/^::ffff:/, '');
function fromThisComputer(req) {
  const fwd = forwardedFor(req);
  return loopback(req) && (!fwd || tsIPs.includes(fwd)); // through `tailscale serve`, only this machine's own Tailscale address
}
// `tailscale serve` names the signed-in Tailscale user of every request (and drops any such header a client sends).
// Both have to match: that user is this computer's owner, and the address is one of that owner's devices.
function fromMyDevice(req) {
  const fwd = forwardedFor(req);
  return loopback(req) && !!fwd && !!tsOwner && !req.headers['tailscale-funnel-request']
    && String(req.headers['tailscale-user-login'] || '').toLowerCase() === tsOwner && tsOwnerIPs.has(fwd);
}
// 'here' = you're at this screen; 'away' = one of your other devices, so things start in the background.
function launchMode(req) {
  if (DEMO) return '';
  if (fromThisComputer(req)) return 'here';
  return config.launchFrom === 'my-devices' && fromMyDevice(req) ? 'away' : '';
}
function readBody(req) {
  return new Promise(resolve => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e4) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
}

// ---- Who may connect --------------------------------------------------------------------------
// Only answer to our own names, so a web page can't reach the transcripts through DNS rebinding.
// From other devices Hive is reached only through `tailscale serve`, as https://<machine>.<tailnet>.ts.net.
const HOSTS = /^(hive\.localhost|localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const TAILSCALE_BINS = process.platform === 'win32' ? ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe']
  : process.platform === 'darwin' ? ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'] : ['tailscale'];
let tsName = '';
// This machine's Tailscale name and addresses, its owner, and that owner's devices. Read again every minute.
function readTailscale(i = 0) {
  if (!config.tailscale || DEMO || i >= TAILSCALE_BINS.length) return;
  execFile(TAILSCALE_BINS[i], ['status', '--json'], { windowsHide: true, timeout: 5000 }, (err, out) => {
    let st;
    try { st = JSON.parse(out); } catch { return readTailscale(i + 1); }
    const self = st.Self || {}, users = st.User || {}, untagged = n => !(n.Tags && n.Tags.length);
    tsName = String(self.DNSName || '').replace(/\.$/, '').toLowerCase();
    tsIPs = self.TailscaleIPs || [];
    tsOwner = untagged(self) ? String((users[self.UserID] || {}).LoginName || '').toLowerCase() : '';
    tsOwnerIPs = new Set([self, ...Object.values(st.Peer || {})].filter(n => n.UserID === self.UserID && untagged(n)).flatMap(n => n.TailscaleIPs || []));
  });
}
function hostOk(h) {
  h = String(h || '').toLowerCase();
  return HOSTS.test(h) || (!!tsName && (h === tsName || h.startsWith(tsName + ':')));
}

// The page, the logo, and the PNG icons and manifest phones use for a home-screen app.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'], '/logo.svg': ['logo.svg', 'image/svg+xml'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'], '/apple-touch-icon-precomposed.png': ['apple-touch-icon.png', 'image/png'],
  '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'],
  '/icon-maskable-512.png': ['icon-maskable-512.png', 'image/png'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
};

function localState(mode) {
  return { version, demo: DEMO, secure: tsName ? 'https://' + tsName : '', machine: MACHINE, machines: machines(), view: MACHINE,
    sessions: list(), canLaunch: !!mode, here: mode === 'here', routines: (config.routines || []).map(r => ({ name: r.name, icon: r.icon || 'rocket' })), routine, sync: syncState() };
}
// Streams another Hive's answer through (server-sent events, video byte ranges).
async function pipeFrom(p, route, req, res, headers = {}) {
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  const r = await fetch(p.url + route, { headers, signal: ac.signal });
  const out = {};
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) { const v = r.headers.get(k); if (v) out[k] = v; }
  res.writeHead(r.status, out);
  if (!r.body) return res.end();
  require('stream').Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
}
async function viaPeer(req, res, u, p, mode) {
  const off = { version, demo: DEMO, secure: tsName ? 'https://' + tsName : '', machine: MACHINE, machines: machines(), view: p.name, offline: true,
    sessions: [], canLaunch: false, routines: [], routine: {}, sync: null };
  if (u.pathname === '/events') {
    if (p.online) return pipeFrom(p, '/events', req, res);
    // While it's off, this Hive's own events tell the page when it comes back.
  } else if (!p.online) {
    return u.pathname === '/api/state' ? json(res, off) : json(res, u.pathname === '/api/recent' ? [] : { ok: false, error: `The ${p.name} is off.` });
  } else if (u.pathname === '/api/state') {
    const d = await (await toPeer(p, '/api/state')).json();
    return json(res, { ...d, demo: DEMO, secure: off.secure, machine: MACHINE, machines: machines(), view: p.name, canLaunch: !!mode && !!d.canLaunch, here: false });
  } else if (u.pathname === '/api/recent') {
    return json(res, mode ? await (await toPeer(p, '/api/recent')).json() : []);
  } else if (u.pathname.startsWith('/api/session/')) {
    const r = await toPeer(p, u.pathname);
    if (!r.ok) { res.writeHead(r.status); return res.end(); }
    return json(res, await r.json());
  } else if (['/api/resume', '/api/end', '/api/routine', '/api/sync'].includes(u.pathname)) {
    const body = await readBody(req), r = await toPeer(p, u.pathname, body);
    return json(res, r.ok ? await r.json() : { ok: false, error: `The ${p.name}'s Hive refused that (${r.status}).` });
  } else { res.writeHead(404); return res.end(); }
  // (events while the other computer is off)
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`data: ${version}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

function handle(req, res) {
  if (!hostOk(req.headers.host)) { res.writeHead(403); return res.end(); }
  const u = new URL(req.url, 'http://x');
  const st = STATIC[u.pathname];
  if (st) {
    res.writeHead(200, { 'content-type': st[1], 'cache-control': 'no-cache' });
    return fs.createReadStream(path.join(PUBLIC, st[0])).pipe(res);
  }
  // hive.localhost asks this to see whether the secure Tailscale address is reachable before moving there.
  if (u.pathname === '/api/ping') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return res.end('{"ok":true}');
  }
  const mode = launchMode(req);
  const LAUNCH = ['/api/resume', '/api/end', '/api/routine', '/api/sync'].includes(u.pathname);
  if (LAUNCH) {
    // Only a JSON POST with our own header: browsers can't send that from another website without asking first.
    const origin = req.headers.origin ? new URL(req.headers.origin).host : req.headers.host;
    if (req.method !== 'POST' || req.headers['x-hive'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')
      || !hostOk(origin) || !mode) { res.writeHead(403); return res.end(); }
  }
  // ?m=<computer> shows another computer's sessions, through its own Hive.
  const m = u.searchParams.get('m') || '';
  const peer = m && m !== MACHINE ? peers.find(p => p.name === m) : null;
  if (m && m !== MACHINE && !peer) { res.writeHead(404); return res.end(); }
  if (peer) return viaPeer(req, res, u, peer, mode).catch(() => {
    if (!res.headersSent) json(res, { ok: false, error: `The ${peer.name} did not answer.` }); else res.end();
  });

  if (u.pathname === '/api/state') return json(res, localState(mode));
  if (u.pathname === '/api/recent') return json(res, mode ? recentSessions() : []);
  if (LAUNCH) {
    return readBody(req).then(async body => {
      if (u.pathname === '/api/resume') { const err = await resumeSession(String(body.id || ''), mode); return json(res, { ok: !err, error: err }); }
      if (u.pathname === '/api/end') { const err = await endSession(String(body.id || '')); return json(res, { ok: !err, error: err }); }
      if (u.pathname === '/api/sync') { const err = runSync(); return json(res, { ok: !err, error: err }); }
      const started = runRoutine(String(body.name || ''));
      started.catch(e => console.log('Routine stopped:', e.message));
      // A wrong name or a routine that's still going fails right away; anything later shows on the board.
      Promise.race([started.then(() => ''), new Promise(r => setTimeout(r, 50, ''))]).catch(e => e.message)
        .then(err => json(res, { ok: !err, error: err }));
    });
  }
  if (u.pathname === '/api/clips') {
    if (clips.length || !peers.some(p => p.online)) return json(res, clips.map((c, id) => ({ id, name: c.name, label: c.label })));
    return (async () => {
      for (const p of peers.filter(x => x.online)) {
        try { const list = await (await toPeer(p, '/api/clips')).json(); if (list.length) { clipPeer = p; return json(res, list); } } catch {}
      }
      json(res, []);
    })();
  }
  if (u.pathname.startsWith('/clip/')) {
    const c = clips[+u.pathname.slice(6)];
    if (!c && !clips.length && clipPeer) return pipeFrom(clipPeer, u.pathname, req, res, req.headers.range ? { range: req.headers.range } : {}).catch(() => res.end());
    if (!c) { res.writeHead(404); return res.end(); }
    return sendVideo(req, res, c.file);
  }
  if (u.pathname.startsWith('/api/session/')) {
    const s = sessions.get(decodeURIComponent(u.pathname.slice(13)));
    if (!s) { res.writeHead(404); return res.end(); }
    return json(res, { version, session: summary(s), msgs: withFinal(s) });
  }
  if (u.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`data: ${version}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  res.writeHead(404); res.end();
}

// ---- Start --------------------------------------------------------------------------------------
// `node server.cjs --routine Work` runs a routine and exits (for a desktop shortcut); add --dry-run to only check it.
const ROUTINE_ARG = process.argv.indexOf('--routine');
if (ROUTINE_ARG > 0) {
  const name = process.argv[ROUTINE_ARG + 1] || '', dryRun = process.argv.includes('--dry-run');
  const here = () => runRoutine(name, { dryRun, log: m => console.log(m) })
    .then(() => { console.log(dryRun ? 'Dry run: every step looks fine.' : 'Done.'); process.exit(0); })
    .catch(e => { console.log('Stopped: ' + e.message); process.exit(1); });
  if (dryRun) here();
  else {
    // Hand it to the running Hive so the board shows its progress; run it here when Hive isn't running.
    const body = JSON.stringify({ name });
    http.request({ host: '127.0.0.1', port: config.port, path: '/api/routine', method: 'POST', timeout: 3000,
      headers: { 'content-type': 'application/json', 'x-hive': '1', 'content-length': Buffer.byteLength(body) } }, res => {
      if (res.statusCode !== 200) return here();
      let b = ''; res.on('data', d => b += d).on('end', () => {
        const r = (() => { try { return JSON.parse(b); } catch { return {}; } })();
        console.log(r.ok ? `"${name}" started in Hive.` : 'Stopped: ' + r.error); process.exit(r.ok ? 0 : 1);
      });
    }).on('error', here).on('timeout', function () { this.destroy(); }).end(body);
  }
  return;
}
if (DEMO) {
  // Made-up sessions that play out by themselves: for trying Hive and for the screenshots.
  require('./demo.cjs')({ session, sessions, bump });
} else {
  readTailscale();
  setInterval(readTailscale, 60e3);
  scanClosed();
  scanClips();
  setInterval(scanClips, 10 * 60e3);
  tick();
  setInterval(tick, 1000);
  setInterval(scanClosed, 60e3);
  setInterval(watchSync, 2000);
}
if (peers.length && !DEMO) { pingPeers(); setInterval(pingPeers, 10e3); }
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25e3);

const ports = [...new Set([config.port, ...(config.extraPorts || [])])];
for (const port of ports) for (const host of ['127.0.0.1', '::1']) {
  http.createServer(handle).on('error', e => { if (host === '127.0.0.1') console.log(`Hive could not listen on port ${port}: ${e.code}`); })
    .listen(port, host, () => { if (host === '127.0.0.1') console.log(`Hive${DEMO ? ' (demo)' : ''} on http://localhost:${port}${port === 80 ? ' and http://hive.localhost' : ''}`); });
}
