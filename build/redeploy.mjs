// build/redeploy.mjs — one command to ship a change to the live web-app URL.
//
//   npm run redeploy -- "what changed"
//
// Steps: build index.html -> clasp push -> create an immutable version ->
// point the stable deployment (the /exec URL) at that version.
//
// The stable deployment id is the non-@HEAD one from `clasp list-deployments`.
// Override with RP_DEPLOYMENT_ID=... if you ever recreate it.

import { execSync } from 'node:child_process';

const desc = (process.argv.slice(2).join(' ').trim() || 'update').replace(/"/g, "'");
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });

// 1. build + push
sh('node build/build.mjs');
process.stdout.write(sh('clasp push --force'));

// 2. resolve the stable deployment id
let depId = process.env.RP_DEPLOYMENT_ID;
if (!depId) {
  const list = sh('clasp list-deployments');
  const ids = list.split('\n').map((l) => l.trim())
    .filter((l) => l.startsWith('- ') && !l.includes('@HEAD'))
    .map((l) => l.slice(2).split(/\s+/)[0]);
  if (!ids.length) { console.error('no stable (non-@HEAD) deployment; run `clasp create-deployment` once'); process.exit(1); }
  depId = ids[0];
}

// 3. new immutable version
const vOut = sh(`clasp create-version "${desc}"`);
process.stdout.write(vOut);
const vNum = (vOut.match(/\b(\d+)\b/) || [])[1];
if (!vNum) { console.error('could not parse version number from:\n' + vOut); process.exit(1); }

// 4. repoint the stable /exec URL at the new version
process.stdout.write(sh(`clasp redeploy ${depId} -V ${vNum} -d "${desc}"`));
console.log(`\nlive: https://script.google.com/macros/s/${depId}/exec  (v${vNum} — ${desc})`);
