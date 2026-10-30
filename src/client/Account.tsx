import { Button, Input, Field, Panel, ButtonLink } from './ui.tsx';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { authClient, authMessage, requestJson } from './auth.ts';

export function Account() {
  const { data, isPending, error: sessionError, refetch } = authClient.useSession();
  const [params, setParams] = useSearchParams();
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const rawMode = params.get('mode');
  const mode = rawMode === 'activate' || rawMode === 'reset' ? rawMode : 'login';
  useEffect(() => {
    const value = new URLSearchParams(hash.slice(1)).get('code');
    if (value) {
      setCode(value);
      navigate({ pathname, search, hash: '' }, { replace: true });
    }
  }, [hash, pathname, search, navigate]);
  function changeMode(next: 'login' | 'activate' | 'reset') {
    formRef.current?.reset();
    setCode('');
    setError('');
    setMessage('');
    setParams(next === 'login' ? {} : { mode: next });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'login') {
        await requestJson('/api/auth/sign-in/alias', {
          alias: value('alias').trim(),
          password: value('password'),
        });
        formRef.current?.reset();
        await refetch();
      } else {
        await requestJson(
          mode === 'activate' ? '/api/access/activate' : '/api/access/reset-password',
          {
            code: code.trim(),
            password: value('password'),
            ...(mode === 'activate'
              ? { alias: value('alias').trim(), name: value('name').trim() }
              : {}),
          },
        );
        formRef.current?.reset();
        setCode('');
        setParams({}, { replace: true });
        setMessage(
          mode === 'activate'
            ? '账号已激活，请使用登录别称和密码登录。'
            : '密码已重设，原登录会话已退出，请重新登录。',
        );
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未成功，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  async function revoke(all: boolean) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = all ? await authClient.signOut() : await authClient.revokeOtherSessions();
      if (result.error) setError(authMessage(result.error));
      else {
        if (all) await refetch();
        else setMessage('其他设备的会话已退出。');
      }
    } catch {
      setError('操作未成功，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  if (isPending)
    return (
      <div className="empty-state" role="status">
        正在检查登录状态…
      </div>
    );
  if (sessionError)
    return (
      <div className="empty-state" role="alert">
        <p>暂时无法连接账号服务。</p>
        <Button onClick={() => void refetch()}>重试</Button>
      </div>
    );
  return (
    <Panel>
      <p className="section-kicker">个人账号</p>
      <h2>
        {data
          ? data.user.name
          : mode === 'activate'
            ? '激活账号'
            : mode === 'reset'
              ? '重设密码'
              : '欢迎回来'}
      </h2>
      {data ? (
        <>
          <p>登录别称：{data.user.loginAlias}</p>
          <p>你的学习进度会随账号保存，换设备登录后可以继续。</p>
          <div className="control-group">
            <ButtonLink to="/flow">查看任务</ButtonLink>
            {data.user.role === 'admin' && <ButtonLink to="/admin">成员管理</ButtonLink>}
          </div>
          <div className="control-group">
            <Button disabled={busy} onClick={() => void revoke(false)}>
              退出其他设备
            </Button>
            <Button disabled={busy} onClick={() => void revoke(true)}>
              退出登录
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="control-group account-tabs" role="group" aria-label="账号操作">
            {(['login', 'activate', 'reset'] as const).map((value) => (
              <Button
                key={value}
                disabled={busy}
                aria-pressed={mode === value}
                onClick={() => changeMode(value)}
              >
                {value === 'login' ? '登录' : value === 'activate' ? '激活账号' : '重设密码'}
              </Button>
            ))}
          </div>
          {mode !== 'login' && (
            <p>
              {mode === 'activate'
                ? '请使用管理员私下提供的激活凭证，设置自己的登录别称和密码。'
                : '请先联系管理员确认身份，领取一次性重设凭证。'}
            </p>
          )}
          <form
            ref={formRef}
            key={mode}
            onSubmit={(event) => void submit(event)}
            className="form-stack"
          >
            {mode !== 'login' && (
              <Field>
                {mode === 'activate' ? '激活码' : '重设凭证'}
                <Input
                  name="code"
                  type="password"
                  autoComplete="off"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  minLength={43}
                  maxLength={43}
                />
              </Field>
            )}
            {mode !== 'reset' && (
              <Field>
                手机号
                <Input
                  name="alias"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{11}"
                  minLength={11}
                  maxLength={11}
                  autoComplete="username"
                  required
                />
              </Field>
            )}
            {mode === 'activate' && (
              <Field>
                昵称
                <Input name="name" autoComplete="nickname" required maxLength={40} />
              </Field>
            )}
            <Field>
              {mode === 'login' ? '密码' : '设置新密码'}
              <Input
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={10}
                maxLength={128}
              />
              <small>10–128 个字符</small>
            </Field>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy
                ? '正在处理…'
                : mode === 'login'
                  ? '登录'
                  : mode === 'activate'
                    ? '激活并设置密码'
                    : '保存新密码'}
            </Button>
          </form>
        </>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="account-note">
        手机号仅作为 11 位数字的登录别称，不验证号码归属。激活和密码重设均不发送短信或邮件。
      </p>
    </Panel>
  );
}
