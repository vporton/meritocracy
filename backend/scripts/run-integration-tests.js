import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://meritocracy:123@localhost:5432/meritocracy';

const env = process.env;

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const npxBinary = process.platform === 'win32' ? 'npx.cmd' : 'npx';
runCommand(npxBinary, [
  'prisma',
  'migrate',
  'deploy',
  '--config',
  path.join(backendRoot, 'prisma', 'prisma.config.js'),
]);
runCommand('node', ['--loader', 'ts-node/esm', '../node_modules/mocha/bin/mocha', '--extensions', 'ts', 'tests/*.ts']);
