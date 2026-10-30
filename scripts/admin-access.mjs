import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { adminProvisionSQL } from './admin-provision.mjs';

const [mode, target, ...options] = process.argv.slice(2);
const originArg = options.find((option) => option.startsWith('--origin='));
const envArg = options.find((option) => option.startsWith('--env='));
if (
  !['bootstrap', 'recover'].includes(mode) ||
  !['--local', '--remote'].includes(target) ||
  options.length !== Number(Boolean(originArg)) + Number(Boolean(envArg)) ||
  (envArg && !/^--env=[a-zA-Z0-9_-]+$/.test(envArg)) ||
  (target === '--remote' && !originArg)
)
  throw new Error(
    'Usage: npm run auth:admin -- bootstrap|recover --local|--remote [--origin=https://your-site.example] [--env=production]',
  );
const origin = new URL(originArg?.slice('--origin='.length) ?? 'http://127.0.0.1:5173').origin;
if (target === '--remote' && !origin.startsWith('https:'))
  throw new Error('Remote credentials require the exact HTTPS site origin.');
const code = randomBytes(32).toString('base64url');
const claimId = randomUUID();
const sql = adminProvisionSQL({
  mode,
  userId: randomUUID(),
  claimId,
  tokenHash: createHash('sha256').update(code).digest('hex'),
  eventId: randomUUID(),
  now: Date.now(),
});
await mkdir('.cache/admin-access', { recursive: true });
const sqlFile = `.cache/admin-access/${claimId}.sql`;
await writeFile(sqlFile, sql, { mode: 0o600 });
// Remote --file imports return only an execution summary. Read the claim back
// with a separate query, keeping credentials out of command arguments/output.
function execute(extraArgs) {
  return spawnSync(
    process.execPath,
    [
      path.resolve('node_modules/wrangler/bin/wrangler.js'),
      'd1',
      'execute',
      'DB',
      '--config',
      path.resolve('wrangler.jsonc'),
      ...(envArg ? ['--env', envArg.slice('--env='.length)] : []),
      target,
      '--json',
      ...extraArgs,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_LOG_PATH: path.resolve('.cache/wrangler'),
      },
    },
  );
}
const result = execute(['--file', sqlFile]);
await unlink(sqlFile);
if (result.status !== 0)
  throw new Error(
    'Operator request failed. Confirm the selected database and apply its migrations.',
  );
const verified = execute([
  '--command',
  `SELECT id,purpose FROM account_claim WHERE id='${claimId}' AND used_at IS NULL AND revoked_at IS NULL`,
]);
if (verified.status !== 0) throw new Error('Operator verification failed.');
const jsonStart = verified.stdout.search(/^\s*\[/m);
if (jsonStart < 0) throw new Error('Operator response did not contain a JSON result.');
const entries = JSON.parse(verified.stdout.slice(jsonStart));
const row = entries.flatMap((entry) => entry.results ?? []).find((row) => row.id === claimId);
if (!row)
  throw new Error(
    mode === 'bootstrap'
      ? 'An administrator already exists. Bootstrap did not replace it. Use explicit recover only if needed.'
      : 'No administrator exists. Run bootstrap first.',
  );
const filename = `.cache/admin-access/${claimId}.txt`;
await writeFile(
  filename,
  `管理员${row.purpose === 'activate' ? '激活' : '恢复'}凭证（${target}）\n${origin}/account?mode=${row.purpose}#code=${code}\n\n凭证：${code}\n请仅由网站所有者使用，激活时自行填写登录别称与密码。\n`,
  { mode: 0o600 },
);
console.log(
  `Administrator credential saved to ignored ${filename}. No password was set; no message was sent.`,
);
