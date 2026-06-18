#!/usr/bin/env node
/**
 * Generate assets/licenses.json — minimal open-source attributions.
 *
 * Per package: name + SPDX license + copyright line only.
 * Full license boilerplate is stored once per license id in `notices`.
 *
 *   node scripts/generate-licenses.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'licenses.json');

const LICENSE_FILE_RE = /^(LICEN[SC]E|COPYING|UNLICENSE)(\..*)?$/i;

/** Canonical license texts (reproduced once, not per package). */
const LICENSE_NOTICES = {
  MIT:
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
  'BSD-2-Clause':
    'Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
  'BSD-3-Clause':
    'Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
  ISC: 'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
  'Apache-2.0':
    'Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.',
  Unlicense:
    'This is free and unencumbered software released into the public domain.\n\nAnyone is free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.',
  '0BSD':
    'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.',
};

function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  while (true) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license.split(/\s+(?:AND|OR)\s+/)[0].replace(/[()]/g, '');
  if (pkg.license?.type) return pkg.license.type;
  return 'UNKNOWN';
}

function authorString(pkg) {
  const a = pkg.author;
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (typeof a === 'object') return a.name || '';
  return '';
}

function readLicenseFile(dir) {
  try {
    const match = fs.readdirSync(dir).find((f) => LICENSE_FILE_RE.test(f));
    return match ? fs.readFileSync(path.join(dir, match), 'utf8') : '';
  } catch {
    return '';
  }
}

/** First copyright line from LICENSE, else package author as fallback. */
function extractCopyright(pkg, licenseText) {
  const lines = licenseText.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (/^copyright\b/i.test(t)) return t;
  }
  const author = authorString(pkg);
  return author ? `Copyright ${author}` : '';
}

function collect() {
  const rootPkg = readJson(path.join(ROOT, 'package.json'));
  const seenDepKeys = new Set();
  const seenPackageNames = new Set();
  const packages = [];
  const queue = Object.keys(rootPkg.dependencies || {}).map((name) => ({ name, fromDir: ROOT }));

  while (queue.length) {
    const { name, fromDir } = queue.shift();
    if (seenDepKeys.has(name)) continue;

    const dir = resolvePackageDir(name, fromDir);
    if (!dir) continue;
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg) continue;

    seenDepKeys.add(name);

    const packageName = pkg.name || name;
    if (!seenPackageNames.has(packageName)) {
      seenPackageNames.add(packageName);
      const license = normalizeLicense(pkg);
      const copyright = extractCopyright(pkg, readLicenseFile(dir));
      packages.push({
        n: packageName,
        l: license,
        ...(copyright ? { c: copyright } : {}),
      });
    }

    for (const depName of Object.keys(pkg.dependencies || {})) {
      if (!seenDepKeys.has(depName)) queue.push({ name: depName, fromDir: dir });
    }
  }

  return packages.sort((a, b) => a.n.localeCompare(b.n));
}

function main() {
  const packages = collect();
  const usedLicenses = [...new Set(packages.map((p) => p.l))];
  const notices = {};
  for (const id of usedLicenses) {
    if (LICENSE_NOTICES[id]) notices[id] = LICENSE_NOTICES[id];
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify({ notices, packages }, null, 0) + '\n',
  );

  const sizeKb = Math.round(fs.statSync(OUT).size / 1024);
  const missing = usedLicenses.filter((id) => !LICENSE_NOTICES[id]);
  console.log(`Wrote ${packages.length} packages (${sizeKb} KB).`);
  if (missing.length) console.warn('No bundled notice text for:', [...new Set(missing)].join(', '));
}

main();
