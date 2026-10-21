// Resolve the Git exclusion file for both normal checkouts and linked worktrees.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const exclude = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' }).trim();
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve('prettier/bin/prettier.cjs')),
    ...process.argv.slice(2),
    '.',
    '--ignore-path',
    '.gitignore',
    '--ignore-path',
    '.prettierignore',
    '--ignore-path',
    exclude,
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
