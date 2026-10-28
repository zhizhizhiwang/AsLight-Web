import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const mib = 1024 * 1024;
const budgets = { workerGzip: mib, clientJsGzip: 1.5 * mib, assetBytes: 2 * mib, assetCount: 1000 };
async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const filename = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(filename) : [filename];
      }),
    )
  ).flat();
}

const all = await walk('dist');
const client = all.filter((file) => file.startsWith(`dist${path.sep}client${path.sep}`));
const worker = all.filter((file) => !client.includes(file) && /\.[cm]?js$/.test(file));
if (!client.length || !worker.length)
  throw new Error('Missing client or Worker build output; run npm run build first.');
const failures = [];
async function compressedSize(files) {
  const sizes = await Promise.all(
    files.map(async (file) => gzipSync(await fs.readFile(file)).length),
  );
  return sizes.reduce((sum, bytes) => sum + bytes, 0);
}
const workerGzip = await compressedSize(worker);
const clientJsGzip = await compressedSize(client.filter((file) => /\.js$/.test(file)));
if (workerGzip > budgets.workerGzip) failures.push('Worker gzip budget exceeded');
if (clientJsGzip > budgets.clientJsGzip) failures.push('Client JS gzip budget exceeded');
if (client.length > budgets.assetCount) failures.push('Static asset count budget exceeded');
for (const file of client) {
  if ((await fs.stat(file)).size > budgets.assetBytes)
    failures.push(`Static asset too large: ${file}`);
}
console.log(
  `Build sizes: Worker ${(workerGzip / 1024).toFixed(1)} KiB gzip; client JS ${(clientJsGzip / 1024).toFixed(1)} KiB gzip; ${client.length} assets.`,
);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Project build budgets: passed (not a Cloudflare deployment verification).');
