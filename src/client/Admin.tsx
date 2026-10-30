import { Button, Input, Field, Panel, ButtonLink } from './ui.tsx';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { authClient, requestJson } from './auth.ts';

const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  alias: z.string().nullable(),
  state: z.enum(['pending', 'active']),
  role: z.enum(['member', 'admin']),
  createdAt: z.number(),
  canEdit: z.boolean(),
  permissionVersion: z.number().int(),
});
const membersSchema = z.object({ members: z.array(memberSchema) });
const issuedSchema = z.object({ code: z.string(), link: z.string(), expiresAt: z.number() });
type Member = z.infer<typeof memberSchema>;
type Issued = z.infer<typeof issuedSchema>;

export function Admin({ onPermissionChanged }: { onPermissionChanged: () => void }) {
  const { data, isPending } = authClient.useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [selected, setSelected] = useState<{
    member: Member;
    action: 'credential' | 'alias' | 'content-permission';
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const permitted = data?.user.role === 'admin';
  useEffect(() => {
    setIssued(null);
    setShowCode(false);
    setSelected(null);
    setMembers([]);
    if (!permitted) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const response = await fetch('/api/admin/members', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('无法加载成员，请确认仍有管理权限。');
        const result = membersSchema.parse(await response.json());
        if (!controller.signal.aborted) setMembers(result.members);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '无法加载成员。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [permitted, data?.user.id, retry]);
  async function submit(event: FormEvent<HTMLFormElement>, create: boolean) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      values = new FormData(form);
    setBusy(true);
    setError('');
    setMessage('');
    setIssued(null);
    setShowCode(false);
    try {
      if (create) {
        setIssued(
          issuedSchema.parse(
            await requestJson('/api/admin/members', {
              name: String(values.get('name') ?? '').trim(),
            }),
          ),
        );
        form.reset();
      } else if (selected) {
        const payload = {
          reason: String(values.get('reason') ?? '').trim(),
          ...(selected.action === 'alias'
            ? { alias: String(values.get('alias') ?? '').trim() }
            : {}),
          ...(selected.action === 'content-permission'
            ? {
                canEdit: !selected.member.canEdit,
                expectedVersion: selected.member.permissionVersion,
              }
            : {}),
        };
        const result = await requestJson(
          `/api/admin/members/${encodeURIComponent(selected.member.id)}/${selected.action}`,
          payload,
        );
        if (selected.action === 'credential') setIssued(issuedSchema.parse(result));
        else if (selected.action === 'content-permission') {
          setMessage(
            selected.member.canEdit
              ? '内容编辑权限已撤销。'
              : '内容编辑权限已授予，可以进入章节设计。',
          );
          onPermissionChanged();
        } else setMessage('登录别称已修改，该成员的原会话和未使用凭证已失效。');
        setSelected(null);
      }
      setMembers(membersSchema.parse(await requestJson('/api/admin/members')).members);
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未成功。');
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('已复制，请只私下交给确认过身份的对应成员。');
    } catch {
      setError('复制失败，可以显示凭证后手动复制。');
    }
  }
  if (isPending) return <div className="empty-state">正在检查管理权限…</div>;
  if (!permitted)
    return (
      <div className="empty-state">
        <p>{data ? '当前账号没有管理权限。' : '请先使用管理员账号登录。'}</p>
        <ButtonLink to="/account">前往个人账号</ButtonLink>
      </div>
    );
  return (
    <div className="admin-page">
      <ButtonLink to="/admin/learning">考核与奖励</ButtonLink>
      <Panel className="admin-create">
        <p className="section-kicker">成员管理</p>
        <h2>创建待激活成员</h2>
        <p>创建后将专属凭证私下交给成员，成员自行填写登录别称和密码。</p>
        <form className="form-stack" onSubmit={(event) => void submit(event, true)}>
          <Field>
            成员名称
            <Input name="name" required maxLength={40} />
          </Field>
          <Button variant="primary" type="submit" disabled={busy}>
            创建并生成激活凭证
          </Button>
        </form>
      </Panel>
      {issued && (
        <Panel className="credential-result" aria-label="专属凭证">
          <h2>凭证已生成</h2>
          <p>
            有效至 {new Date(issued.expiresAt).toLocaleString('zh-CN')}
            。仅显示这一次，重新生成将使旧凭证失效。
          </p>
          <Field>
            专属凭证
            <Input readOnly type={showCode ? 'text' : 'password'} value={issued.code} />
          </Field>
          <div className="control-group">
            <Button onClick={() => void copy(issued.link)}>复制专属链接</Button>
            <Button onClick={() => void copy(issued.code)}>复制凭证</Button>
            <Button onClick={() => setShowCode((value) => !value)}>
              {showCode ? '隐藏凭证' : '显示凭证'}
            </Button>
            <Button
              onClick={() => {
                setIssued(null);
                setShowCode(false);
              }}
            >
              关闭凭证
            </Button>
          </div>
          <p className="account-note">请先确认对应成员身份，再私下提供；系统不会发送短信或邮件。</p>
        </Panel>
      )}
      {selected && (
        <Panel aria-label="成员操作">
          <h2>
            {selected.action === 'content-permission'
              ? selected.member.canEdit
                ? '撤销内容编辑权限'
                : '授予内容编辑权限'
              : selected.action === 'alias'
                ? '修改登录别称'
                : selected.member.state === 'pending'
                  ? '重新生成激活凭证'
                  : '生成密码重设凭证'}
          </h2>
          <p>成员：{selected.member.name}</p>
          {selected.action === 'content-permission' && (
            <p>
              编辑权限只允许保存章节和任务，不授予成员管理、审核或发奖权限。管理员自身也需单独授权。
            </p>
          )}
          <form className="form-stack" onSubmit={(event) => void submit(event, false)}>
            {selected.action === 'alias' && (
              <Field>
                新登录别称（11 位数字）
                <Input
                  name="alias"
                  inputMode="numeric"
                  pattern="[0-9]{11}"
                  minLength={11}
                  maxLength={11}
                  required
                />
              </Field>
            )}
            <Field>
              操作原因
              <Input name="reason" required maxLength={200} />
            </Field>
            <Button variant="primary" type="submit" disabled={busy}>
              {selected.action === 'content-permission'
                ? '确认权限变更'
                : selected.action === 'alias'
                  ? '确认修改并退出成员的所有设备'
                  : '确认身份并生成凭证'}
            </Button>
            <Button type="button" disabled={busy} onClick={() => setSelected(null)}>
              取消
            </Button>
          </form>
        </Panel>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
          <Button disabled={busy} onClick={() => setRetry((value) => value + 1)}>
            重新加载成员
          </Button>
        </p>
      )}
      <Panel className="member-list-section">
        <h2>成员列表</h2>
        {loading ? (
          <p role="status">正在加载成员…</p>
        ) : !members.length ? (
          <p>暂无成员。</p>
        ) : (
          <ul className="member-list">
            {members.map((member) => (
              <li key={member.id}>
                <div>
                  <strong>{member.name}</strong>
                  <p>
                    {member.role === 'admin' ? '管理员' : '成员'} ·{' '}
                    {member.state === 'pending' ? '待激活' : '已激活'}
                    {member.alias ? ` · ${member.alias}` : ''}
                  </p>
                  <p>内容编辑：{member.canEdit ? '已授权' : '未授权'}</p>
                </div>
                {member.state === 'active' && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setSelected({ member, action: 'content-permission' });
                      setIssued(null);
                      setMessage('');
                    }}
                  >
                    {member.canEdit ? '撤销编辑权限' : '授予编辑权限'}
                  </Button>
                )}
                {member.role !== 'admin' && (
                  <div className="control-group">
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setSelected({ member, action: 'credential' });
                        setIssued(null);
                        setMessage('');
                      }}
                    >
                      {member.state === 'pending' ? '重新生成激活凭证' : '重设密码'}
                    </Button>
                    {member.state === 'active' && (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setSelected({ member, action: 'alias' });
                          setIssued(null);
                          setMessage('');
                        }}
                      >
                        修改别称
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
