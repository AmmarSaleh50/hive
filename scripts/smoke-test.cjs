// Starts Hive in demo mode and checks the main routes, the host guard and that the page script parses.
// Run with `npm test`. Uses no settings file, so it behaves the same on every machine.
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');

const PORT = 4799;
const root = path.join(__dirname, '..');
const get = (p, host = 'localhost') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host } }, res => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
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
    check(!('msgs' in one), 'the page is not sent the raw messages');
    check((await get('/api/session/nope')).status === 404, 'unknown session is 404');

    check((await get('/', 'evil.example')).status === 403, 'other host names are refused');
    check((await get('/', 'hive.localhost')).status === 200, 'hive.localhost is accepted');

    for (const f of fs.readdirSync(path.join(root, 'public'))) check(fs.statSync(path.join(root, 'public', f)).size > 0, `public/${f} is not empty`);
  } catch (e) {
    check(false, e.message);
  } finally {
    server.kill();
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
