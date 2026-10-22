// Rebuilds docs/brand and the app icons in public/ from the honeycomb mark below.
// Needs Playwright (`npx playwright install chromium`); the wordmark uses the Unbounded font from Google Fonts.
//   node scripts/build-brand.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..'), brand = path.join(root, 'docs', 'brand');
const HONEY = '#f5b700', HONEY_ON_LIGHT = '#d99c00', INK = '#050506', PAPER = '#ffffff';

// Three cells of a honeycomb: two filled, one still open.
const mark = color => `<polygon points="17,9 13.5,15.06 6.5,15.06 3,9 6.5,2.94 13.5,2.94" fill="${color}"/>
  <polygon points="29.12,16 25.62,22.06 18.62,22.06 15.12,16 18.62,9.94 25.62,9.94" fill="${color}"/>
  <polygon points="16.2,23 13.1,28.36 6.9,28.36 3.8,23 6.9,17.64 13.1,17.64" fill="none" stroke="${color}" stroke-width="1.6"/>`;
const svg = (color, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${bg ? `<rect width="32" height="32" rx="7" fill="${bg}"/>
  <g transform="translate(4.2 4.2) scale(0.74)">${mark(color)}</g>` : mark(color)}</svg>\n`;

fs.mkdirSync(path.join(brand, 'mark'), { recursive: true });
fs.mkdirSync(path.join(brand, 'wordmark'), { recursive: true });
fs.mkdirSync(path.join(brand, 'raster'), { recursive: true });
fs.writeFileSync(path.join(brand, 'mark', 'on-dark.svg'), svg(HONEY));
fs.writeFileSync(path.join(brand, 'mark', 'on-light.svg'), svg(HONEY_ON_LIGHT));
fs.writeFileSync(path.join(brand, 'mark', 'card-dark.svg'), svg(HONEY, INK));
fs.writeFileSync(path.join(brand, 'mark', 'card-light.svg'), svg(HONEY_ON_LIGHT, PAPER));
fs.writeFileSync(path.join(root, 'public', 'logo.svg'), svg(HONEY));

const FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600&family=Geist:wght@500&display=swap">';
(async () => {
  const b = await chromium.launch();
  const shot = async (file, w, h, html, transparent = false) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<html><head>${FONT}</head><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden">${html}</body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    await p.screenshot({ path: file, omitBackground: transparent });
    await p.close();
    console.log('wrote', path.relative(root, file));
  };
  const centred = (size, bg, color, scale = 0.62) => `<div style="width:${size}px;height:${size}px;background:${bg};display:grid;place-items:center">
    <div style="width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px">${svg(color).replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>`;
  const word = (color, text) => `<div style="display:flex;align-items:center;gap:34px;padding:24px 40px;height:100%;box-sizing:border-box">
    <div style="width:150px;height:150px">${svg(color).replace('<svg ', '<svg width="100%" height="100%" ')}</div>
    <span style="font:600 132px/1 Unbounded, sans-serif;letter-spacing:-2px;color:${text}">hive</span></div>`;

  // Wordmarks are PNG: GitHub doesn't load web fonts inside SVG images.
  await shot(path.join(brand, 'wordmark', 'on-dark.png'), 640, 200, word(HONEY, '#ffffff'), true);
  await shot(path.join(brand, 'wordmark', 'on-light.png'), 640, 200, word(HONEY_ON_LIGHT, INK), true);
  for (const s of [64, 180, 256, 512]) await shot(path.join(brand, 'raster', `mark-${s}.png`), s, s, centred(s, INK, HONEY));
  for (const s of [16, 32]) await shot(path.join(brand, 'raster', `favicon-${s}.png`), s, s, centred(s, INK, HONEY, 0.9));
  await shot(path.join(brand, 'raster', 'org-avatar.png'), 500, 500, centred(500, INK, HONEY, 0.6));
  // App icons served by Hive itself (iPhones ignore SVG icons on the home screen).
  await shot(path.join(root, 'public', 'apple-touch-icon.png'), 180, 180, centred(180, INK, HONEY));
  await shot(path.join(root, 'public', 'icon-192.png'), 192, 192, centred(192, INK, HONEY));
  await shot(path.join(root, 'public', 'icon-512.png'), 512, 512, centred(512, INK, HONEY));
  await shot(path.join(root, 'public', 'icon-maskable-512.png'), 512, 512, centred(512, INK, HONEY, 0.5));
  // GitHub social preview (Settings > General > Social preview): 1280x640.
  await shot(path.join(brand, 'raster', 'social-preview.png'), 1280, 640, `<div style="width:1280px;height:640px;background:${INK};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px">
    <div style="display:flex;align-items:center;gap:40px"><div style="width:190px;height:190px">${svg(HONEY).replace('<svg ', '<svg width="100%" height="100%" ')}</div>
    <span style="font:600 170px/1 Unbounded, sans-serif;letter-spacing:-3px;color:#fff">hive</span></div>
    <div style="font:500 38px/1.3 Geist, sans-serif;color:#fff;text-align:center">Every Claude Code session on one live board</div></div>`);
  await b.close();
})();
