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
  // Sent to the background (/bg): the conversation moved on to "branchy", and the old file says so. A second one was
  // talked to again afterwards, so it is a conversation of its own.
  fs.writeFileSync(path.join(proj, 'moved-away.jsonl'), [entry('m1', null, 'user', 'Start the shop'), entry('m2', 'm1', 'assistant', 'Started.'),
    JSON.stringify({ type: 'continued-in', sessionId: 'moved-away', continuedInSessionId: 'branchy' })].join('\n') + '\n');
  fs.writeFileSync(path.join(proj, 'went-on.jsonl'), [entry('w1', null, 'user', 'Plan the shop'), entry('w2', 'w1', 'assistant', 'Planned.'),
    JSON.stringify({ type: 'continued-in', sessionId: 'went-on', continuedInSessionId: 'branchy' }), entry('w3', 'w2', 'user', 'one more thing')].join('\n') + '\n');
  // Moved by /bg: the new session's file starts with file snapshots (here 330 KB) before its first message.
  const snap = JSON.stringify({ type: 'file-history-snapshot', snapshot: { trackedFileBackups: { pad: 'x'.repeat(11000) } } });
  fs.writeFileSync(path.join(proj, 'late-start.jsonl'), [JSON.stringify({ type: 'custom-title', customTitle: 'late start' }), ...Array(30).fill(snap),
    entry('l1', null, 'user', 'Where were we'), entry('l2', 'l1', 'assistant', 'At the shop.')].join('\n') + '\n');
  const cfg = path.join(tmp, 'hive.config.json');
  const ws = path.join(tmp, 'ws'); // a workspace with two folders and no sessions yet
  for (const d of ['alpha', 'beta']) fs.mkdirSync(path.join(ws, d), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({ claudeDir, dataDir: path.join(tmp, 'data'), summaries: { enabled: false }, tailscale: false, workspace: ws,
    routines: [{ name: 'Check', steps: [{ label: 'Say hi', run: 'node -e "process.exit(0)"' }, { label: 'Node', open: process.execPath, args: ['-e', ''], cwd: tmp, unlessRunning: path.basename(process.execPath) }] },
      { name: 'Broken', steps: [{ label: 'Bad app', open: path.join(tmp, 'no-such-app') }] }] }));

  // The command-line form: --dry-run only checks that every path in the routine exists.
  const cli = (...args) => new Promise(r => spawn(process.execPath, [path.join(root, 'server.cjs'), '--routine', ...args],
    { env: { ...process.env, PORT: String(PORT), HIVE_CONFIG: cfg }, stdio: 'ignore' }).on('close', r));
  check(await cli('Check', '--dry-run') === 0 && await cli('Broken', '--dry-run') === 1 && await cli('Nope', '--dry-run') === 1,
    'a routine can be checked from the command line');

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
    const rb = recent.find(s => s.id === 'branchy');
    check(rb && rb.running && rb.project === 'shop', 'recent sessions come from the transcripts');
    check(!recent.some(s => s.id === 'moved-away') && recent.some(s => s.id === 'went-on'),
      'a session whose conversation moved on (/bg) is left out, unless it was talked to again afterwards');
    check(recent.some(s => s.id === 'late-start' && s.name === 'late start'), 'a session whose first message comes after hundreds of KB of file snapshots is listed');
    check(JSON.parse((await post('/api/resume', { id: 'branchy' })).body).error === 'That session is already running.', 'a running session is not opened twice');
    check(JSON.parse((await post('/api/resume', { id: 'moved-away' })).body).error === 'That session is already running.', 'resuming a moved session goes to where it lives now');
    check(JSON.parse((await post('/api/resume', { id: 'nope' })).body).ok === false, 'only listed sessions can be resumed');

    // Folders: every folder in the workspace, sessions elsewhere under "other"; new folders by name only.
    const fl = JSON.parse((await get('/api/folders')).body);
    check(['alpha', 'beta'].every(n => fl.folders.some(f => f.name === n && f.inWorkspace && f.sessions.length === 0))
      && fl.folders.some(f => !f.inWorkspace && f.sessions.some(s => s.id === 'branchy')), 'Folders lists every workspace folder, other sessions apart');
    const made = JSON.parse((await post('/api/mkdir', { name: 'gamma' })).body);
    check(made.ok && fs.existsSync(path.join(ws, 'gamma')) && JSON.parse((await get('/api/folders')).body).folders.some(f => f.name === 'gamma'), 'a new folder is made in the workspace');
    const refused = await Promise.all([{ name: '../outside' }, { name: 'gamma' }, { name: 'a/b' }, { name: '..' }].map(async b => JSON.parse((await post('/api/mkdir', b)).body).ok));
    check(refused.every(ok => !ok) && !fs.existsSync(path.join(tmp, 'outside')), 'folder names with paths, dots or duplicates are refused');
    const bad = await Promise.all([{}, { folder: '' }, { folder: 'alpha' }, { folder: tmp }, { folder: os.homedir() }].map(async b => JSON.parse((await post('/api/new', b)).body).ok));
    check(bad.every(ok => !ok), 'new sessions only start in a listed folder');

    // Search inside conversations: words must all be there, -words must not.
    let sr = {};
    for (let i = 0; i < 50 && !sr.ready; i++) { await new Promise(r => setTimeout(r, 200)); sr = JSON.parse((await get('/api/search?q=' + encodeURIComponent('buttons ROUND'))).body); }
    const hit = (sr.results || []).find(x => x.id === 'branchy');
    check(sr.ready && hit && /round/i.test(hit.snippet), `search finds what was said in a session (${JSON.stringify(hit || sr)})`);
    const none = JSON.parse((await get('/api/search?q=' + encodeURIComponent('buttons -dark'))).body).results.find(x => x.id === 'branchy');
    check(!none, 'a -word leaves out sessions that contain it');
    check((await post('/api/routine', { name: 'Check' }, { 'x-hive': '' })).status === 403, 'a POST without our header is refused');
    check((await post('/api/routine', { name: 'Check' }, { origin: 'https://evil.example' })).status === 403, 'a POST from another website is refused');
    check((await post('/api/routine', { name: 'Check' }, { 'x-forwarded-for': '100.64.0.9' })).status === 403, 'other devices on the tailnet may not launch');
    check(JSON.parse((await get('/api/state', 'localhost')).body).canLaunch === true, 'still allowed here');
    check(JSON.parse((await post('/api/routine', { name: 'Nope' })).body).ok === false, 'an unknown routine is an error');
    check(JSON.parse((await post('/api/routine', { name: 'Check' })).body).ok === true, 'a routine starts');
    let rt = {};
    for (let i = 0; i < 100 && !rt.doneAt; i++) { await new Promise(r => setTimeout(r, 100)); rt = JSON.parse((await get('/api/state')).body).routine; }
    check(rt.doneAt && !rt.error && rt.step === 2, `the routine runs to the end (${rt.error || rt.label})`);
    await post('/api/routine', { name: 'Broken' });
    rt = {};
    for (let i = 0; i < 100 && !rt.doneAt; i++) { await new Promise(r => setTimeout(r, 100)); rt = JSON.parse((await get('/api/state')).body).routine; }
    check(rt.name === 'Broken' && rt.error.startsWith('Bad app'), `an app that can't start stops the routine with a message (${rt.error})`);
    check((await get('/api/ping')).status === 200, 'and Hive keeps running');
  } catch (e) {
    check(false, e.message);
  } finally {
    real.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Two computers: "4070" switches to "2060", which has a running session (a stand-in process) and a background one.
  const A = 4797, B = 4798, at = port => (p, host = 'localhost') => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { host } }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject);
  });
  const postAt = (port, p, body, headers = {}) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json', 'x-hive': '1', 'content-length': Buffer.byteLength(data), ...headers } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject).end(data);
  });
  const getA = at(A), getB = at(B);
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-test-'));
  const standIn = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120e3)'], { stdio: 'ignore' });
  const bg = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120e3)'], { stdio: 'ignore' });
  const dirB = path.join(tmp2, 'b'), projB = path.join(dirB, 'projects', '-far-away');
  for (const d of [path.join(dirB, 'sessions'), projB, path.join(dirB, 'daemon'), path.join(dirB, 'jobs', 'bbbbbbbb')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dirB, 'sessions', `${standIn.pid}.json`), JSON.stringify({ pid: standIn.pid, sessionId: 'far-session', cwd: '/far/away', name: 'far', status: 'busy', startedAt: Date.now() }));
  // Real background sessions register as kind "bg" too, with a different pid than the roster's worker.
  fs.writeFileSync(path.join(dirB, 'sessions', `${bg.pid}.json`), JSON.stringify({ pid: bg.pid, sessionId: 'bbbbbbbb-bg', cwd: '/far/away', name: 'deploy', kind: 'bg', jobId: 'bbbbbbbb', status: 'waiting', startedAt: Date.now() }));
  fs.writeFileSync(path.join(dirB, 'daemon', 'roster.json'), JSON.stringify({ supervisorPid: bg.pid, workers: { bbbbbbbb: { pid: bg.pid, sessionId: 'bbbbbbbb-bg', cwd: '/far/away' } } }));
  fs.writeFileSync(path.join(dirB, 'jobs', 'bbbbbbbb', 'state.json'), JSON.stringify({ state: 'blocked', tempo: 'blocked', needs: 'approve a command', name: 'deploy' }));
  for (const id of ['far-session', 'bbbbbbbb-bg']) fs.writeFileSync(path.join(projB, id + '.jsonl'),
    JSON.stringify({ uuid: id + '1', parentUuid: null, type: 'user', cwd: '/far/away', timestamp: new Date().toISOString(), message: { role: 'user', content: 'Ship it' } }) + '\n');
  // far-session after the prompt: a tool call, a progress update (written-out thinking marked "updates"), private
  // thinking (not marked, never shown), then a tool call it's still on.
  const farAt = n => new Date(Date.now() + n * 1000).toISOString();
  const tool = (n, parent, description) => ({ uuid: 'far-a' + n, parentUuid: parent, type: 'assistant', cwd: '/far/away', timestamp: farAt(n),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't' + n, name: 'Bash', input: { command: 'deploy.sh', description } }] } });
  fs.appendFileSync(path.join(projB, 'far-session.jsonl'), [
    tool(1, 'far-session1', 'Build the image'),
    { uuid: 'far-u', parentUuid: 'far-a1', type: 'assistant', cwd: '/far/away', timestamp: farAt(2), thinkingDisplay: 'updates',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Image built, deploying it now.' }] } },
    { uuid: 'far-p', parentUuid: 'far-u', type: 'assistant', cwd: '/far/away', timestamp: farAt(3),
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private reasoning' }] } },
    tool(4, 'far-p', 'Deploy to production'),
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  const cfgA = path.join(tmp2, 'a.json'), cfgB = path.join(tmp2, 'b.json');
  fs.writeFileSync(cfgB, JSON.stringify({ machine: '2060', claudeDir: dirB, dataDir: path.join(tmp2, 'db'), summaries: { enabled: false }, tailscale: false, launchFrom: 'my-devices' }));
  fs.writeFileSync(cfgA, JSON.stringify({ machine: '4070', claudeDir: path.join(tmp2, 'a'), dataDir: path.join(tmp2, 'da'), summaries: { enabled: false }, tailscale: false,
    peers: [{ name: '2060', url: `http://localhost:${B}` }] }));
  const start = (cfg, port) => spawn(process.execPath, [path.join(root, 'server.cjs')], { env: { ...process.env, PORT: String(port), HIVE_CONFIG: cfg }, stdio: 'ignore' });
  // "4070" starts first, so its first look at "2060" finds it off.
  const ha = start(cfgA, A);
  let hb = null;
  try {
    for (let i = 0; i < 50; i++) { try { await getA('/api/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    await new Promise(r => setTimeout(r, 500));
    hb = start(cfgB, B);
    for (let i = 0; i < 50; i++) { try { await getB('/api/ping'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    await new Promise(r => setTimeout(r, 1500)); // let "2060" read its folder
    // Asking for the other computer looks again at once, even if "4070" started before "2060" was up.
    await getA('/api/state?m=2060');
    let sa = JSON.parse((await getA('/api/state')).body);
    check(sa.machine === '4070' && sa.machines.map(x => x.name + (x.online ? '' : ' off')).join(',') === '2060,4070', `the switch lists both computers (${sa.machines.map(x => x.name + (x.online ? '' : ' off')).join(',')})`);
    const far = JSON.parse((await getA('/api/state?m=2060')).body);
    check(far.view === '2060' && far.sessions.some(s => s.id === 'far-session' && s.state === 'working'), "switching shows the other computer's sessions");
    const bgs = far.sessions.find(s => s.id === 'bbbbbbbb-bg');
    check(bgs && bgs.background && bgs.state === 'waiting' && bgs.name === 'deploy', 'background sessions show, blocked ones as needing you');
    check(JSON.parse((await getA('/api/session/far-session?m=2060')).body).msgs.some(x => x.text === 'Ship it'), "its session pages open from here");
    const farPage = JSON.parse((await getA('/api/session/far-session?m=2060')).body), quiet = farPage.session.activity || {};
    check(farPage.msgs.some(x => x.text === 'Image built, deploying it now.') && !farPage.msgs.some(x => x.text === 'private reasoning'),
      'progress updates show like messages; private thinking does not');
    check(quiet.count === 1 && quiet.now === 'Deploy to production' && !quiet.afterYou, `a session working without a word shows what it's doing (${JSON.stringify(quiet)})`);
    check(JSON.parse((await getA('/api/recent?m=2060')).body).some(s => s.id === 'far-session' && s.running), 'and its Resume list');
    check((await getA('/api/state?m=nowhere')).status === 404, 'an unknown computer is 404');
    check((await postAt(B, '/api/end', { id: 'far-session' }, { 'x-forwarded-for': '100.64.0.9', 'tailscale-user-login': 'someone@example.com' })).status === 403,
      'a made-up Tailscale identity is not one of your devices');
    const ended = JSON.parse((await postAt(A, '/api/end?m=2060', { id: 'far-session' })).body);
    await new Promise(r => setTimeout(r, 1500));
    check(ended.ok && (standIn.exitCode !== null || standIn.signalCode !== null), `End session ends it on the other computer (${ended.error || 'ok'})`);
    hb.kill();
    let off = false;
    for (let i = 0; i < 30 && !off; i++) { await new Promise(r => setTimeout(r, 500)); off = JSON.parse((await getA('/api/state?m=2060')).body).offline === true; }
    sa = JSON.parse((await getA('/api/state')).body);
    check(off && sa.machines.find(x => x.name === '2060').online === false, 'a computer that goes off shows as off');
  } catch (e) {
    check(false, e.message);
  } finally {
    ha.kill(); if (hb) hb.kill(); standIn.kill(); bg.kill();
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
