import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertLocalSecrets } from './environment.ts';

const [action, ...args] = process.argv.slice(2);
if (!['dev', 'build', 'preview'].includes(action))
  throw new Error('Expected dev, build or preview.');
if (process.env.CLOUDFLARE_ENV)
  throw new Error('本地命令不接受云环境；正式构建请使用 npm run build:production。');
async function readEnv(file) {
  try {
    return parseEnv(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
const local = {
  ...(await readEnv('.env')),
  ...(await readEnv('.env.local')),
  ...(await readEnv('.dev.vars')),
  ...process.env,
};
assertLocalSecrets(local, await readEnv('.dev.vars.production'));
if (action === 'preview') {
  const config = JSON.parse(await readFile('dist/aslight/wrangler.json', 'utf8'));
  if (config.targetEnvironment === 'production' || config.name === 'aslight-production')
    throw new Error('拒绝本地预览正式构建；请先运行 npm run build，使用隔离的本地环境。');
}
const result = spawnSync(
  process.execPath,
  [
    path.resolve('node_modules/vite/bin/vite.js'),
    ...(action === 'dev' ? ['--host', '127.0.0.1'] : [action]),
    ...(action === 'preview' ? ['--host', '127.0.0.1'] : []),
    ...args,
  ],
  { env: process.env, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
