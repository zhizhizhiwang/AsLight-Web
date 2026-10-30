import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { assertProductionBuild, productionTarget } from './environment.ts';

const [action, ...extra] = process.argv.slice(2);
if (!['build', 'deploy', 'publish', 'migrate'].includes(action))
  throw new Error('Usage: node scripts/production.mjs build|deploy|publish|migrate');
if (extra.length) throw new Error('正式运维命令不接受目标覆盖参数。');
const env = {
  ...process.env,
  CLOUDFLARE_ENV: 'production',
  WRANGLER_LOG_PATH: path.resolve('.cache/wrangler-production.log'),
};
function run(script, args) {
  const result = spawnSync(process.execPath, [path.resolve(script), ...args], {
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (action === 'migrate') {
  run('node_modules/wrangler/bin/wrangler.js', [
    'd1',
    'migrations',
    'apply',
    'DB',
    '--config',
    'wrangler.jsonc',
    '--remote',
    '--env',
    'production',
    ...extra,
  ]);
} else {
  if (action === 'deploy') {
    // Validate with the default local configuration before producing the production build.
    const check = spawnSync(process.execPath, ['--run', 'check'], {
      env: { ...env, CLOUDFLARE_ENV: '' },
      stdio: 'inherit',
    });
    if (check.status !== 0) process.exit(check.status ?? 1);
  }
  if (action !== 'publish') {
    run('node_modules/vite/bin/vite.js', ['build']);
    run('scripts/check-bundle.mjs', []);
  }
  const generated = path.resolve('dist/aslight/wrangler.json');
  assertProductionBuild(JSON.parse(readFileSync(generated, 'utf8')));
  if (action === 'deploy' || action === 'publish') {
    // The generated file is already flattened. Do not apply --env again, which
    // would suffix the Worker name and can target a different Worker.
    env.CLOUDFLARE_ENV = '';
    run('node_modules/wrangler/bin/wrangler.js', [
      'deploy',
      '--config',
      generated,
      '--name',
      productionTarget.name,
    ]);
  }
}
