import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Field, Input, Panel, Select, Textarea } from './ui.tsx';
import { requestJson } from './auth.ts';
import { courseDocumentSchema, editorSnapshotSchema, MAX_COURSE_BYTES } from '../shared/editor.ts';
import type {
  CourseDocument,
  EditableChapter,
  EditableQuest,
  EditorSnapshot,
} from '../shared/editor.ts';
import { NumberField, AssetField, BlocksEditor, DecorationsEditor } from './ContentFields.tsx';
import { ContentPreview } from './ContentPreview.tsx';
import CourseCanvas from './CourseCanvas.tsx';
import { EditorProperties } from './EditorProperties.tsx';
import { CourseMediaProvider } from './CourseContent.tsx';
import { connectCourseTasks, duplicateCourseTasks, moveCourseItems } from './course-editing.ts';
import type { CanvasMove } from './course-editing.ts';
import type { ChapterPresentation } from '../shared/content.ts';
import './content-editor.css';

export default function ContentEditor({
  active,
  onSaved,
}: {
  active: boolean;
  onSaved: () => void;
}) {
  const [snapshot, setSnapshot] = useState<EditorSnapshot | null>(null);
  const [document, setDocument] = useState<CourseDocument | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [mobile, setMobile] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [reload, setReload] = useState(0);
  const [confirmReload, setConfirmReload] = useState(false);
  const [params, setParams] = useSearchParams();
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const dirty = Boolean(
    document && snapshot && JSON.stringify(document) !== JSON.stringify(snapshot.document),
  );
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    void requestJson('/api/content/course', undefined, controller.signal)
      .then((value) => {
        const next = editorSnapshotSchema.parse(value);
        if (!controller.signal.aborted) {
          setSnapshot(next);
          setDocument(next.document);
          setConfirmReload(false);
          pending.current = null;
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : '无法加载课程。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const chapter =
    document?.chapters.find((c) => c.id === params.get('chapter')) ?? document?.chapters[0];
  const task = document?.quests.find(
    (q) => q.id === params.get('quest') && q.chapterId === chapter?.id,
  );
  const canvasQuests = useMemo(
    () => document?.quests.filter((q) => q.chapterId === chapter?.id && !q.archived) ?? [],
    [document?.quests, chapter?.id],
  );
  const choose = (chapterId: string, questId?: string) => {
    setParams({ chapter: chapterId, ...(questId ? { quest: questId } : {}) });
    setInspectorOpen(Boolean(questId));
    setFocusToken((v) => v + 1);
  };
  function addTaskAt(position: { x: number; y: number }) {
    if (!document || !chapter || chapter.archived || busy) return;
    if (document.quests.length >= 1000) {
      setError('任务数量已达上限。');
      return;
    }
    const next: EditableQuest = {
      id: `quest-${crypto.randomUUID()}`,
      chapterId: chapter.id,
      title: `主线${document.quests.filter((q) => q.chapterId === chapter.id && q.kind === 'main').length + 1}`,
      summary: '任务内容待添加',
      kind: 'main',
      prerequisites: [],
      prerequisiteMode: 'all',
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      archived: false,
    };
    if (Math.abs(next.position.x) > 100000 || Math.abs(next.position.y) > 100000) {
      setError('新增位置超出画布范围，请返回任务附近。');
      return;
    }
    setDocument({ ...document, quests: [...document.quests, next] });
    setError('');
    setMessage('');
    choose(chapter.id, next.id);
  }
  function moveItems(moves: CanvasMove[], decorations = false) {
    if (!document || !chapter || busy || chapter.archived) return false;
    try {
      const next = moveCourseItems(document, moves);
      if (decorations) {
        const points = new Map(
          moves.map((m) => [m.id, { x: Math.round(m.position.x), y: Math.round(m.position.y) }]),
        );
        setDocument({
          ...document,
          chapters: document.chapters.map((c) =>
            c.id === chapter.id
              ? {
                  ...c,
                  presentation: {
                    ...c.presentation,
                    decorations: (c.presentation?.decorations ?? []).map((d) => ({
                      ...d,
                      position: points.get(d.id) ?? d.position,
                    })),
                  },
                }
              : c,
          ),
        });
      } else setDocument(next);
      setError('');
      setMessage('');
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法移动。');
      return false;
    }
  }
  function connect(source: string, target: string) {
    if (!document || busy) return false;
    try {
      setDocument(connectCourseTasks(document, source, target));
      setError('');
      setMessage('');
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法建立前置。');
      return false;
    }
  }
  function changeChapter(next: EditableChapter) {
    if (document) {
      setDocument({
        ...document,
        chapters: document.chapters.map((c) => (c.id === next.id ? next : c)),
      });
      setMessage('');
    }
  }
  function changeTask(next: EditableQuest) {
    if (document) {
      setDocument({
        ...document,
        quests: document.quests.map((q) => (q.id === next.id ? next : q)),
      });
      if (next.chapterId !== chapter?.id) choose(next.chapterId, next.id);
      setMessage('');
    }
  }
  function presentation(next: ChapterPresentation) {
    if (chapter) changeChapter({ ...chapter, presentation: next });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document || !snapshot || busy) return;
    const parsed = courseDocumentSchema.safeParse(document);
    if (!parsed.success) {
      setError('请检查内容：文字和图片说明不能为空，位置与尺寸须在允许范围内，列表每行须有内容。');
      const path = parsed.error.issues[0]?.path;
      const index = path?.[1];
      if (typeof index === 'number') {
        const invalidTask = path?.[0] === 'quests' ? document.quests[index] : undefined;
        const invalidChapter = path?.[0] === 'chapters' ? document.chapters[index] : undefined;
        if (invalidTask) choose(invalidTask.chapterId, invalidTask.id);
        else if (invalidChapter) choose(invalidChapter.id);
        setInspectorOpen(true);
      }
      return;
    }
    const payload = {
      expectedRevision: snapshot.revision,
      reason: reason.trim(),
      document: parsed.data,
    };
    const fingerprint = JSON.stringify(payload);
    if (!pending.current || pending.current.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: crypto.randomUUID() };
    const request = { ...payload, requestId: pending.current.id };
    if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_COURSE_BYTES) {
      setError('课程内容过大，请减少文字或装饰后再保存。');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = editorSnapshotSchema.parse(await requestJson('/api/content/course', request));
      setSnapshot(next);
      setDocument(next.document);
      setReason('');
      pending.current = null;
      setMessage('修改已保存并生效。其他人刷新即可看到。');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，你的修改仍保留在本页。');
    } finally {
      setBusy(false);
    }
  }
  const valid = document ? courseDocumentSchema.safeParse(document) : null;
  if (!snapshot || !document)
    return (
      <div className="content-editor">
        <Panel>
          <h2>章节设计</h2>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : (
            <p role="status">正在加载课程…</p>
          )}
          <Button disabled={busy} onClick={() => setReload((v) => v + 1)}>
            重新加载
          </Button>
        </Panel>
      </div>
    );
  return (
    <CourseMediaProvider assets={snapshot.assets}>
      <div className="content-editor" hidden={!active}>
        <form onSubmit={(event) => void save(event)}>
          <Panel className="editor-save">
            <div>
              <h2>章节设计</h2>
              <p className="account-note">
                保存后立即生效，其他人刷新即可查看。
                {dirty ? '本页有未保存的修改。' : '当前没有未保存的修改。'}
              </p>
              <p className="account-note">
                {snapshot.updatedAt
                  ? `最近修改：${snapshot.updatedBy ?? '内容编辑者'} · ${new Date(snapshot.updatedAt).toLocaleString('zh-CN')}`
                  : '尚无网页修改记录。'}
              </p>
            </div>
            <Field>
              修改说明
              <Input
                required
                maxLength={300}
                value={reason}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
                placeholder="简要说明本次改动"
              />
            </Field>
            <div className="control-group">
              <Button type="submit" variant="primary" disabled={busy || !dirty}>
                {busy ? '正在处理…' : '保存修改'}
              </Button>
              <Button
                disabled={busy}
                onClick={() => (dirty ? setConfirmReload(true) : setReload((v) => v + 1))}
              >
                重新加载课程
              </Button>
            </div>
            {confirmReload && (
              <div className="editor-reload" role="alert">
                <p>重新加载会丢弃本页未保存的修改。</p>
                <div className="control-group">
                  <Button disabled={busy} onClick={() => setReload((v) => v + 1)}>
                    丢弃修改并重新加载
                  </Button>
                  <Button onClick={() => setConfirmReload(false)}>保留本页修改</Button>
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="form-message">
                {message}
              </p>
            )}
          </Panel>
          <div className={`editor-layout${inspectorOpen ? ' has-properties' : ''}`}>
            <fieldset disabled={busy} className="editor-body">
              <legend className="sr-only">编辑课程</legend>
              <Panel className="editor-selector">
                <nav className="editor-chapter-list" aria-label="编辑章节列表">
                  <strong>章节</strong>
                  {document.chapters.map((c) => (
                    <Button
                      key={c.id}
                      aria-pressed={chapter?.id === c.id}
                      onClick={() => choose(c.id)}
                    >
                      {c.title}
                      {c.archived ? '（已归档）' : ''}
                    </Button>
                  ))}
                </nav>
                <Button
                  disabled={document.chapters.length >= 200}
                  onClick={() => {
                    const next: EditableChapter = {
                      id: `chapter-${crypto.randomUUID()}`,
                      title: '新章节',
                      description: '',
                      sortOrder: Math.max(-1, ...document.chapters.map((c) => c.sortOrder)) + 1,
                      icon: null,
                      archived: false,
                      presentation: {},
                    };
                    setDocument({ ...document, chapters: [...document.chapters, next] });
                    choose(next.id);
                    setInspectorOpen(true);
                  }}
                >
                  添加章节
                </Button>
                {chapter && (
                  <Button
                    onClick={() => {
                      setParams({ chapter: chapter.id });
                      setInspectorOpen(true);
                    }}
                  >
                    编辑章节属性
                  </Button>
                )}
                {chapter && (
                  <>
                    <Field>
                      编辑对象
                      <Select
                        value={task?.id ?? ''}
                        onChange={(e) => {
                          choose(chapter.id, e.target.value || undefined);
                          setInspectorOpen(true);
                        }}
                      >
                        <option value="">章节设置</option>
                        {document.quests
                          .filter((q) => q.chapterId === chapter.id)
                          .map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.title}
                              {q.archived ? '（已归档）' : ''}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Button
                      disabled={document.quests.length >= 1000 || chapter.archived}
                      onClick={() => addTaskAt({ x: canvasQuests.length * 200, y: 100 })}
                    >
                      添加任务
                    </Button>
                  </>
                )}
                <p className="account-note">
                  已有章节和任务使用归档隐藏，学习与审核记录会保留。图片只能选择已登记的公开课程素材，当前不提供上传。
                </p>
              </Panel>
            </fieldset>
            {active && chapter ? (
              <CourseCanvas
                key={chapter.id}
                quests={canvasQuests}
                presentation={chapter.presentation}
                selectedId={task?.id ?? null}
                focusToken={focusToken}
                disabled={busy || chapter.archived}
                onSelect={(id) => {
                  setParams({ chapter: chapter.id, ...(id ? { quest: id } : {}) });
                  setInspectorOpen(Boolean(id));
                }}
                onCreate={addTaskAt}
                onMove={(moves) => moveItems(moves)}
                onDecorationMove={(moves) => moveItems(moves, true)}
                onConnect={connect}
                onDisconnect={(source, target) => {
                  setDocument({
                    ...document,
                    quests: document.quests.map((q) =>
                      q.id === target
                        ? { ...q, prerequisites: q.prerequisites.filter((id) => id !== source) }
                        : q,
                    ),
                  });
                  setError('');
                  setMessage('');
                }}
                onDuplicate={(ids) => {
                  try {
                    const result = duplicateCourseTasks(
                      document,
                      ids,
                      () => `quest-${crypto.randomUUID()}`,
                    );
                    setDocument(result.document);
                    const first = result.ids[0];
                    if (first) choose(chapter.id, first);
                    setError('');
                    setMessage('');
                  } catch (error) {
                    setError(error instanceof Error ? error.message : '无法复制。');
                  }
                }}
                onProperties={() => {
                  setParams({ chapter: chapter.id });
                  setInspectorOpen(true);
                }}
              />
            ) : (
              <div className="empty-state">请先添加章节，再在画布放置任务。</div>
            )}
            {active && chapter && inspectorOpen && (
              <EditorProperties
                title={task ? '任务属性' : '章节属性'}
                onClose={() => setInspectorOpen(false)}
              >
                <fieldset disabled={busy} className="editor-properties-fields">
                  {task ? (
                    <Panel className="editor-form" key={task.id}>
                      <h3>任务设置</h3>
                      <Field>
                        任务名称
                        <Input
                          required
                          maxLength={120}
                          value={task.title}
                          onChange={(e) => changeTask({ ...task, title: e.target.value })}
                        />
                      </Field>
                      <Field>
                        任务摘要
                        <Textarea
                          maxLength={10000}
                          value={task.summary}
                          onChange={(e) => changeTask({ ...task, summary: e.target.value })}
                        />
                      </Field>
                      <div className="editor-fields">
                        <Field>
                          所属章节
                          <Select
                            value={task.chapterId}
                            onChange={(e) => changeTask({ ...task, chapterId: e.target.value })}
                          >
                            {document.chapters.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.title}
                                {c.archived ? '（已归档）' : ''}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field>
                          任务类型
                          <Select
                            value={task.kind}
                            onChange={(e) =>
                              changeTask({
                                ...task,
                                kind: e.target.value === 'side' ? 'side' : 'main',
                              })
                            }
                          >
                            <option value="main">主线</option>
                            <option value="side">支线</option>
                          </Select>
                        </Field>
                        <NumberField
                          label="横向位置"
                          value={task.position.x}
                          onChange={(x) =>
                            changeTask({ ...task, position: { ...task.position, x } })
                          }
                        />
                        <NumberField
                          label="纵向位置"
                          value={task.position.y}
                          onChange={(y) =>
                            changeTask({ ...task, position: { ...task.position, y } })
                          }
                        />
                      </div>
                      <AssetField
                        label="任务图片"
                        value={task.imageAssetId}
                        assets={snapshot.assets}
                        onChange={(imageAssetId) => {
                          const { imageAssetId: _image, ...rest } = task;
                          changeTask(imageAssetId ? { ...rest, imageAssetId } : rest);
                        }}
                      />
                      <fieldset className="editor-group">
                        <legend>前置任务</legend>
                        <p className="account-note">
                          已有学习记录时，前置与考核要求需要通过新增任务调整。
                        </p>
                        <Field>
                          通过条件
                          <Select
                            value={task.prerequisiteMode}
                            onChange={(e) =>
                              changeTask({
                                ...task,
                                prerequisiteMode: e.target.value === 'any' ? 'any' : 'all',
                              })
                            }
                          >
                            <option value="all">通过全部前置任务</option>
                            <option value="any">通过任意前置任务</option>
                          </Select>
                        </Field>
                        {task.prerequisites.map((id) => (
                          <div className="editor-prerequisite" key={id}>
                            <span>
                              {
                                document.chapters.find(
                                  (c) =>
                                    c.id === document.quests.find((q) => q.id === id)?.chapterId,
                                )?.title
                              }{' '}
                              · {document.quests.find((q) => q.id === id)?.title ?? '任务暂不可用'}
                            </span>
                            <Button
                              aria-label={`移除前置${document.quests.find((q) => q.id === id)?.title ?? id}`}
                              onClick={() =>
                                changeTask({
                                  ...task,
                                  prerequisites: task.prerequisites.filter((p) => p !== id),
                                })
                              }
                            >
                              移除
                            </Button>
                          </div>
                        ))}
                        <Field>
                          添加前置
                          <Select
                            value=""
                            onChange={(e) => {
                              if (e.target.value)
                                changeTask({
                                  ...task,
                                  prerequisites: [...task.prerequisites, e.target.value],
                                });
                            }}
                          >
                            <option value="">请选择任务</option>
                            {document.quests
                              .filter(
                                (q) =>
                                  q.id !== task.id &&
                                  !q.archived &&
                                  !task.prerequisites.includes(q.id) &&
                                  !document.chapters.find((c) => c.id === q.chapterId)?.archived,
                              )
                              .map((q) => (
                                <option key={q.id} value={q.id}>
                                  {document.chapters.find((c) => c.id === q.chapterId)?.title} ·{' '}
                                  {q.title}
                                </option>
                              ))}
                          </Select>
                        </Field>
                      </fieldset>
                      <BlocksEditor
                        label="任务图文"
                        value={task.content ?? []}
                        assets={snapshot.assets}
                        onChange={(content) => changeTask({ ...task, content })}
                      />
                      <BlocksEditor
                        label="考核内容"
                        value={task.assessmentContent ?? []}
                        assets={snapshot.assets}
                        onChange={(assessmentContent) => changeTask({ ...task, assessmentContent })}
                      />
                      <Button onClick={() => changeTask({ ...task, archived: !task.archived })}>
                        {task.archived ? '恢复任务' : '归档任务'}
                      </Button>
                      {task.archived && (
                        <p className="account-note">该任务已归档，保存后成员端将隐藏。</p>
                      )}
                    </Panel>
                  ) : (
                    <Panel className="editor-form" key={chapter.id}>
                      <h3>章节设置</h3>
                      <Field>
                        章节名称
                        <Input
                          required
                          maxLength={120}
                          value={chapter.title}
                          onChange={(e) => changeChapter({ ...chapter, title: e.target.value })}
                        />
                      </Field>
                      <Field>
                        章节说明
                        <Textarea
                          maxLength={5000}
                          value={chapter.description}
                          onChange={(e) =>
                            changeChapter({ ...chapter, description: e.target.value })
                          }
                        />
                      </Field>
                      <div className="editor-fields">
                        <NumberField
                          label="章节顺序"
                          value={chapter.sortOrder}
                          onChange={(sortOrder) => changeChapter({ ...chapter, sortOrder })}
                        />
                        <Field>
                          文字图标（选填）
                          <Input
                            maxLength={20}
                            value={chapter.icon ?? ''}
                            onChange={(e) =>
                              changeChapter({ ...chapter, icon: e.target.value || null })
                            }
                          />
                        </Field>
                      </div>
                      {(['iconAssetId', 'backgroundAssetId'] as const).map((key) => (
                        <AssetField
                          key={key}
                          label={key === 'iconAssetId' ? '章节图片图标' : '画布背景'}
                          value={chapter.presentation?.[key]}
                          assets={snapshot.assets}
                          onChange={(id) => {
                            const next = { ...chapter.presentation };
                            delete next[key];
                            presentation(id ? { ...next, [key]: id } : next);
                          }}
                        />
                      ))}
                      <fieldset className="editor-group">
                        <legend>初始视野</legend>
                        <Field>
                          视野方式
                          <Select
                            value={chapter.presentation?.viewport ? 'custom' : 'auto'}
                            onChange={(e) => {
                              const { viewport: _view, ...rest } = chapter.presentation ?? {};
                              presentation(
                                e.target.value === 'custom'
                                  ? { ...rest, viewport: { x: 0, y: 0, zoom: 1 } }
                                  : rest,
                              );
                            }}
                          >
                            <option value="auto">自动适应任务</option>
                            <option value="custom">自定义桌面视野</option>
                          </Select>
                        </Field>
                        {chapter.presentation?.viewport && (
                          <div className="editor-fields">
                            {(['x', 'y', 'zoom'] as const).map((key) => (
                              <NumberField
                                key={key}
                                label={
                                  key === 'x' ? '横向偏移' : key === 'y' ? '纵向偏移' : '缩放比例'
                                }
                                value={chapter.presentation?.viewport?.[key] ?? 1}
                                min={key === 'zoom' ? 0.35 : -100000}
                                max={key === 'zoom' ? 2 : 100000}
                                step={key === 'zoom' ? 0.05 : 1}
                                onChange={(n) => {
                                  const viewport = chapter.presentation?.viewport;
                                  if (viewport)
                                    presentation({
                                      ...chapter.presentation,
                                      viewport: { ...viewport, [key]: n },
                                    });
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </fieldset>
                      <DecorationsEditor
                        assets={snapshot.assets}
                        value={chapter.presentation?.decorations ?? []}
                        onChange={(decorations) =>
                          presentation({ ...chapter.presentation, decorations })
                        }
                      />
                      <Button
                        onClick={() => changeChapter({ ...chapter, archived: !chapter.archived })}
                      >
                        {chapter.archived ? '恢复章节' : '归档章节'}
                      </Button>
                      {chapter.archived && (
                        <p className="account-note">
                          该章节已归档，保存后本章全部任务将在成员端隐藏。
                        </p>
                      )}
                    </Panel>
                  )}
                </fieldset>
              </EditorProperties>
            )}
          </div>
        </form>
        <div className="editor-preview-toggle">
          <Button aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? '收起成员端预览' : '打开成员端预览'}
          </Button>
        </div>
        {showPreview && (
          <Panel className="editor-preview">
            <div className="control-group">
              <h3>效果预览</h3>
              <Button aria-pressed={!mobile} onClick={() => setMobile(false)}>
                桌面
              </Button>
              <Button aria-pressed={mobile} onClick={() => setMobile(true)}>
                手机
              </Button>
            </div>
            <p className="account-note">
              预览本页尚未保存的内容。点击任务可查看详情，不产生学习记录。归档内容不会出现在预览中。
            </p>
            {active && valid?.success ? (
              <ContentPreview
                key={`${chapter?.id}:${mobile}`}
                document={valid.data}
                assets={snapshot.assets}
                chapterId={chapter?.id ?? ''}
                mobile={mobile}
              />
            ) : (
              active && <p role="status">请先补全必填内容，再查看预览。</p>
            )}
          </Panel>
        )}
      </div>
    </CourseMediaProvider>
  );
}
