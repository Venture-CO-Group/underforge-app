#!/usr/bin/env node
/**
 * sync-contracts.js — copy the manifest's files into a target directory (a checkout
 * of the coach-dashboard repo). Driven by .github/workflows/sync-contracts.yml.
 *
 *   node scripts/sync-contracts.js <targetRepoRoot>
 *
 * It reads docs/contract-sync.manifest.json, copies every `src` to
 * `<targetRepoRoot>/<destRoot>/<dest>`, and writes a README.md + MANIFEST.json into
 * destRoot so the dashboard side always knows what these files are, where they came
 * from, and that they must not be hand-edited. The whole destRoot is rewritten each
 * run (stale files removed), so deletions in the manifest propagate too.
 *
 * Local dry run (writes into /tmp to preview):
 *   node scripts/sync-contracts.js /tmp/dash-preview
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'docs', 'contract-sync.manifest.json');

function loadManifest() {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!m.destRoot || !Array.isArray(m.files)) {
    throw new Error('manifest must have a destRoot and a files[] array');
  }
  return m;
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function renderReadme(manifest, sha) {
  const byCat = {};
  for (const f of manifest.files) (byCat[f.category] = byCat[f.category] || []).push(f);
  const lines = [];
  lines.push('# Shared contracts from `underforge_app` — DO NOT EDIT HERE');
  lines.push('');
  lines.push('Every file in this folder is **mirrored automatically** from the `aloprieto/underforge_app` repo by its');
  lines.push('`sync-contracts` GitHub Action. Editing anything here is pointless — the next sync overwrites it.');
  lines.push('To change one of these, edit it in `underforge_app` and merge; a PR will appear here.');
  lines.push('');
  if (sha) lines.push(`_Last synced from underforge_app@\`${sha}\`._`, '');
  const titles = {
    data: 'Data (load these directly)',
    contract: 'Contracts (read these — for you and for AI building the dashboard)',
    schema: 'Schema',
    types: 'TypeScript shapes (reference)',
    logic: 'Logic to port (the app implements these; reimplement to match behavior)',
  };
  for (const cat of ['data', 'contract', 'schema', 'types', 'logic']) {
    const items = byCat[cat];
    if (!items || !items.length) continue;
    lines.push(`## ${titles[cat] || cat}`, '');
    for (const f of items) {
      lines.push(`- \`${manifest.destRoot}/${f.dest}\` — ${f.note || ''} _(source: \`${f.src}\`)_`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('Start with `exercise-catalog-contract.md` and `coach-dashboard-data-model.md`; they point at everything else.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const targetRoot = process.argv[2];
  if (!targetRoot) {
    console.error('usage: node scripts/sync-contracts.js <targetRepoRoot>');
    process.exit(2);
  }
  const sha = process.env.SOURCE_SHA || '';
  const manifest = loadManifest();
  const destRootAbs = path.join(targetRoot, manifest.destRoot);

  // Rewrite destRoot from scratch so removed manifest entries don't linger.
  rmrf(destRootAbs);
  fs.mkdirSync(destRootAbs, { recursive: true });

  let copied = 0;
  const missing = [];
  for (const f of manifest.files) {
    const srcAbs = path.join(ROOT, f.src);
    if (!fs.existsSync(srcAbs)) {
      missing.push(f.src);
      continue;
    }
    copyFile(srcAbs, path.join(destRootAbs, f.dest));
    copied++;
  }

  fs.writeFileSync(path.join(destRootAbs, 'README.md'), renderReadme(manifest, sha));
  fs.writeFileSync(
    path.join(destRootAbs, 'MANIFEST.json'),
    JSON.stringify({ syncedFrom: 'aloprieto/underforge_app', sourceSha: sha || null, files: manifest.files }, null, 2) + '\n'
  );

  console.log(`Synced ${copied} file(s) into ${path.relative(process.cwd(), destRootAbs)}.`);
  if (missing.length) {
    console.error(`❌ ${missing.length} manifest file(s) not found in underforge_app:`);
    for (const m of missing) console.error(`   - ${m}`);
    process.exit(1);
  }
}

if (require.main === module) main();
