import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { demoQuestMap } from './data/demo-quests.ts';

const app = new Hono()
  .use('*', secureHeaders())
  .get('/api/health', (c) =>
    c.json({ status: 'ok' as const, service: 'aslight', mode: 'scaffold' as const }),
  )
  .get('/api/demo/quest-map', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(demoQuestMap);
  });

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404));
app.onError((_error, c) =>
  c.json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试。' } }, 500),
);

export type AppType = typeof app;
export default app;
