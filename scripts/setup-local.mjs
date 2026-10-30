import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

try {
  await writeFile('.dev.vars', `BETTER_AUTH_SECRET=${randomBytes(48).toString('base64url')}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log('Created ignored .dev.vars with a random local authentication secret.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Kept existing .dev.vars.');
}
