// build/fetch-fonts.mjs — self-host the app's Google Fonts (one-off; re-run to
// refresh). Run: node build/fetch-fonts.mjs
//
// Why: the Google Fonts stylesheet was render-blocking on a third-party origin
// (fonts.googleapis.com), and the woff2 files then came from a second one
// (fonts.gstatic.com) — two extra connections before any text could paint.
// Served from our own origin they share the page's connection, get a long
// immutable cache, and the service worker keeps them for offline use.
//
// Only what the UI actually uses: Heebo 400–800 (variable — one file per
// subset covers every weight) and Frank Ruhl Libre 800 (the display face).
// The browser downloads a subset only when the page uses a glyph in its
// unicode-range, exactly as with Google's CSS.
//
// Outputs: web/fonts/*.woff2 and web/fonts/fonts.css (the @font-face rules,
// which are pasted inline into web/index.html's <style> so they cost no
// extra request).

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web', 'fonts');
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800'
  + '&family=Frank+Ruhl+Libre:wght@800&display=swap';
// A modern UA, or Google serves legacy formats instead of woff2.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();

// /* subset */ @font-face { family, style, weight, display, src, unicode-range }
const faces = [...css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face \{([^}]*)\}/g)].map(([, subset, body]) => ({
  subset,
  family: /font-family: '([^']+)'/.exec(body)[1],
  weight: +/font-weight: (\d+)/.exec(body)[1],
  url: /src: url\(([^)]+)\)/.exec(body)[1],
  range: /unicode-range: ([^;]+);/.exec(body)[1],
}));

// Collapse identical files (Heebo's weights share one variable file) into one
// rule with a weight range.
const byUrl = new Map();
for (const f of faces) {
  const cur = byUrl.get(f.url);
  if (cur) { cur.min = Math.min(cur.min, f.weight); cur.max = Math.max(cur.max, f.weight); }
  else byUrl.set(f.url, { ...f, min: f.weight, max: f.weight });
}

mkdirSync(OUT, { recursive: true });
const version = (url) => (/\/(v\d+)\//.exec(url) || [, 'v0'])[1];
const rules = [];
for (const f of byUrl.values()) {
  const name = `${f.family.toLowerCase().replace(/\s+/g, '-')}-${version(f.url)}-${f.subset}`
    + (f.min === f.max ? `-${f.min}` : '') + '.woff2';
  const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
  writeFileSync(join(OUT, name), buf);
  console.log(`  ${name}  ${(buf.length / 1024).toFixed(1)} KB`);
  rules.push(`@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.min === f.max ? f.min : f.min + ' ' + f.max};`
    + `font-display:swap;src:url(/fonts/${name}) format('woff2');unicode-range:${f.range}}`);
}
writeFileSync(join(OUT, 'fonts.css'), rules.join('\n') + '\n');
console.log(`wrote ${rules.length} @font-face rules → web/fonts/fonts.css`);
