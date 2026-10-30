import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProductionBuild,
  assertLocalSecrets,
  productionTarget,
} from '../scripts/environment.ts';

const production = () => ({
  name: productionTarget.name,
  targetEnvironment: 'production',
  vars: { APP_ORIGIN: productionTarget.origin },
  d1_databases: [{ binding: 'DB', database_id: productionTarget.database }],
  routes: [{ pattern: 'aslighters.org', custom_domain: true }],
});
test('publishing rejects localhost, development D1, ambiguous bindings and a suffixed Worker', () => {
  assert.doesNotThrow(() => assertProductionBuild(production()));
  const wrongOrigin = production();
  wrongOrigin.vars.APP_ORIGIN = 'http://127.0.0.1:5173';
  const wrongDb = production();
  wrongDb.d1_databases[0]!.database_id = 'development-database';
  const wrongName = production();
  wrongName.name = 'aslight-production-production';
  const duplicate = production();
  duplicate.d1_databases.push({ binding: 'DB', database_id: 'development-database' });
  const wrongRoute = production();
  wrongRoute.routes = [];
  for (const input of [
    wrongOrigin,
    wrongDb,
    wrongName,
    duplicate,
    wrongRoute,
    { ...production(), targetEnvironment: undefined },
  ])
    assert.throws(() => assertProductionBuild(input));
});
test('local environments reject shared production storage and credentials, but accept isolated fixtures', () => {
  const prod = {
    B2_BUCKET_ID: 'production-bucket',
    B2_KEY_ID: 'production-key',
    BETTER_AUTH_SECRET: 'production-auth',
  };
  assert.doesNotThrow(() => assertLocalSecrets({}, prod));
  assert.doesNotThrow(() =>
    assertLocalSecrets(
      { B2_BUCKET_ID: 'test-bucket', B2_KEY_ID: 'test-key', BETTER_AUTH_SECRET: 'test-auth' },
      prod,
    ),
  );
  for (const [key, value] of Object.entries(prod))
    assert.throws(() => assertLocalSecrets({ [key]: value }, prod));
});
