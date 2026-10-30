import { z } from 'zod';

// This is a login alias, deliberately not validation of a real telephone number.
export const loginAliasInput = z
  .string()
  .trim()
  .regex(/^[0-9]{11}$/, '请填写 11 位数字的登录别称。');
export const passwordInput = z.string().min(10).max(128);
export const claimCodeInput = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/);
export const activateInput = z.strictObject({
  code: claimCodeInput,
  alias: loginAliasInput,
  name: z.string().trim().min(1).max(40),
  password: passwordInput,
});
export const resetInput = z.strictObject({ code: claimCodeInput, password: passwordInput });
export const loginInput = z.strictObject({ alias: loginAliasInput, password: passwordInput });
