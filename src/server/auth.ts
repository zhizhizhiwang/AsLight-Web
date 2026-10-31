import { betterAuth } from 'better-auth/minimal';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { loginInput } from '../shared/access.ts';
import { consumeLimit } from './security.ts';
import type { Bindings } from './bindings.ts';
import * as schema from './db/schema.ts';

export function assertAuthConfig(env: Bindings, request: Request) {
  const origin = new URL(env.APP_ORIGIN);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (
    !env.BETTER_AUTH_SECRET ||
    env.BETTER_AUTH_SECRET.length < 32 ||
    new URL(request.url).origin !== origin.origin ||
    (!local && origin.protocol !== 'https:')
  ) {
    throw new Error('Authentication is not configured for this origin.');
  }
}

export function createAuth(env: Bindings) {
  const db = drizzle(env.DB, { schema });
  const aliasPlugin = {
    id: 'aslight-alias',
    // Explicitly override the core email field. No synthetic email, verified
    // phone identity, OTP route or public account-creation route is introduced.
    schema: {
      user: {
        fields: { email: { type: 'string', required: false, input: false, returned: false } },
      },
    },
    endpoints: {
      signInAlias: createAuthEndpoint(
        '/sign-in/alias',
        { method: 'POST', body: loginInput },
        async (ctx) => {
          const record = await db
            .select()
            .from(schema.user)
            .where(eq(schema.user.loginAlias, ctx.body.alias))
            .get();
          const credential =
            record?.accountState === 'active'
              ? await db
                  .select()
                  .from(schema.account)
                  .where(
                    and(
                      eq(schema.account.userId, record.id),
                      eq(schema.account.providerId, 'credential'),
                      eq(schema.account.accountId, record.id),
                    ),
                  )
                  .get()
              : undefined;
          const invalid = () =>
            new APIError('UNAUTHORIZED', {
              code: 'INVALID_ALIAS_OR_PASSWORD',
              message: '登录别称或密码不正确。',
            });
          if (!record || !credential?.password) {
            await ctx.context.password.hash(ctx.body.password);
            throw invalid();
          }
          if (
            !(await ctx.context.password.verify({
              hash: credential.password,
              password: ctx.body.password,
            }))
          )
            throw invalid();
          const user = await ctx.context.internalAdapter.findUserById(record.id);
          if (!user) throw invalid();
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            false,
            { credentialVersion: record.credentialVersion },
            true,
          );
          if (!session) throw invalid();
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user: { id: record.id, name: record.name } });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
  return betterAuth({
    appName: 'Aslight',
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_ORIGIN,
    trustedOrigins: [env.APP_ORIGIN],
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false }),
    plugins: [aliasPlugin],
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
      additionalFields: {
        credentialVersion: { type: 'number', defaultValue: 0, input: false, returned: false },
      },
    },
    account: { accountLinking: { enabled: false } },
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: 'member', input: false },
        accountState: { type: 'string', defaultValue: 'pending', input: false },
        loginAlias: { type: 'string', required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const owner = await db
              .select({
                state: schema.user.accountState,
                credentialVersion: schema.user.credentialVersion,
              })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .get();
            return owner?.state === 'active' &&
              owner.credentialVersion === session.credentialVersion
              ? { data: session }
              : false;
          },
        },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.APP_ORIGIN.startsWith('https:'),
      },
    },
    logger: { disabled: true },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: { '/sign-in/alias': { window: 60, max: 10 } },
      customStorage: { consume: (key, rule) => consumeLimit(env, `auth:${key}`, rule) },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export async function currentIdentity(env: Bindings, headers: Headers) {
  const session = await createAuth(env).api.getSession({ headers });
  if (!session) return null;
  // Read authoritative status/role; never grant access from client data or a
  // stale session payload after an administrator changes an account.
  const row = await drizzle(env.DB)
    .select({ user: schema.user })
    .from(schema.user)
    .innerJoin(
      schema.session,
      and(
        eq(schema.session.id, session.session.id),
        eq(schema.session.userId, schema.user.id),
        eq(schema.session.credentialVersion, schema.user.credentialVersion),
      ),
    )
    .where(eq(schema.user.id, session.user.id))
    .get();
  return row?.user.accountState === 'active'
    ? { user: row.user, sessionId: session.session.id }
    : null;
}
export async function currentUser(env: Bindings, headers: Headers) {
  return (await currentIdentity(env, headers))?.user ?? null;
}
