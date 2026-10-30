import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { demoQuestMap } from './data/demo-quests.ts';
import { assertAuthConfig, createAuth, currentUser } from './auth.ts';
import { member } from './member.ts';
import { access, AccessError } from './access.ts';
import { admin } from './admin.ts';
import { content } from './content.ts';
import { MAX_COURSE_BYTES } from '../shared/editor.ts';
import type { Bindings } from './bindings.ts';
import { videos, cleanupVideos } from './videos.ts';

export const app = new Hono<{ Bindings: Bindings }>()
  .use('*', secureHeaders({ referrerPolicy: 'no-referrer' }))
  .use('/api/*', async (c, next) =>
    bodyLimit({
      maxSize: c.req.path === '/api/content/course' ? MAX_COURSE_BYTES : 16 * 1024,
      onError: (c) => c.json({ error: { message: '请求内容过大。' } }, 413),
    })(c, next),
  )
  .get('/api/health', (c) =>
    c.json({ status: 'ok' as const, service: 'aslight', mode: 'scaffold' as const }),
  )
  .get('/api/demo/quest-map', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(demoQuestMap);
  })
  .use('/api/auth/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    try {
      assertAuthConfig(c.env, c.req.raw);
    } catch {
      return c.json({ error: { message: '账号服务尚未配置完成。' } }, 503);
    }
    const route = c.req.path.slice('/api/auth'.length);
    const allowed =
      c.req.method === 'GET'
        ? ['/get-session', '/list-sessions']
        : ['/sign-in/alias', '/sign-out', '/revoke-other-sessions', '/revoke-sessions'];
    if (!allowed.includes(route))
      return c.json({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404);
    if (c.req.method === 'POST' && c.req.header('Origin') !== c.env.APP_ORIGIN)
      return c.json({ error: { code: 'INVALID_ORIGIN', message: '请求来源不受信任。' } }, 403);
    if (
      route !== '/sign-in/alias' &&
      route !== '/sign-out' &&
      !(await currentUser(c.env, c.req.raw.headers))
    ) {
      if (route === '/get-session') return c.json(null);
      return c.json({ error: { code: 'NOT_SIGNED_IN', message: '请重新登录。' } }, 401);
    }
    await next();
  })
  .on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))
  .route('/api/member', member)
  .route('/api/access', access)
  .route('/api/content', content)
  .route('/api/videos', videos)
  .route('/api/admin', admin);

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404));
app.onError((error, c) =>
  error instanceof AccessError
    ? c.json({ error: { code: error.code, message: error.message } }, error.status)
    : c.json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试。' } }, 500),
);

export type AppType = typeof app;
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupVideos(env));
  },
};
