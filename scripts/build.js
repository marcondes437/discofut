// Build de produção do cliente: verifica sintaxe e imports de todos os módulos
// e copia client/ + shared/ para dist/public (servível por qualquer host
// estático ou pelo próprio servidor com STATIC_DIR=dist/public).
//   node scripts/build.js          → verifica + gera dist/public
//   node scripts/build.js --check  → só verifica
import { readdirSync, statSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const errors = [];
const jsFiles = ['client', 'shared', 'server'].flatMap((d) => walk(join(ROOT, d))).filter((f) => extname(f) === '.js');

// 1) Sintaxe.
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) errors.push(`Sintaxe: ${relative(ROOT, f)}\n${r.stderr}`);
}

// 2) Imports resolvíveis (inclui o alias @shared/ do import map do cliente).
const importRe = /(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(importRe)) {
    const spec = m[1];
    let target = null;
    if (spec.startsWith('@shared/')) target = join(ROOT, 'shared', spec.slice(8));
    else if (spec.startsWith('.') || spec.startsWith('/')) target = resolve(dirname(f), spec);
    else continue; // pacote (ws) ou módulo node:
    if (!existsSync(target)) errors.push(`Import não encontrado em ${relative(ROOT, f)}: ${spec}`);
    if (spec.startsWith('@shared/') && !relative(ROOT, f).startsWith('client')) errors.push(`Alias @shared/ só deve ser usado no cliente: ${relative(ROOT, f)}`);
  }
}

// 3) Código compartilhado não pode depender de cliente/servidor (evita ciclos).
for (const f of jsFiles.filter((x) => relative(ROOT, x).startsWith('shared'))) {
  const src = readFileSync(f, 'utf8');
  if (/from\s+['"][^'"]*(client|server)\//.test(src)) errors.push(`shared/ importa client/ ou server/: ${relative(ROOT, f)}`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problema(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`✓ ${jsFiles.length} módulos verificados (sintaxe, imports, dependências).`);
if (checkOnly) process.exit(0);

const out = join(ROOT, 'dist', 'public');
rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(ROOT, 'client'), out, { recursive: true });
cpSync(join(ROOT, 'shared'), join(out, 'shared'), { recursive: true });
writeFileSync(join(ROOT, 'dist', 'BUILD.txt'), `DiscoFut build ${new Date().toISOString()}\nSirva dist/public como site estático ou rode: STATIC_DIR=dist/public npm start\n`);
const files = walk(out);
const bytes = files.reduce((s, f) => s + statSync(f).size, 0);
console.log(`✓ dist/public gerado: ${files.length} arquivos, ${(bytes / 1024).toFixed(1)} KB.`);
