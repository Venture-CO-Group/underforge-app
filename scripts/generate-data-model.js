#!/usr/bin/env node
/**
 * generate-data-model.js — keep docs/coach-dashboard-data-model.md in sync with schema.sql.
 *
 * WHY THIS EXISTS
 *   An external repo (the coach dashboard) reads/writes this same Supabase
 *   database. `schema.sql` is the canonical DDL, but raw DDL does not tell the
 *   dashboard which columns a coach may edit, which are app-owned, what shape
 *   the JSON columns are, or how the storage buckets work. This script derives
 *   the structural inventory straight from `schema.sql` so that part can never
 *   drift, and forces a human to classify any NEW column on a coach-facing
 *   table before the docs are considered up to date.
 *
 * WHAT IT DOES
 *   1. Parses schema.sql (CREATE TABLE bodies + ALTER ... ADD COLUMN, policies,
 *      storage buckets, functions, views).
 *   2. Merges human annotations from docs/coach-dashboard-data-model.config.json
 *      (per-column ownership for coach-facing tables, JSON shape pointers).
 *   3. Rewrites the block between the GENERATED markers in
 *      docs/coach-dashboard-data-model.md. Everything outside the markers is
 *      hand-written and left untouched.
 *
 * MODES
 *   node scripts/generate-data-model.js          # write the doc (default)
 *   node scripts/generate-data-model.js --check   # CI/pre-commit: exit 1 if the
 *                                                  # doc is stale OR a coach-facing
 *                                                  # column is unclassified.
 *
 * This runs automatically on `npm start` / `npm run ios|android|web` and during
 * EAS builds (see package.json), so normal development never lets it go stale.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'schema.sql');
const DOC_PATH = path.join(ROOT, 'docs', 'coach-dashboard-data-model.md');
const CONFIG_PATH = path.join(ROOT, 'docs', 'coach-dashboard-data-model.config.json');

const BEGIN_MARKER =
  '<!-- BEGIN GENERATED: schema-inventory (managed by scripts/generate-data-model.js — do not edit by hand) -->';
const END_MARKER = '<!-- END GENERATED: schema-inventory -->';

const CONSTRAINT_KEYWORDS = new Set([
  'CONSTRAINT', 'UNIQUE', 'CHECK', 'PRIMARY', 'FOREIGN', 'EXCLUDE', 'LIKE',
]);

// ---------------------------------------------------------------------------
// Low-level parsing helpers
// ---------------------------------------------------------------------------

/** Index of a `--` line comment that is not inside a single-quoted string. */
function commentIndex(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'") inString = !inString;
    else if (ch === '-' && line[i + 1] === '-' && !inString) return i;
  }
  return -1;
}

/** Strip dollar-quoted function bodies so their parens/semicolons don't confuse structural parsing. */
function stripFunctionBodies(sql) {
  return sql.replace(/\$\$[\s\S]*?\$\$/g, ' ');
}

/** Best-effort column type from a column definition string. */
function cleanType(def) {
  const rest = def.split(/\s+/).slice(1).join(' ');
  const m = rest.match(
    /^([a-zA-Z][\w]*(?:\s+without\s+time\s+zone)?(?:\[\])?(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)/i
  );
  if (m) return m[1].replace(/\s+/g, ' ');
  return (def.split(/\s+/)[1] || '').replace(/[(,].*$/, '') || '?';
}

/**
 * Extract CREATE TABLE blocks. Walks raw text with comment + paren awareness so
 * that parens inside `-- comments` (e.g. "(e.g. \"Europe/Berlin\")") don't break
 * the brace matching.
 */
function extractCreateTables(sql) {
  const tables = [];
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1];
    let depth = 1;
    let i = re.lastIndex;
    for (; i < sql.length && depth > 0; i++) {
      const ch = sql[i];
      if (ch === '-' && sql[i + 1] === '-') {
        const nl = sql.indexOf('\n', i);
        i = nl < 0 ? sql.length : nl;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    const body = sql.slice(re.lastIndex, i - 1);
    tables.push({ name, columns: parseTableBody(body) });
    re.lastIndex = i;
  }
  return tables;
}

/** Parse a CREATE TABLE body into columns (with inline/leading comments). */
function parseTableBody(body) {
  const columns = [];
  const lines = body.split('\n');
  let depth = 0;
  let seg = '';
  let segComment = '';
  let leadingComment = '';

  const flush = () => {
    const def = seg.trim().replace(/,+$/, '').trim();
    seg = '';
    const comment = (segComment || leadingComment || '').trim();
    segComment = '';
    leadingComment = '';
    if (!def) return;
    const kw = (def.match(/^\w+/) || [''])[0].toUpperCase(); // leading word even if glued to '(' e.g. UNIQUE(
    if (CONSTRAINT_KEYWORDS.has(kw)) return; // table-level constraint, not a column
    const name = def.split(/\s+/)[0];
    columns.push({ name, type: cleanType(def), comment });
  };

  for (const line of lines) {
    const ci = commentIndex(line);
    const code = ci >= 0 ? line.slice(0, ci) : line;
    const comment = ci >= 0 ? line.slice(ci + 2).trim() : '';

    if (code.trim() === '') {
      if (comment) {
        if (seg.trim() === '') leadingComment = leadingComment ? `${leadingComment} ${comment}` : comment;
        else segComment = comment;
      }
      continue;
    }
    if (comment) segComment = comment;

    for (let k = 0; k < code.length; k++) {
      const ch = code[k];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) flush();
      else seg += ch;
    }
    seg += ' ';
  }
  flush();
  return columns;
}

/**
 * Columns added to existing tables via `ALTER TABLE ... ADD COLUMN`. The block
 * comment immediately above the statement is attached to those columns.
 */
function parseAlterColumns(sql) {
  const lines = sql.split('\n');
  const out = [];
  let commentBuf = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const ci = commentIndex(line);
    const code = ci >= 0 ? line.slice(0, ci) : line;
    const comment = ci >= 0 ? line.slice(ci + 2).trim() : '';
    const codeTrim = code.trim();

    if (codeTrim === '') {
      if (!comment) commentBuf = [];
      else if (/^[=\-\s]+$/.test(comment)) commentBuf = []; // banner line delimits sections; drop it
      else commentBuf.push(comment);
      continue;
    }
    if (/^ALTER TABLE/i.test(codeTrim)) {
      let stmt = '';
      let j = idx;
      while (j < lines.length) {
        const l = lines[j];
        const cj = commentIndex(l);
        stmt += ` ${cj >= 0 ? l.slice(0, cj) : l}`;
        if (stmt.includes(';')) break;
        j++;
      }
      const tm = stmt.match(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:public\.)?(\w+)/i);
      const table = tm ? tm[1] : null;
      const comment = commentBuf.join(' ').trim();
      const re =
        /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)\s+([a-zA-Z][\w]*(?:\[\])?(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)/gi;
      let cm;
      while ((cm = re.exec(stmt)) !== null) {
        if (table) out.push({ table, name: cm[1], type: cm[2], comment });
      }
      commentBuf = [];
      idx = j;
      continue;
    }
    commentBuf = [];
  }
  return out;
}

function parsePolicies(sql) {
  const byTable = {};
  const re =
    /CREATE POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)\s+(?:AS\s+(PERMISSIVE|RESTRICTIVE)\s+)?FOR\s+(\w+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const [, name, table, mode, op] = m;
    (byTable[table] = byTable[table] || []).push({
      name,
      mode: (mode || 'PERMISSIVE').toUpperCase(),
      op: op.toUpperCase(),
    });
  }
  return byTable;
}

function parseRlsEnabled(sql) {
  const set = new Set();
  const re = /ALTER TABLE\s+(?:public\.)?(\w+)\s+ENABLE ROW LEVEL SECURITY/gi;
  let m;
  while ((m = re.exec(sql)) !== null) set.add(m[1]);
  return set;
}

function parseBuckets(sql) {
  const out = [];
  const re = /INSERT INTO storage\.buckets\s*\([^)]*\)\s*VALUES\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(true|false)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) out.push({ id: m[1], name: m[2], public: m[3] === 'true' });
  return out;
}

function parseFunctions(sql) {
  const out = [];
  const re = /CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) out.push({ name: m[1], args: m[2].replace(/\s+/g, ' ').trim() });
  return out;
}

function parseViews(sql) {
  const out = [];
  const re = /CREATE (?:OR REPLACE )?VIEW\s+(?:public\.)?(\w+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Model assembly
// ---------------------------------------------------------------------------

function buildModel(rawSql) {
  const structural = stripFunctionBodies(rawSql);
  const tables = extractCreateTables(rawSql); // raw so comments survive
  const byName = new Map(tables.map((t) => [t.name, t]));

  for (const col of parseAlterColumns(rawSql)) {
    const table = byName.get(col.table);
    if (!table) continue;
    const existing = table.columns.find((c) => c.name === col.name);
    if (existing) {
      if (!existing.comment && col.comment) existing.comment = col.comment;
    } else {
      table.columns.push({ name: col.name, type: col.type, comment: col.comment });
    }
  }

  return {
    tables,
    policies: parsePolicies(structural),
    rlsEnabled: parseRlsEnabled(structural),
    buckets: parseBuckets(rawSql),
    functions: parseFunctions(rawSql),
    views: parseViews(structural),
  };
}

function policySummary(model, tableName) {
  const policies = model.policies[tableName] || [];
  const permissive = policies.filter((p) => p.mode === 'PERMISSIVE').map((p) => p.op);
  const restrictive = policies.filter((p) => p.mode === 'RESTRICTIVE');
  const order = ['INSERT', 'SELECT', 'UPDATE', 'DELETE'];
  const ops = order.filter((o) => permissive.includes(o)).map((o) => o.toLowerCase());

  if (!model.rlsEnabled.has(tableName) && policies.length === 0) return 'RLS not enabled';
  let summary;
  if (ops.length === 0) summary = 'RLS on, no public policies (service-role only)';
  else summary = `public: ${ops.join(', ')}`;
  if (restrictive.length) {
    summary += ` — restrictive: ${restrictive.map((p) => `${p.op.toLowerCase()} "${p.name}"`).join(', ')}`;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function mdEscape(s) {
  return String(s || '').replace(/\|/g, '\\|');
}

function renderColumnRow(col, accessCell) {
  const cells = [`\`${col.name}\``, `\`${col.type}\``];
  if (accessCell !== null) cells.push(accessCell);
  cells.push(mdEscape(col.comment) || '');
  return `| ${cells.join(' | ')} |`;
}

function renderRelevantTable(model, tableName, conf, unclassifiedSink) {
  const table = model.tables.find((t) => t.name === tableName);
  const lines = [];
  lines.push(`#### \`${tableName}\``);
  if (conf.purpose) lines.push('', conf.purpose);
  if (!table) {
    lines.push('', `> ⚠️ **Table \`${tableName}\` is in the config but not found in schema.sql.** Remove it from the config or restore the table.`);
    unclassifiedSink.push(`missing table: ${tableName}`);
    return lines.join('\n');
  }
  lines.push('', `RLS — ${policySummary(model, tableName)}`, '');
  lines.push('| column | type | access | notes |');
  lines.push('| --- | --- | --- | --- |');
  const colConf = conf.columns || {};
  for (const col of table.columns) {
    const entry = colConf[col.name];
    let accessCell;
    if (!entry) {
      accessCell = '⚠️ UNCLASSIFIED';
      unclassifiedSink.push(`${tableName}.${col.name}`);
    } else {
      const note = entry.note ? ` — ${mdEscape(entry.note)}` : '';
      accessCell = `**${mdEscape(entry.access)}**${note}`;
    }
    lines.push(renderColumnRow(col, accessCell));
  }
  return lines.join('\n');
}

function renderReferenceTable(model, tableName, noteByTable) {
  const table = model.tables.find((t) => t.name === tableName);
  if (!table) return '';
  const lines = [];
  lines.push(`#### \`${tableName}\``);
  if (noteByTable[tableName]) lines.push('', `_${noteByTable[tableName]}_`);
  lines.push('', `RLS — ${policySummary(model, tableName)}`, '');
  lines.push('| column | type | notes |');
  lines.push('| --- | --- | --- |');
  for (const col of table.columns) lines.push(renderColumnRow(col, null));
  return lines.join('\n');
}

function structuralFingerprint(model) {
  const shape = model.tables
    .map((t) => `${t.name}(${t.columns.map((c) => `${c.name}:${c.type}`).join(',')})`)
    .sort()
    .join('|');
  const extra = [
    `buckets:${model.buckets.map((b) => b.id).sort().join(',')}`,
    `fns:${model.functions.map((f) => f.name).sort().join(',')}`,
    `views:${model.views.sort().join(',')}`,
  ].join(';');
  return crypto.createHash('sha256').update(`${shape}#${extra}`).digest('hex').slice(0, 12);
}

function renderInventory(model, config) {
  const relevant = config.relevantTables || {};
  const contextNotes = config.contextTables || {};
  const unclassified = [];
  const out = [];

  out.push(BEGIN_MARKER);
  out.push('');
  out.push(`<!-- schema fingerprint: ${structuralFingerprint(model)} -->`);
  out.push('');
  out.push('> This section is generated from `schema.sql`. Do not edit it by hand.');
  out.push('> Run `npm run data-model` (auto-runs on `npm start`) to refresh it.');
  out.push(`> Tables: **${model.tables.length}** · buckets: **${model.buckets.length}** · functions: **${model.functions.length}** · views: **${model.views.length}**.`);
  out.push('');

  out.push('### Coach-facing tables (classified)');
  out.push('');
  out.push('Access legend — **coach-edit**: dashboard may write · **app**: app owns it, dashboard reads only · **system**: DB/Edge managed, never write · **read**: reference/lookup.');
  out.push('');
  for (const tableName of Object.keys(relevant)) {
    out.push(renderRelevantTable(model, tableName, relevant[tableName], unclassified));
    out.push('');
  }

  const relevantSet = new Set(Object.keys(relevant));
  const referenceTables = model.tables
    .map((t) => t.name)
    .filter((n) => !relevantSet.has(n))
    .sort();

  out.push('### All other tables (reference inventory)');
  out.push('');
  out.push('Read-context for the dashboard. Coaches generally do not write these directly.');
  out.push('');
  for (const tableName of referenceTables) {
    out.push(renderReferenceTable(model, tableName, contextNotes));
    out.push('');
  }

  if (model.buckets.length) {
    out.push('### Storage buckets');
    out.push('');
    out.push('| bucket id | public | written by |');
    out.push('| --- | --- | --- |');
    const bucketNotes = config.bucketNotes || {};
    for (const b of model.buckets) {
      out.push(`| \`${b.id}\` | ${b.public ? 'yes' : 'no'} | ${mdEscape(bucketNotes[b.id]) || ''} |`);
    }
    out.push('');
  }

  if (model.functions.length) {
    out.push('### RPC functions');
    out.push('');
    for (const f of model.functions) out.push(`- \`${f.name}(${f.args})\``);
    out.push('');
  }

  if (model.views.length) {
    out.push('### Views');
    out.push('');
    for (const v of model.views) out.push(`- \`${v}\``);
    out.push('');
  }

  out.push(END_MARKER);
  return { block: out.join('\n'), unclassified };
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
  const before = docText.slice(0, begin);
  const after = docText.slice(end + END_MARKER.length);
  return `${before}${block}${after}`;
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.warn(`No usable config at ${path.relative(ROOT, CONFIG_PATH)} (${e.message}). Using empty config.`);
    return {};
  }
}

function main() {
  const check = process.argv.includes('--check');

  const rawSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const config = loadConfig();
  const model = buildModel(rawSql);
  const { block, unclassified } = renderInventory(model, config);

  const docText = fs.readFileSync(DOC_PATH, 'utf8');
  const next = replaceBlock(docText, block);
  const stale = next !== docText;

  if (check) {
    let failed = false;
    if (stale) {
      console.error('❌ docs/coach-dashboard-data-model.md is OUT OF DATE with schema.sql.');
      console.error('   Run: npm run data-model  (then commit the doc).');
      failed = true;
    }
    if (unclassified.length) {
      console.error('❌ Unclassified coach-facing schema items (add them to coach-dashboard-data-model.config.json):');
      for (const u of unclassified) console.error(`   - ${u}`);
      failed = true;
    }
    if (failed) process.exit(1);
    console.log('✅ Coach dashboard data model is in sync with schema.sql.');
    return;
  }

  if (stale) {
    fs.writeFileSync(DOC_PATH, next);
    console.log(`Updated ${path.relative(ROOT, DOC_PATH)} from schema.sql.`);
  } else {
    console.log('Coach dashboard data model already up to date.');
  }
  if (unclassified.length) {
    console.warn(`⚠️  ${unclassified.length} unclassified coach-facing item(s); classify them in coach-dashboard-data-model.config.json:`);
    for (const u of unclassified) console.warn(`   - ${u}`);
  }
}

if (require.main === module) main();

module.exports = { buildModel, renderInventory, structuralFingerprint };
