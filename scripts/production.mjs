import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [action, ...extra] = process.argv.slice(2);
if (!['build', 'deploy', 'migrate'].includes(action))
  throw new Error('Usage: node scripts/production.mjs build|deploy|migrate [Wrangler options]');
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
  run('node_modules/vite/bin/vite.js', ['build']);
  run('scripts/check-bundle.mjs', []);
  if (action === 'deploy')
    run('node_modules/wrangler/bin/wrangler.js', ['deploy', '--env', 'production', ...extra]);
}
