import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { adminProvisionSQL } from './admin-provision.mjs';

const [mode, target, originArg, ...extra] = process.argv.slice(2);
if (
  !['bootstrap', 'recover'].includes(mode) ||
  !['--local', '--remote'].includes(target) ||
  extra.length ||
  (originArg && !originArg.startsWith('--origin=')) ||
  (target === '--remote' && !originArg)
)
  throw new Error(
    'Usage: npm run auth:admin -- bootstrap|recover --local|--remote [--origin=https://your-site.example]',
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
const result = spawnSync(
  process.execPath,
  [
    path.resolve('node_modules/wrangler/bin/wrangler.js'),
    'd1',
    'execute',
    'DB',
    target,
    '--json',
    '--file',
    sqlFile,
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
await unlink(sqlFile);
if (result.status !== 0)
  throw new Error(
    'Operator request failed. Confirm the selected database and apply its migrations.',
  );
const entries = JSON.parse(result.stdout);
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
