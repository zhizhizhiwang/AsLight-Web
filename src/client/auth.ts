import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import type { Auth } from '../server/auth.ts';
import { z } from 'zod';

export const authClient = createAuthClient({ plugins: [inferAdditionalFields<Auth>()] });

const errors: Record<string, string> = {
  STALE_COURSE: '课程已被他人修改。你的修改仍保留在本页，请核对后重新加载，避免覆盖他人的修改。',
  INVALID_COURSE:
    '请检查章节、前置关系与图片引用；启用的任务不能依赖已归档内容，前置关系不能形成循环。',
  COURSE_IDENTITY: '已有章节和任务只能归档，不能删除。',
  LEARNING_RULE_LOCKED: '已有学习记录的任务不能直接修改前置或考核要求，请新增任务并归档旧任务。',
  STALE_STATE: '记录已变化，请重新加载后核对，再进行操作。',
  REQUEST_CONFLICT: '提交内容已变化，请重新加载后再操作。',
  ALREADY_DELIVERED: '该奖励已登记领取，请重新加载查看，勿重复发放。',
  NOT_SIGNED_IN: '登录已失效，请重新登录。',
  INVALID_ALIAS_OR_PASSWORD: '登录别称或密码不正确。',
  INVALID_CLAIM: '凭证无效、已使用或已过期，请联系管理员重新提供。',
  ALIAS_TAKEN: '该登录别称已被使用，请修改或联系管理员。',
  FORBIDDEN: '当前账号没有操作权限。',
  INVALID_INPUT: '请检查填写内容。',
  INVALID_PASSWORD: '密码不正确。',
  PASSWORD_TOO_SHORT: '密码至少需要 10 个字符。',
  PASSWORD_TOO_LONG: '密码最多 128 个字符。',
  INVALID_TOKEN: '链接无效或已过期，请重新申请。',
  TOKEN_EXPIRED: '链接已过期，请重新申请。',
  TOO_MANY_REQUESTS: '操作过于频繁，请稍后再试。',
};
const errorBody = z.object({
  code: z.string().optional(),
  error: z.object({ code: z.string().optional() }).optional(),
});
export async function requestJson(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const parsed = errorBody.safeParse(result);
    throw new Error(
      authMessage({
        code: parsed.success ? (parsed.data.error?.code ?? parsed.data.code) : undefined,
        status: response.status,
      }),
    );
  }
  return result;
}
export function authMessage(error: { code?: string | undefined; status?: number | undefined }) {
  return (
    errors[error.code ?? ''] ??
    (error.status === 429 ? '操作过于频繁，请稍后再试。' : '操作未成功，请检查填写内容或稍后重试。')
  );
}
