// Takes the README screenshots and the demo GIF from demo mode, so they never contain anyone's real sessions.
// Needs Playwright (`npx playwright install chromium`) and ffmpeg for the GIF.
//   node scripts/capture-docs.cjs
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium, devices } = require('playwright');

const root = path.join(__dirname, '..'), out = path.join(root, 'docs', 'screenshots');
const PORT = 4798, base = `http://localhost:${PORT}`;
fs.mkdirSync(out, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

function startDemo() {
  return spawn(process.execPath, [path.join(root, 'server.cjs'), '--demo'],
    { env: { ...process.env, PORT: String(PORT), HIVE_CONFIG: path.join(root, 'does-not-exist.json') }, stdio: 'ignore' });
}
const still = p => p.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });

(async () => {
  let server = startDemo();
  await wait(1200);
  const b = await chromium.launch({ args: ['--mute-audio'] });

  // Desktop stills (Hive draws itself at 150% on computers).
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(base + '/'); await p.waitForTimeout(1500); await still(p);
  await p.screenshot({ path: path.join(out, 'board.png') });
  await p.goto(base + '/#s/demo-auth'); await p.waitForTimeout(1500); await still(p);
  await p.screenshot({ path: path.join(out, 'session.png') });
  await p.goto(base + '/#s/demo-perf'); await p.waitForTimeout(1200);
  await p.click('.vtitle .sumbtn'); await p.waitForTimeout(1200); await still(p);
  await (await p.$('dialog')).screenshot({ path: path.join(out, 'briefing.png') });
  await p.keyboard.press('Escape');
  await p.goto(base + '/#feed'); await p.waitForTimeout(1500); await still(p);
  await p.screenshot({ path: path.join(out, 'timeline.png') });
  await p.close();

  // The Stimulation player over the board, one shot per built-in channel.
  for (const [channel, file] of [['subway', 'stimulation-subway.png'], ['parkour', 'stimulation-parkour.png']]) {
    const s = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await s.addInitScript(([ch]) => {
      localStorage.setItem('hive.stim.open', 'true'); localStorage.setItem('hive.stim.channel', JSON.stringify(ch));
      localStorage.setItem('hive.stim.rect', JSON.stringify({ x: 760, y: 330, w: 640, h: 370 }));
    }, [channel]);
    await s.goto(base + '/'); await s.waitForTimeout(8000);
    await s.mouse.move(1080, 515); await s.waitForTimeout(600); // hover: the icon bar appears above the player
    await s.screenshot({ path: path.join(out, file) });
    await s.close();
  }

  // Phone stills.
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  const ctx = await b.newContext(iphone), m = await ctx.newPage();
  await m.goto(base + '/'); await m.waitForTimeout(1500); await still(m);
  await m.screenshot({ path: path.join(out, 'phone-board.png') });
  await m.goto(base + '/#s/demo-docs'); await m.waitForTimeout(1500); await still(m);
  await m.screenshot({ path: path.join(out, 'phone-session.png') });
  await ctx.close();
  console.log('stills done');

  // The GIF: a fresh demo, the board updating live, then a briefing opened.
  server.kill(); server = startDemo(); await wait(800);
  const g = await b.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  await g.goto(base + '/'); await g.waitForTimeout(800);
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-gif-'));
  let n = 0;
  const grab = async (ms, every = 250) => { for (let t = 0; t < ms; t += every) { await g.screenshot({ path: path.join(frames, `f${String(n++).padStart(4, '0')}.png`) }); await wait(every); } };
  await grab(23000);
  await g.click('.row.finished .sumbtn').catch(() => g.click('.sumbtn'));
  await grab(4000);
  await b.close();
  server.kill();

  const gif = path.join(out, 'demo.gif');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '4', '-i', path.join(frames, 'f%04d.png'),
    '-vf', 'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none', gif]);
  fs.rmSync(frames, { recursive: true, force: true });
  console.log('gif done', (fs.statSync(gif).size / 1e6).toFixed(1), 'MB');
})();
