// Builds the single-file page published as the claude.ai Artifact.
//
//   node tools/build-artifact.mjs            -> dist/flatcell.html (Artifact body)
//   node tools/build-artifact.mjs --standalone -> also dist/index.html (full document)
//
// No bundler: each ES module becomes a function scope in a small registry,
// in dependency order. The simulation worker is bundled the same way and
// embedded as a string, started from a blob: URL by src/app/sim-client.js.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g;

function collect(entry, order = [], seen = new Set()) {
  const file = resolve(ROOT, entry);
  if (seen.has(file)) return order;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) collect(relative(ROOT, resolve(dirname(file), m[2])), order, seen);
  order.push(file);
  return order;
}

function transform(file) {
  let src = readFileSync(file, 'utf8');
  const id = relative(ROOT, file);
  src = src.replace(IMPORT_RE, (_, names, from) => {
    const target = relative(ROOT, resolve(dirname(file), from));
    const binds = names.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.replace(/\s+as\s+/, ': ')).join(', ');
    return `const { ${binds} } = __mod[${JSON.stringify(target)}];`;
  });
  const exported = [];
  src = src.replace(/^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, name) => {
    exported.push(name);
    return `${kw} ${name}`;
  });
  if (/^\s*export\s/m.test(src)) throw new Error(`unsupported export form in ${id}`);
  // Only reached in development (module worker); keep classic scripts valid.
  src = src.replace(/import\.meta\.url/g, 'location.href');
  return `__mod[${JSON.stringify(id)}] = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();\n`;
}

function bundle(entry) {
  const files = collect(entry);
  return `(() => {\n'use strict';\nconst __mod = {};\n${files.map(transform).join('\n')}\n})();\n`;
}

const worker = bundle('src/worker/sim-worker.js');
const app = bundle('src/app/main.js');
const css = readFileSync(resolve(ROOT, 'src/app/style.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

const head = html.match(/<head>([\s\S]*)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '')
  .replace(/<link rel="stylesheet" href="src\/app\/style.css">/, `<style>\n${css}</style>`)
  .trim();
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script type="module" src="src\/app\/main.js"><\/script>/, '')
  .trim();

// A string literal that is safe inside <script>.
const scriptString = (s) => JSON.stringify(s).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');

const page = `${head}
${body}
<script>globalThis.__FLATCELL_WORKER_SOURCE__ = ${scriptString(worker)};</script>
<script>
${app.replace(/<\/script/gi, '<\\/script')}</script>
`;

mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
writeFileSync(resolve(ROOT, 'dist/flatcell.html'), page);
console.log(`dist/flatcell.html  ${(page.length / 1024).toFixed(0)} KB`);

if (process.argv.includes('--standalone')) {
  const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${page.replace(/<\/title>/, '</title>')}
`.replace(/(<\/style>)/, '$1\n</head>\n<body>') + '</body>\n</html>\n';
  writeFileSync(resolve(ROOT, 'dist/index.html'), full);
  console.log('dist/index.html');
}
