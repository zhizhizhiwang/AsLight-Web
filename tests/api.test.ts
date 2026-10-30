import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import app from '../src/server/index.ts';

test('health reports scaffold status rather than claiming database readiness', async () => {
  const response = await app.request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'aslight', mode: 'scaffold' });
});
test('demo data is explicitly marked and contains no member identity', async () => {
  const response = await app.request('/api/demo/quest-map');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = z
    .object({ mode: z.string(), quests: z.array(z.object({ kind: z.string() })) })
    .parse(await response.json());
  assert.equal(body.mode, 'demo');
  assert.ok(body.quests.some((quest: { kind: string }) => quest.kind === 'side'));
  assert.equal('userId' in body, false);
});
test('unknown API paths return JSON 404 instead of the SPA', async () => {
  const response = await app.request('/api/does-not-exist', { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(
    z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code,
    'NOT_FOUND',
  );
});
test('the demonstration does not accept progress writes', async () => {
  const response = await app.request('/api/demo/quest-map', {
    method: 'POST',
    body: JSON.stringify({ passed: true }),
  });
  assert.equal(response.status, 404);
});
