// Executa todos os arquivos tests/*.test.js com o test runner nativo do Node
// (funciona em Node 18+, que não aceita globs na linha de comando).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2];
const files = readdirSync(join(root, 'tests'))
  .filter((f) => f.endsWith('.test.js') && (!filter || f.includes(filter)))
  .map((f) => join('tests', f));
const r = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
