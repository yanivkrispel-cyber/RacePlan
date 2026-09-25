// build/fetch-vendor.mjs — self-host the pinned React UMD builds (one-off;
// re-run to refresh). Run: node build/fetch-vendor.mjs
//
// Why: they were the last render-critical files on a third-party origin
// (unpkg.com) — a whole extra DNS + TCP + TLS setup before the app could run,
// and the service worker couldn't keep them, so the "offline" app shell had no
// React. Same-origin, they share the page's connection, get a one-year
// immutable cache (the version is in the filename) and are precached by sw.js.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web', 'vendor');
const FILES = [
  ['https://unpkg.com/react@18.3.1/umd/react.production.min.js', 'react-18.3.1.production.min.js'],
  ['https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', 'react-dom-18.3.1.production.min.js'],
];

mkdirSync(OUT, { recursive: true });
for (const [url, name] of FILES) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(OUT, name), buf);
  const sri = 'sha384-' + createHash('sha384').update(buf).digest('base64');
  console.log(`  ${name}  ${(buf.length / 1024).toFixed(1)} KB  ${sri}`);
}
