#!/usr/bin/env node
/**
 * generate-exercise-catalog-doc.js — keep docs/exercise-catalog-contract.md in
 * sync with the exercise catalog (assets/exercises/exercises.json + the Spanish
 * overrides + the muscle-map logic in lib/muscle-activation.ts).
 *
 * WHY THIS EXISTS
 *   The external coach dashboard edits user training plans, which reference
 *   exercises by id and render the same muscle-activation maps the app shows.
 *   `assets/exercises/exercises.json` is the canonical catalog, but raw JSON
 *   does not tell the dashboard which classification axes are legal, what the
 *   muscle-map slugs are, how activation aggregates into a heat map, or what an
 *   added/changed exercise MUST carry. This script derives the readable
 *   contract straight from the data + the renderer source so it can never
 *   drift, and FAILS when the catalog violates an integrity rule (an undeclared
 *   muscle group / category, an activation slug the renderer can't draw, a
 *   substitution pointing nowhere, or a missing Spanish entry).
 *
 * CANONICAL SOURCES IT READS
 *   - assets/exercises/exercises.json            (catalog + taxonomy blocks)
 *   - assets/exercises/exercise_es_overrides.json (Spanish name + video per id)
 *   - lib/muscle-activation.ts                   (TRAINABLE_SLUGS + MUSCLE_GROUP_TO_SLUGS —
 *                                                 the runtime muscle-map contract)
 *   - docs/exercise-catalog-contract.config.json (human prose annotations)
 *
 * MODES
 *   node scripts/generate-exercise-catalog-doc.js          # write the doc (default)
 *   node scripts/generate-exercise-catalog-doc.js --check   # CI/pre-commit: exit 1 if the
 *                                                            # doc is stale OR the catalog
 *                                                            # fails an integrity rule.
 *
 * This runs automatically on `npm start` / `npm run ios|android|web` and during
 * EAS builds (see package.json), so normal development never lets it go stale.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'assets', 'exercises', 'exercises.json');
const ES_PATH = path.join(ROOT, 'assets', 'exercises', 'exercise_es_overrides.json');
const MUSCLE_TS_PATH = path.join(ROOT, 'lib', 'muscle-activation.ts');
const DOC_PATH = path.join(ROOT, 'docs', 'exercise-catalog-contract.md');
const CONFIG_PATH = path.join(ROOT, 'docs', 'exercise-catalog-contract.config.json');

const BEGIN_MARKER =
  '<!-- BEGIN GENERATED: exercise-inventory (managed by scripts/generate-exercise-catalog-doc.js — do not edit by hand) -->';
const END_MARKER = '<!-- END GENERATED: exercise-inventory -->';

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEBAB_OK = (s) => typeof s === 'string' && ID_RE.test(s);

// ---------------------------------------------------------------------------
// Read the runtime muscle-map contract out of lib/muscle-activation.ts so the
// doc's slug set and group→slug fallback can't drift from what the app renders.
// ---------------------------------------------------------------------------

/** Extract the string literals inside `export const NAME ... [ ... ]`. */
function parseSlugArray(ts, name) {
  const re = new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`);
  const m = ts.match(re);
  if (!m) return null;
  return m[1].match(/'([a-z-]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
}

/** Extract `export const MUSCLE_GROUP_TO_SLUGS ... = { group: ['slug', ...], ... }`. */
function parseGroupToSlugs(ts) {
  const m = ts.match(/export const MUSCLE_GROUP_TO_SLUGS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!m) return null;
  const out = {};
  const rowRe = /([a-z]+):\s*\[([^\]]*)\]/g;
  let r;
  while ((r = rowRe.exec(m[1])) !== null) {
    out[r[1]] = (r[2].match(/'([a-z-]+)'/g) || []).map((s) => s.slice(1, -1));
  }
  return out;
}

function loadMuscleMapContract() {
  const ts = fs.readFileSync(MUSCLE_TS_PATH, 'utf8');
  const trainable = parseSlugArray(ts, 'TRAINABLE_SLUGS');
  const groupToSlugs = parseGroupToSlugs(ts);
  if (!trainable || !trainable.length || !groupToSlugs) {
    throw new Error(
      `Could not parse TRAINABLE_SLUGS / MUSCLE_GROUP_TO_SLUGS from ${path.relative(ROOT, MUSCLE_TS_PATH)}. ` +
        'The muscle-map renderer shape changed — update this parser.'
    );
  }
  return { trainable, groupToSlugs };
}

// ---------------------------------------------------------------------------
// Integrity checks — these are the forcing function. A violation fails --check
// and is surfaced inline in the doc so a stale/broken catalog can't ship.
// ---------------------------------------------------------------------------

function checkCatalog(catalog, es, muscle) {
  const problems = [];
  const ex = catalog.exercises || [];

  const regions = new Set(catalog.bodyRegions || []);
  const groupsByRegion = catalog.muscleGroups || {};
  const allGroups = new Set(Object.values(groupsByRegion).flat());
  const regionOfGroup = new Map();
  for (const [region, groups] of Object.entries(groupsByRegion)) {
    for (const g of groups) regionOfGroup.set(g, region);
  }
  const movementTypes = new Set(catalog.movementTypes || []);
  const categories = new Set(catalog.categories || []);
  const equipment = new Set(catalog.equipment || []);
  const trainable = new Set(muscle.trainable);
  const ids = new Set();

  for (const e of ex) {
    const where = `exercise '${e.id || '(missing id)'}'`;
    if (!KEBAB_OK(e.id)) problems.push(`${where}: id is missing or not kebab-case`);
    if (ids.has(e.id)) problems.push(`${where}: duplicate id`);
    ids.add(e.id);
    if (!e.name) problems.push(`${where}: missing English name`);

    if (!regions.has(e.bodyRegion)) problems.push(`${where}: bodyRegion '${e.bodyRegion}' not in bodyRegions taxonomy`);
    if (!allGroups.has(e.muscleGroup)) problems.push(`${where}: muscleGroup '${e.muscleGroup}' not in muscleGroups taxonomy`);
    else if (regionOfGroup.get(e.muscleGroup) !== e.bodyRegion) {
      problems.push(`${where}: muscleGroup '${e.muscleGroup}' belongs to region '${regionOfGroup.get(e.muscleGroup)}', not '${e.bodyRegion}'`);
    }
    if (!movementTypes.has(e.movementType)) problems.push(`${where}: movementType '${e.movementType}' not in movementTypes taxonomy`);

    const category = e.category || 'strength';
    if (!categories.has(category)) problems.push(`${where}: category '${category}' not in categories taxonomy`);

    if (e.loggingUnit && e.loggingUnit !== 'reps' && e.loggingUnit !== 'seconds') {
      problems.push(`${where}: loggingUnit '${e.loggingUnit}' must be 'reps' or 'seconds'`);
    }

    for (const token of e.equipment || []) {
      if (!equipment.has(token)) problems.push(`${where}: equipment '${token}' not in equipment taxonomy`);
    }

    // Every exercise must be renderable on the muscle map: explicit activation,
    // or a muscleGroup that has a MUSCLE_GROUP_TO_SLUGS fallback.
    const activation = e.muscleActivation || [];
    if (activation.length) {
      for (const a of activation) {
        if (!trainable.has(a.slug)) problems.push(`${where}: activation slug '${a.slug}' not in TRAINABLE_SLUGS (lib/muscle-activation.ts)`);
        if (![1, 2, 3].includes(a.level)) problems.push(`${where}: activation level '${a.level}' for '${a.slug}' must be 1, 2, or 3`);
      }
    } else if (!muscle.groupToSlugs[e.muscleGroup]) {
      problems.push(`${where}: no muscleActivation and muscleGroup '${e.muscleGroup}' has no MUSCLE_GROUP_TO_SLUGS fallback — the muscle map cannot render it`);
    }

    for (const sub of e.substitutionsRecommended || []) {
      if (!ids.has(sub) && !ex.some((x) => x.id === sub)) {
        problems.push(`${where}: substitution '${sub}' is not a known exercise id`);
      }
    }

    const esEntry = es[e.id];
    if (!esEntry || !esEntry.nameEs) problems.push(`${where}: missing Spanish nameEs in exercise_es_overrides.json`);
    if (!esEntry || !esEntry.videoUrlEs) problems.push(`${where}: missing Spanish videoUrlEs in exercise_es_overrides.json`);
  }

  // Every muscle group must map to renderer slugs, and every Spanish key must
  // point at a real exercise.
  for (const g of allGroups) {
    if (!muscle.groupToSlugs[g]) problems.push(`muscle group '${g}' has no MUSCLE_GROUP_TO_SLUGS entry in lib/muscle-activation.ts`);
  }
  for (const key of Object.keys(es)) {
    if (!ids.has(key)) problems.push(`exercise_es_overrides.json has '${key}' which is not a catalog exercise id`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|');
}

function counts(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function fingerprint(catalog, es, muscle) {
  const shape = (catalog.exercises || [])
    .map((e) => {
      const act = (e.muscleActivation || []).map((a) => `${a.slug}:${a.level}`).join('+');
      const subs = (e.substitutionsRecommended || []).join('+');
      const eq = (e.equipment || []).join('+');
      return `${e.id}|${e.bodyRegion}|${e.muscleGroup}|${e.movementType}|${e.category || 'strength'}|${e.loggingUnit || 'reps'}|${eq}|${act}|${subs}|${es[e.id]?.nameEs || ''}`;
    })
    .sort()
    .join('\n');
  const taxonomy = JSON.stringify({
    bodyRegions: catalog.bodyRegions,
    muscleGroups: catalog.muscleGroups,
    movementTypes: catalog.movementTypes,
    categories: catalog.categories,
    equipment: catalog.equipment,
    trainable: muscle.trainable,
    groupToSlugs: muscle.groupToSlugs,
  });
  return crypto.createHash('sha256').update(`${shape}##${taxonomy}`).digest('hex').slice(0, 12);
}

function annotated(value, notes) {
  const note = notes && notes[value];
  return note ? `\`${value}\` — ${mdEscape(note)}` : `\`${value}\``;
}

function renderInventory(catalog, es, muscle, config, problems) {
  const ex = catalog.exercises || [];
  const out = [];
  const notes = config.taxonomyNotes || {};

  out.push(BEGIN_MARKER);
  out.push('');
  out.push(`<!-- catalog fingerprint: ${fingerprint(catalog, es, muscle)} -->`);
  out.push('');
  out.push('> This section is generated from `assets/exercises/exercises.json`,');
  out.push('> `assets/exercises/exercise_es_overrides.json`, and the muscle-map contract in');
  out.push('> `lib/muscle-activation.ts`. Do not edit it by hand — run `npm run exercise-catalog`.');
  out.push(`> Catalog version **${catalog.version || '?'}** (updated ${catalog.lastUpdated || '?'}) · **${ex.length}** exercises · Spanish coverage **${ex.filter((e) => es[e.id]?.nameEs && es[e.id]?.videoUrlEs).length}/${ex.length}**.`);
  out.push('');

  // Integrity status -------------------------------------------------------
  out.push('### Integrity');
  out.push('');
  if (problems.length === 0) {
    out.push('✅ Catalog passes every integrity rule (see "Integrity rules enforced" above).');
  } else {
    out.push(`❌ **${problems.length} integrity problem(s)** — \`npm run exercise-catalog:check\` fails until these are fixed:`);
    out.push('');
    for (const p of problems) out.push(`- ${mdEscape(p)}`);
  }
  out.push('');

  // Taxonomy ---------------------------------------------------------------
  out.push('### Classification axes (the legal vocabulary)');
  out.push('');
  out.push('Every exercise — including ones the dashboard adds — must use only these values.');
  out.push('');
  out.push('**Body regions**');
  out.push('');
  for (const r of catalog.bodyRegions || []) {
    const groups = (catalog.muscleGroups?.[r] || []).map((g) => `\`${g}\``).join(', ');
    const note = notes.bodyRegions?.[r] ? ` — ${mdEscape(notes.bodyRegions[r])}` : '';
    out.push(`- \`${r}\`${note} → muscle groups: ${groups}`);
  }
  out.push('');
  out.push('**Muscle groups** (the coarse `muscleGroup` field — one per exercise)');
  out.push('');
  out.push('| group | region | exercises | maps to muscle-map slugs (fallback) | note |');
  out.push('| --- | --- | --- | --- | --- |');
  const regionOfGroup = {};
  for (const [region, groups] of Object.entries(catalog.muscleGroups || {})) {
    for (const g of groups) regionOfGroup[g] = region;
  }
  const groupCount = Object.fromEntries(counts(ex, (e) => e.muscleGroup));
  for (const g of Object.keys(regionOfGroup)) {
    const slugs = (muscle.groupToSlugs[g] || []).map((s) => `\`${s}\``).join(', ');
    out.push(`| \`${g}\` | \`${regionOfGroup[g]}\` | ${groupCount[g] || 0} | ${slugs} | ${mdEscape(notes.muscleGroups?.[g] || '')} |`);
  }
  out.push('');
  out.push('**Categories** (training emphasis; defaults to `strength` when omitted)');
  out.push('');
  const catCount = Object.fromEntries(counts(ex, (e) => e.category || 'strength'));
  for (const c of catalog.categories || []) {
    const note = notes.categories?.[c] ? ` — ${mdEscape(notes.categories[c])}` : '';
    out.push(`- \`${c}\` (${catCount[c] || 0})${note}`);
  }
  out.push('');
  out.push('**Movement types**: ' + (catalog.movementTypes || []).map((m) => annotated(m, notes.movementTypes)).join(' · '));
  out.push('');
  out.push('**Logging units**: `reps` (default) · `seconds` — ' + `${ex.filter((e) => e.loggingUnit === 'seconds').length} exercise(s) log in seconds (isometrics + steady-state cardio).`);
  out.push('');
  out.push('**Equipment vocabulary** (' + (catalog.equipment || []).length + ' tokens): ' + (catalog.equipment || []).map((t) => `\`${t}\``).join(', ') + '.');
  out.push('');

  // Muscle-map slugs -------------------------------------------------------
  out.push('### Muscle-map slugs (`muscleActivation[].slug`)');
  out.push('');
  out.push('Finer than `muscleGroup`. These are the `react-native-body-highlighter` slugs the app and dashboard draw on the body map. `level` is 3 = primary, 2 = secondary, 1 = stabilizer. The renderer\'s canonical list is `TRAINABLE_SLUGS` in `lib/muscle-activation.ts`.');
  out.push('');
  const slugUse = Object.fromEntries(
    counts(
      ex.flatMap((e) => e.muscleActivation || []),
      (a) => a.slug
    )
  );
  out.push('| slug | exercises using it |');
  out.push('| --- | --- |');
  for (const s of muscle.trainable) out.push(`| \`${s}\` | ${slugUse[s] || 0} |`);
  out.push('');

  // Full inventory ---------------------------------------------------------
  out.push('### Full exercise inventory');
  out.push('');
  out.push('Grouped by region → muscle group. `activation` is `slug:level`; `subs` are recommended substitution ids. The machine-readable source is `assets/exercises/exercises.json`; this table is the human-readable contract.');
  out.push('');
  const byRegion = catalog.bodyRegions || [];
  for (const region of byRegion) {
    const groups = catalog.muscleGroups?.[region] || [];
    for (const group of groups) {
      const rows = ex.filter((e) => e.muscleGroup === group).sort((a, b) => a.id.localeCompare(b.id));
      if (!rows.length) continue;
      out.push(`#### ${region} · ${group} (${rows.length})`);
      out.push('');
      out.push('| id | name | nameEs | movement | category | unit | equipment | activation | subs |');
      out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const e of rows) {
        const act = (e.muscleActivation || []).map((a) => `${a.slug}:${a.level}`).join(' ');
        const eq = (e.equipment || []).join(' ');
        const subs = (e.substitutionsRecommended || []).join(' ');
        out.push(
          `| \`${e.id}\` | ${mdEscape(e.name)} | ${mdEscape(es[e.id]?.nameEs || '')} | ${e.movementType} | ${e.category || 'strength'} | ${e.loggingUnit || 'reps'} | ${mdEscape(eq)} | ${mdEscape(act)} | ${mdEscape(subs)} |`
        );
      }
      out.push('');
    }
  }

  out.push(END_MARKER);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Doc IO
// ---------------------------------------------------------------------------

function replaceBlock(docText, block) {
  const begin = docText.indexOf(BEGIN_MARKER);
  const end = docText.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `Could not find generated markers in ${path.relative(ROOT, DOC_PATH)}. ` +
        'Ensure both BEGIN/END marker comments are present.'
    );
  }
  return docText.slice(0, begin) + block + docText.slice(end + END_MARKER.length);
}

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (fallback !== undefined) {
      console.warn(`No usable JSON at ${path.relative(ROOT, p)} (${e.message}). Using fallback.`);
      return fallback;
    }
    throw e;
  }
}

function main() {
  const check = process.argv.includes('--check');

  const catalog = loadJson(CATALOG_PATH);
  const es = loadJson(ES_PATH, {});
  const config = loadJson(CONFIG_PATH, {});
  const muscle = loadMuscleMapContract();

  const problems = checkCatalog(catalog, es, muscle);
  const block = renderInventory(catalog, es, muscle, config, problems);

  const docText = fs.readFileSync(DOC_PATH, 'utf8');
  const next = replaceBlock(docText, block);
  const stale = next !== docText;

  if (check) {
    let failed = false;
    if (stale) {
      console.error('❌ docs/exercise-catalog-contract.md is OUT OF DATE with the catalog.');
      console.error('   Run: npm run exercise-catalog  (then commit the doc).');
      failed = true;
    }
    if (problems.length) {
      console.error(`❌ ${problems.length} exercise-catalog integrity problem(s):`);
      for (const p of problems) console.error(`   - ${p}`);
      failed = true;
    }
    if (failed) process.exit(1);
    console.log('✅ Exercise catalog contract is in sync and passes all integrity rules.');
    return;
  }

  if (stale) {
    fs.writeFileSync(DOC_PATH, next);
    console.log(`Updated ${path.relative(ROOT, DOC_PATH)} from the exercise catalog.`);
  } else {
    console.log('Exercise catalog contract already up to date.');
  }
  if (problems.length) {
    console.warn(`⚠️  ${problems.length} integrity problem(s) recorded in the doc; run exercise-catalog:check for the list.`);
  }
}

if (require.main === module) main();

module.exports = { checkCatalog, fingerprint, loadMuscleMapContract };
