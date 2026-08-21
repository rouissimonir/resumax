/**
 * Render each .frame to a 1290 x 2796 PNG (iPhone 6.9", App Store).
 *
 * The frames are authored at 430 x 932 CSS px — exactly one third of the target
 * — so rendering at deviceScaleFactor 3 rasterises straight to the required
 * size with no resampling and no soft edges.
 *
 * The Tailwind Play CDN and Google Fonts are swapped for a locally compiled
 * stylesheet and embedded Inter before rendering, so the export is byte-stable
 * and does not depend on the network being up at capture time.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = __dirname;
const SRC = path.join(DIR, 'resumax-store-screenshots.html');
const OUT = path.join(DIR, 'out');

const WEIGHTS = [400, 500, 600, 700, 800];

function fontFaces() {
  return WEIGHTS.map((w) => {
    const f = path.join(DIR, 'node_modules/@fontsource/inter/files',
                        `inter-latin-${w}-normal.woff2`);
    const b64 = fs.readFileSync(f).toString('base64');
    return `@font-face{font-family:'Inter';font-style:normal;font-weight:${w};` +
           `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  }).join('\n');
}

/** Replace the CDN/remote-font dependencies with inlined equivalents. */
function buildExportHtml({ inlineImages = false } = {}) {
  let html = fs.readFileSync(SRC, 'utf8');
  const css = fs.readFileSync(path.join(DIR, 'tw.css'), 'utf8');

  html = html.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/,
                      `<style>${css}</style>\n<style>${fontFaces()}</style>`);
  html = html.replace(/<link rel="preconnect"[\s\S]*?rel="stylesheet">/, '');
  html = html.replace(/<script>\s*tailwind\.config[\s\S]*?<\/script>/, '');

  if (inlineImages) {
    for (const name of ['f1_screen.jpg', 'home.jpg',
                        'f3_screen.jpg', 'f4_screen.jpg']) {
      const b64 = fs.readFileSync(path.join(DIR, name)).toString('base64');
      html = html.split(`src="${name}"`).join(`src="data:image/jpeg;base64,${b64}"`);
    }
  }
  return html;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const exportHtml = buildExportHtml();
  const tmp = path.join(DIR, '.export.html');
  fs.writeFileSync(tmp, exportHtml);

  // The self-contained variant is useful on its own — it opens anywhere,
  // offline, with no CDN or loose image files beside it.
  fs.writeFileSync(path.join(DIR, 'resumax-store-screenshots.standalone.html'),
                   buildExportHtml({ inlineImages: true }));

  const browser = await chromium.launch();

  // Capture the VIEWPORT, not the element. An element screenshot inherits the
  // element's fractional x-offset from the centred grid, and 430 CSS px
  // straddling a half-pixel boundary rasterises to 1293 device px, not 1290 —
  // three pixels over the size App Store Connect will accept. Sizing the
  // viewport to exactly one frame and lifting that frame to the origin makes
  // the output dimensions exact by construction.
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
  });

  const names = ['01-ats-score', '02-upload', '03-formats', '04-global'];
  for (let i = 0; i < 4; i++) {
    const id = `frame-${i + 1}`;
    await page.goto('file://' + tmp);
    await page.evaluate((frameId) => {
      document.body.classList.add('export');
      const el = document.getElementById(frameId);
      el.remove();
      document.body.replaceChildren(el);
      document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#0A0B0E;';
      el.style.margin = '0';
    }, id);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${names[i]}.png`) });
    console.log(`${names[i]}.png`);
  }

  await browser.close();
  fs.unlinkSync(tmp);
  console.log('\nRendered to out/. Flatten to RGB before uploading.');
})();
