// Starts Hive in demo mode and checks the main routes, the host guard and that the page script parses.
// Run with `npm test`. Uses no settings file, so it behaves the same on every machine.
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');

const PORT = 4799;
const root = path.join(__dirname, '..');
const get = (p, host = 'localhost') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host } }, res => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});
const post = (p, body, headers = {}) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST',
    headers: { host: 'localhost', 'content-type': 'application/json', 'x-hive': '1', 'content-length': Buffer.byteLength(data), ...headers } }, res => {
    let b = '';
    res.on('data', d => b += d);
    res.on('end', () => resolve({ status: res.statusCode, body: b }));
  }).on('error', reject).end(data);
});
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'server.cjs'), '--demo'],
    { env: { ...process.env, PORT: String(PORT), HIVE_CONFIG: path.join(root, 'does-not-exist.json') }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await get('/api/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

    const page = await get('/');
    check(page.status === 200 && page.body.includes('<title>Hive</title>'), 'serves the board');
    const script = page.body.slice(page.body.lastIndexOf('<script>') + 8, page.body.lastIndexOf('</script>'));
    try { new Function(script); check(true, 'page script parses'); } catch (e) { check(false, `page script parses (${e.message})`); }

    const state = JSON.parse((await get('/api/state')).body);
    check(state.demo === true && state.sessions.length === 4, 'demo has four sessions');
    check(state.sessions.some(s => s.state === 'waiting') && state.sessions.some(s => s.state === 'working') && state.sessions.some(s => s.state === 'finished'),
      'sessions are grouped as needs you, working and finished');

    const one = JSON.parse((await get('/api/session/demo-auth')).body);
    check(one.session.progress.steps.length > 0 && one.session.progress.brief && one.session.progress.history.length > 0,
      'a session has steps, a briefing and earlier jobs');
    const done = JSON.parse((await get('/api/session/demo-perf')).body);
    check(one.msgs.some(m => m.role === 'you') && done.msgs.some(m => m.final), 'a session has its messages, with the turn results marked');
    check((await get('/api/feed')).status === 404, 'the old all-sessions feed is gone');
    check((await get('/api/session/nope')).status === 404, 'unknown session is 404');

    check(state.canLaunch === false && (await get('/api/recent')).body === '[]', 'demo mode never launches anything');
    check((await post('/api/routine', { name: 'Work' })).status === 403, 'demo mode refuses routines');

    check((await get('/', 'evil.example')).status === 403, 'other host names are refused');
    check((await get('/', 'hive.localhost')).status === 200, 'hive.localhost is accepted');

    for (const f of fs.readdirSync(path.join(root, 'public'))) check(fs.statSync(path.join(root, 'public', f)).size > 0, `public/${f} is not empty`);
  } catch (e) {
    check(false, e.message);
  } finally {
    server.kill();
  }

  // A real (made-up) Claude Code folder: this test process plays the running session, and its transcript has
  // a prompt that was escaped and edited, then a rewind. Only the branch you're on may show, like in Claude Code.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-test-'));
  const claudeDir = path.join(tmp, 'claude'), proj = path.join(claudeDir, 'projects', '-work-shop');
  fs.mkdirSync(path.join(claudeDir, 'sessions'), { recursive: true });
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({
    pid: process.pid, sessionId: 'branchy', cwd: '/work/shop', name: 'branchy', status: 'idle', startedAt: Date.now() - 60e3, statusUpdatedAt: Date.now() }));
  let t = Date.now() - 50e3;
  const entry = (uuid, parentUuid, type, content) => JSON.stringify({ uuid, parentUuid, type, cwd: '/work/shop', timestamp: new Date(t += 1000).toISOString(),
    message: { role: type, content: type === 'assistant' ? [{ type: 'text', text: content }] : content } });
  fs.writeFileSync(path.join(proj, 'branchy.jsonl'), [
    entry('u1', null, 'user', 'Add a dark mode'),
    entry('a1', 'u1', 'assistant', 'Dark mode added.'),
    entry('u2', 'a1', 'user', 'now make the buttons rond'),          // sent, then Esc and edited
    entry('u3', 'a1', 'user', 'now make the buttons round'),
    entry('a3', 'u3', 'assistant', 'Buttons are round now.'),
    entry('u4', 'a3', 'user', 'and make them pink'),                 // later rewound away
    entry('a4', 'u4', 'assistant', 'Pink buttons done.'),
    JSON.stringify({ type: 'last-prompt', leafUuid: 'a3' }),          // the rewind back to a3
  ].join('\n') + '\n');
  const cfg = path.join(tmp, 'hive.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ claudeDir, dataDir: path.join(tmp, 'data'), summaries: { enabled: false }, tailscale: false,
    routines: [{ name: 'Check', steps: [{ label: 'Say hi', run: 'node -e "process.exit(0)"' }, { label: 'Folder', open: tmp, cwd: tmp, unlessRunning: path.basename(process.execPath) }] }] }));

  // The command-line form: --dry-run only checks that every path in the routine exists.
  const cli = (...args) => new Promise(r => spawn(process.execPath, [path.join(root, 'server.cjs'), '--routine', ...args],
    { env: { ...process.env, PORT: String(PORT), HIVE_CONFIG: cfg }, stdio: 'ignore' }).on('close', r));
  check(await cli('Check', '--dry-run') === 0 && await cli('Nope', '--dry-run') === 1, 'a routine can be checked from the command line');

  const real = spawn(process.execPath, [path.join(root, 'server.cjs')], { env: { ...process.env, PORT: String(PORT), HIVE_CONFIG: cfg }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await get('/api/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    await new Promise(r => setTimeout(r, 1500));
    const st = JSON.parse((await get('/api/state')).body);
    check(st.sessions.some(s => s.id === 'branchy' && s.state !== 'closed'), 'a running session is read from the Claude Code folder');
    const texts = JSON.parse((await get('/api/session/branchy')).body).msgs.map(m => m.text);
    check(texts.join('|') === 'Add a dark mode|Dark mode added.|now make the buttons round|Buttons are round now.',
      `only the branch you're on shows, after an edit and a rewind (got: ${texts.join(' | ')})`);

    // Resume and routines: only from this computer, only as a JSON POST with Hive's own header.
    check(st.canLaunch === true && st.routines[0].name === 'Check', 'this computer may launch, and sees its routines');
    const recent = JSON.parse((await get('/api/recent')).body);
    check(recent.length === 1 && recent[0].id === 'branchy' && recent[0].running && recent[0].project === 'shop', 'recent sessions come from the transcripts');
    check(JSON.parse((await post('/api/resume', { id: 'branchy' })).body).error === 'That session is already running.', 'a running session is not opened twice');
    check(JSON.parse((await post('/api/resume', { id: 'nope' })).body).ok === false, 'only listed sessions can be resumed');
    check((await post('/api/routine', { name: 'Check' }, { 'x-hive': '' })).status === 403, 'a POST without our header is refused');
    check((await post('/api/routine', { name: 'Check' }, { origin: 'https://evil.example' })).status === 403, 'a POST from another website is refused');
    check((await post('/api/routine', { name: 'Check' }, { 'x-forwarded-for': '100.64.0.9' })).status === 403, 'other devices on the tailnet may not launch');
    check(JSON.parse((await get('/api/state', 'localhost')).body).canLaunch === true, 'still allowed here');
    check(JSON.parse((await post('/api/routine', { name: 'Nope' })).body).ok === false, 'an unknown routine is an error');
    check(JSON.parse((await post('/api/routine', { name: 'Check' })).body).ok === true, 'a routine starts');
    let rt = {};
    for (let i = 0; i < 100 && !rt.doneAt; i++) { await new Promise(r => setTimeout(r, 100)); rt = JSON.parse((await get('/api/state')).body).routine; }
    check(rt.doneAt && !rt.error && rt.step === 2, `the routine runs to the end (${rt.error || rt.label})`);
  } catch (e) {
    check(false, e.message);
  } finally {
    real.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
