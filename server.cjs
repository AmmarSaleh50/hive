#!/usr/bin/env node
// Hive: one page showing every Claude Code session on this machine, its progress
// and everything it has said to you, without the tool calls.
// Reads ~/.claude only (never writes there). Serves the board to this machine only (loopback).
// Each session's progress (goal, steps, what it's doing now, a briefing) is written by Haiku from its messages.
// No dependencies: Node 18+ and the `claude` CLI.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync } = require('child_process');

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
};
function loadConfig() {
  const file = process.env.HIVE_CONFIG || path.join(ROOT, 'hive.config.json');
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.log(`Ignoring ${file}: ${e.message}`); }
  const c = { ...DEFAULTS, ...user, summaries: { ...DEFAULTS.summaries, ...(user.summaries || {}) } };
  if (process.env.PORT) c.port = +process.env.PORT;
  if (process.env.CLAUDE_DIR) c.claudeDir = process.env.CLAUDE_DIR;
  return c;
}
const config = loadConfig();
const DEMO = process.argv.includes('--demo') || process.env.HIVE_DEMO === '1';

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
      endedAt: 0, file: null, offset: 0, rest: null, msgs: [], todos: null, tasks: null, tasksSig: '', lastAt: 0,
      prog: cache[id] || null, dirty: false, summarizing: false, lastRun: 0 };
    sessions.set(id, s);
  }
  return s;
}

// Running sessions come from Claude Code's own registry: ~/.claude/sessions/<pid>.json
function scanRegistry() {
  let changed = false;
  const seen = new Set();
  for (const f of safeDir(REG)) {
    if (!f.endsWith('.json')) continue;
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(REG, f), 'utf8')); } catch { continue; }
    if (!r.sessionId || ownPids.has(r.pid) || !alive(r.pid)) continue;
    seen.add(r.sessionId);
    const s = session(r.sessionId);
    const next = { name: r.name || '', cwd: r.cwd || '', pid: r.pid, kind: r.kind || '', status: r.status || '',
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
    if (t) push(s, { role: 'agent', text: t, at });
    for (const b of c) {
      if (b.type !== 'tool_use') continue;
      s.pending = { id: b.id, name: b.name };
      const inp = b.input || {};
      if (b.name === 'TodoWrite' && Array.isArray(inp.todos))
        s.todos = inp.todos.map((t, i) => ({ id: String(i + 1), subject: t.content, activeForm: t.activeForm, status: t.status }));
      // Questions and plans are addressed to you, so they belong in the messages.
      if (b.name === 'AskUserQuestion' && Array.isArray(inp.questions))
        push(s, { role: 'agent', at, text: inp.questions.map(q => `**Question:** ${q.question}\n` +
          (q.options || []).map(o => `- ${o.label}${o.description ? `: ${o.description}` : ''}`).join('\n')).join('\n\n') });
      if (b.name === 'ExitPlanMode' && inp.plan) push(s, { role: 'agent', at, text: `**Plan for your approval:**\n\n${inp.plan}` });
    }
    return;
  }
  const answer = Array.isArray(c) && s.pending && c.find(b => b.type === 'tool_result' && b.tool_use_id === s.pending.id);
  if (answer) {
    if (s.pending.name === 'AskUserQuestion') {
      const a = typeof answer.content === 'string' ? answer.content : (answer.content || []).map(x => x.text || '').join('\n');
      const picks = [...a.matchAll(/"(?:[^"\\]|\\.)*"="((?:[^"\\]|\\.)*)"/g)].map(x => x[1]);
      const text = picks.length ? picks.join('\n') : a.trim();
      if (text) push(s, { role: 'you', kind: 'answer', at, text });
    }
    s.pending = null;
  }
  if (o.isMeta || o.isCompactSummary) return;
  let t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n\n') : '';
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!t || SKIP_USER.test(t) || t.startsWith('[Request interrupted')) return;
  const prev = s.msgs[s.msgs.length - 1];
  if (prev && prev.role === 'you' && !prev.kind && prev.text === t) return; // Claude Code logs some prompts twice
  push(s, { role: 'you', text: t, at });
}

function readNew(s) {
  if (!s.file) return false;
  let st;
  try { st = fs.statSync(s.file); } catch { return false; }
  if (st.size < s.offset) { s.offset = 0; s.rest = null; s.msgs = []; }
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
  const first = s.msgs.find(m => m.role === 'you');
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
  const parts = [];
  let used = 0;
  for (let i = s.msgs.length - 1; i >= 0 && used < SUMMARY_CHARS; i--) {
    const m = s.msgs[i];
    const cap = m.role === 'you' ? 1500 : s.msgs.length - i <= 6 ? 3000 : 280;
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
  const msgs = s.msgs.filter(m => m.at > start && m.at <= end);
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
  for (let i = s.msgs.length - 1; i >= 0; i--) if (s.msgs[i].role === 'agent') return /\?\s*$/.test(s.msgs[i].text.trim());
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
  for (let i = s.msgs.length - 1; i >= 0; i--) if (s.msgs[i].role === 'agent') { last = s.msgs[i]; break; }
  // Claude Code reports busy, idle (turn finished) or waiting (blocked on a question or permission).
  // Blocked always needs you; a finished turn needs you only if it asked for something.
  const state = !s.running ? 'closed' : s.status === 'waiting' ? 'waiting' : s.status === 'idle' ? (needsYou(s) ? 'waiting' : 'finished') : 'working';
  return { id: s.id, name: displayName(s), project: s.cwd ? path.basename(s.cwd) : '', cwd: s.cwd, state,
    startedAt: s.startedAt, endedAt: s.endedAt, lastAt: s.lastAt, stateSince: s.stateSince || s.lastAt, progress, tasks: tasks || [], last };
}

// A message is a turn's result when it's Claude's last word before your next prompt, or before the
// session stopped working.
function withFinal(s) {
  const working = summary(s).state === 'working';
  return s.msgs.map((m, i) => {
    if (m.role !== 'agent') return m;
    const next = s.msgs[i + 1];
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

// ---- Who may connect --------------------------------------------------------------------------
// Only answer to our own names, so a web page can't reach the transcripts through DNS rebinding.
// From other devices Hive is reached only through `tailscale serve`, as https://<machine>.<tailnet>.ts.net.
const HOSTS = /^(hive\.localhost|localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const TAILSCALE_BINS = process.platform === 'win32' ? ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe']
  : process.platform === 'darwin' ? ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'] : ['tailscale'];
let tsName = '';
function readTailscaleName() {
  if (tsName || !config.tailscale || DEMO) return;
  for (const bin of TAILSCALE_BINS) {
    try {
      const st = JSON.parse(execFileSync(bin, ['status', '--json'], { windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
      tsName = String((st.Self && st.Self.DNSName) || '').replace(/\.$/, '').toLowerCase();
      if (tsName) return;
    } catch {}
  }
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

function handle(req, res) {
  if (!hostOk(req.headers.host)) { res.writeHead(403); return res.end(); }
  const u = new URL(req.url, 'http://x');
  const st = STATIC[u.pathname];
  if (st) {
    res.writeHead(200, { 'content-type': st[1], 'cache-control': 'no-cache' });
    return fs.createReadStream(path.join(PUBLIC, st[0])).pipe(res);
  }
  if (u.pathname === '/api/state') return json(res, { version, demo: DEMO, secure: tsName ? 'https://' + tsName : '', sessions: list() });
  // hive.localhost asks this to see whether the secure Tailscale address is reachable before moving there.
  if (u.pathname === '/api/ping') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return res.end('{"ok":true}');
  }
  if (u.pathname === '/api/clips') return json(res, clips.map((c, id) => ({ id, name: c.name, label: c.label })));
  if (u.pathname.startsWith('/clip/')) {
    const c = clips[+u.pathname.slice(6)];
    if (!c) { res.writeHead(404); return res.end(); }
    return sendVideo(req, res, c.file);
  }
  if (u.pathname.startsWith('/api/session/')) {
    const s = sessions.get(decodeURIComponent(u.pathname.slice(13)));
    if (!s) { res.writeHead(404); return res.end(); }
    return json(res, { version, session: summary(s), msgs: withFinal(s) });
  }
  if (u.pathname === '/api/feed') {
    const all = [];
    for (const s of sessions.values()) {
      const name = displayName(s);
      for (const m of withFinal(s)) all.push({ ...m, sid: s.id, name });
    }
    all.sort((a, b) => a.at - b.at);
    return json(res, { version, msgs: all.slice(-400) });
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
if (DEMO) {
  // Made-up sessions that play out by themselves: for trying Hive and for the screenshots.
  require('./demo.cjs')({ session, sessions, bump });
} else {
  readTailscaleName();
  setInterval(readTailscaleName, 60e3);
  scanClosed();
  scanClips();
  setInterval(scanClips, 10 * 60e3);
  tick();
  setInterval(tick, 1000);
  setInterval(scanClosed, 60e3);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25e3);

const ports = [...new Set([config.port, ...(config.extraPorts || [])])];
for (const port of ports) for (const host of ['127.0.0.1', '::1']) {
  http.createServer(handle).on('error', e => { if (host === '127.0.0.1') console.log(`Hive could not listen on port ${port}: ${e.code}`); })
    .listen(port, host, () => { if (host === '127.0.0.1') console.log(`Hive${DEMO ? ' (demo)' : ''} on http://localhost:${port}${port === 80 ? ' and http://hive.localhost' : ''}`); });
}
