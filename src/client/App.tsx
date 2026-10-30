import { Component, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { api } from './api.ts';
import { Icon } from './Icon.tsx';
import { Button, ButtonLink, SidebarLink } from './ui.tsx';
import { CourseMediaProvider, CourseImage, QuestArtwork } from './CourseContent.tsx';
import { QuestDetails } from './QuestDetails.tsx';
import { Account } from './Account.tsx';
import { Admin } from './Admin.tsx';
import { AdminLearning } from './AdminLearning.tsx';
import { authClient, requestJson } from './auth.ts';
import { contentAccessSchema } from '../shared/editor.ts';
import { progressLabel, rewardLabel } from './progress.ts';
import { memberMapSchema } from '../shared/progress.ts';
import type { QuestProgress } from '../shared/progress.ts';
import type { CourseMap, Quest, QuestKind, QuestMap } from '../shared/quests.ts';
import { courseLocation, courseSearch } from './course-navigation.ts';

const QuestGraph = lazy(() => import('./QuestGraph.tsx'));
const ContentEditor = lazy(() => import('./ContentEditor.tsx'));
const pages = [
  { path: '/flow', title: '流程图', icon: 'flow' },
  { path: '/tasks', title: '任务列表', icon: 'list' },
  { path: '/overview', title: '主页面', icon: 'overview' },
] as const;
const filters = [
  { value: 'all', label: '全部任务', shortLabel: '全部' },
  { value: 'main', label: '主线任务', shortLabel: '主线' },
  { value: 'side', label: '支线任务', shortLabel: '支线' },
] as const;

export type QuestFilter = 'all' | QuestKind;

class GraphBoundary extends Component<
  { children: ReactNode; search: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="empty-state" role="alert">
        <p>流程图加载失败。</p>
        <ButtonLink to={{ pathname: '/tasks', search: this.props.search }}>
          查看任务列表 <span aria-hidden="true">↗</span>
        </ButtonLink>
      </div>
    ) : (
      this.props.children
    );
  }
}

function TaskList({
  quests,
  progress,
  onSelect,
}: {
  quests: Quest[];
  progress: QuestProgress[] | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="task-list-page">
      <div className="list-heading">
        <span>任务</span>
        <span className="list-prerequisites">前置任务</span>
        <span>学习状态</span>
      </div>
      <ol className="quest-list">
        {quests.map((quest) => (
          <li key={quest.id}>
            <button
              id={`quest-trigger-${quest.id}`}
              onClick={() => onSelect(quest.id)}
              aria-label={`查看${quest.title}`}
            >
              <span className={`list-quest-mark ${quest.kind}`} aria-hidden="true">
                <QuestArtwork quest={quest} />
              </span>
              <span className="list-quest-name">
                <strong>{quest.title}</strong>
                <small>{quest.kind === 'main' ? '主线任务' : '支线任务'}</small>
              </span>
              <span className="list-prerequisites">
                {quest.prerequisites.length ? '有前置任务' : '无前置任务'}
              </span>
              <span className="content-pending">
                {progressLabel(progress?.find((item) => item.questId === quest.id))}
                {rewardLabel(progress?.find((item) => item.questId === quest.id)) && (
                  <small
                    className={`reward-badge ${progress?.find((item) => item.questId === quest.id)?.rewardStatus}`}
                  >
                    {rewardLabel(progress?.find((item) => item.questId === quest.id))}
                  </small>
                )}
              </span>
              <Icon name="arrow" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Overview({
  map,
  progress,
  search,
}: {
  map: QuestMap;
  progress: QuestProgress[] | null;
  search: string;
}) {
  const mainCount = map.quests.filter((quest) => quest.kind === 'main').length;
  return (
    <div className="overview-page">
      <section className="chapter-card">
        <div className="chapter-emblem" aria-hidden="true">
          <CourseImage
            assetId={map.chapter.presentation?.iconAssetId}
            decorative
            fallback={<Icon name="chapter" />}
          />
        </div>
        <div className="chapter-copy">
          <p className="section-kicker">当前章节</p>
          <h2>{map.chapter.title}</h2>
          <p>{map.chapter.description}</p>
        </div>
        <ButtonLink to={{ pathname: '/flow', search }}>
          查看流程图 <Icon name="arrow" />
        </ButtonLink>
      </section>
      <dl className="catalog-stats" aria-label="任务结构统计">
        <div>
          <dt>全部任务</dt>
          <dd>
            {map.quests.length}
            <span>项</span>
          </dd>
        </div>
        <div>
          <dt>主线任务</dt>
          <dd>
            {mainCount}
            <span>项</span>
          </dd>
        </div>
        <div>
          <dt>支线任务</dt>
          <dd>
            {map.quests.length - mainCount}
            <span>项</span>
          </dd>
        </div>
      </dl>
      <section className="overview-section">
        <div className="section-heading">
          <h2>任务入口</h2>
          <span>{map.chapter.title}</span>
        </div>
        <div className="entry-links">
          <Link to={{ pathname: '/flow', search }}>
            <Icon name="flow" />
            <span>
              <strong>流程图</strong>
              <small>查看任务之间的关系</small>
            </span>
            <Icon name="arrow" />
          </Link>
          <Link to={{ pathname: '/tasks', search }}>
            <Icon name="list" />
            <span>
              <strong>任务列表</strong>
              <small>按顺序查看全部任务</small>
            </span>
            <Icon name="arrow" />
          </Link>
        </div>
      </section>
      <p className="overview-note">
        {progress
          ? `你的进度：${progress.filter((item) => item.learningStatus === 'in_progress').length} 项学习中，${progress.filter((item) => item.learningStatus === 'passed').length} 项已通过。`
          : '登录后可保存自己的学习进度。'}{' '}
        当前任务内容待添加。
      </p>
    </div>
  );
}

export function App() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [course, setCourse] = useState<CourseMap | null>(null);
  const [chaptersExpanded, setChaptersExpanded] = useState(false);
  const [memberData, setMemberData] = useState<{
    owner: string | undefined;
    progress: QuestProgress[] | null;
  } | null>(null);
  const allProgress =
    memberData?.owner === session?.user.id ? (memberData?.progress ?? null) : null;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [editorAccess, setEditorAccess] = useState<{ owner: string; canEdit: boolean } | null>(
    null,
  );
  const [editorVisited, setEditorVisited] = useState(false);
  const [accessError, setAccessError] = useState(false);
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const canEdit = editorAccess?.owner === session?.user.id && editorAccess?.canEdit;
  useEffect(() => {
    if (!session?.user.id) {
      setEditorAccess(null);
      return;
    }
    const owner = session.user.id,
      controller = new AbortController();
    setAccessError(false);
    void requestJson('/api/content/access', undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setEditorAccess({ owner, canEdit: contentAccessSchema.parse(result).canEdit });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAccessError(true);
      });
    return () => controller.abort();
  }, [session?.user.id, pathname, retry]);
  useEffect(() => {
    if (pathname === '/content') setEditorVisited(true);
  }, [pathname]);
  const page =
    pathname === '/account' ||
    pathname === '/admin' ||
    pathname === '/admin/learning' ||
    pathname === '/content'
      ? {
          title:
            pathname === '/content'
              ? '章节设计'
              : pathname === '/admin/learning'
                ? '线下考核与奖励'
                : pathname === '/admin'
                  ? '成员管理'
                  : '个人账号',
        }
      : pages.find((item) => item.path === pathname);
  const rawFilter = params.get('kind');
  const filter: QuestFilter = rawFilter === 'main' || rawFilter === 'side' ? rawFilter : 'all';
  const selectedId = params.get('quest');
  const location = course ? courseLocation(course, params) : null;
  const chapter = location?.chapter;
  const map: QuestMap | null =
    course && chapter
      ? {
          mode: course.mode,
          chapter,
          quests: course.quests.filter((quest) => quest.chapterId === chapter.id),
        }
      : null;
  const progress =
    allProgress?.filter((item) => map?.quests.some((quest) => quest.id === item.questId)) ?? null;
  const selected = location?.quest;
  const taskPage = pathname === '/flow' || pathname === '/tasks';
  const coursePage = taskPage || pathname === '/overview' || pathname === '/';

  useEffect(() => {
    if (coursePage && chapter && !params.has('chapter') && !location?.issue) {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set('chapter', chapter.id);
          return next;
        },
        { replace: true },
      );
    }
  }, [coursePage, chapter?.id, params, setParams, location?.issue]);

  useEffect(() => {
    const collapse = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChaptersExpanded(false);
    };
    window.addEventListener('keydown', collapse);
    return () => window.removeEventListener('keydown', collapse);
  }, []);

  useEffect(() => {
    if (sessionPending) return;
    const controller = new AbortController();
    setError('');
    void (async () => {
      try {
        const response = await api.api.member['quest-map'].$get(
          {},
          { init: { signal: controller.signal } },
        );
        if (!response.ok) throw new Error('Request failed');
        const result = memberMapSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setCourse(result.map);
          setMemberData({ owner: session?.user.id, progress: result.progress });
        }
      } catch {
        if (!controller.signal.aborted) setError('暂时无法加载任务，请重试。');
      }
    })();
    return () => controller.abort();
  }, [retry, session?.user.id, sessionPending]);

  useEffect(() => {
    document.title = `${page?.title ?? '任务面板'} · Aslight`;
  }, [page?.title]);

  const selectQuest = useCallback(
    (id: string) => {
      const target = course?.quests.find((quest) => quest.id === id);
      if (!target) return;
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('chapter', target.chapterId);
        if (target.chapterId !== chapter?.id && filter !== 'all' && target.kind !== filter)
          next.delete('kind');
        next.set('quest', id);
        return next;
      });
    },
    [setParams, course, chapter?.id, filter],
  );
  const closeQuest = useCallback(() => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('quest');
        return next;
      },
      { replace: true },
    );
    requestAnimationFrame(() => {
      (
        document.getElementById(`quest-trigger-${selectedId}`) ??
        document.getElementById('page-content')
      )?.focus();
    });
  }, [setParams, selectedId]);
  const changeFilter = (nextFilter: QuestFilter) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('quest');
      if (nextFilter === 'all') next.delete('kind');
      else next.set('kind', nextFilter);
      return next;
    });
  };
  const navigationSearch = `?${courseSearch(params, chapter?.id).toString()}`;
  const visibleQuests =
    map?.quests.filter((quest) => filter === 'all' || quest.kind === filter) ?? [];

  return (
    <CourseMediaProvider assets={course?.assets ?? []}>
      <div className="app-shell">
        <a href="#page-content" className="skip-link">
          跳到主要内容
        </a>
        {chaptersExpanded && (
          <button
            className="chapter-backdrop"
            aria-label="收起章节列表"
            onClick={() => setChaptersExpanded(false)}
          />
        )}
        <aside
          className={`sidebar${chaptersExpanded ? ' chapters-expanded' : ''}`}
          aria-label="应用侧边栏"
        >
          <Link
            className="brand"
            to={{ pathname: '/flow', search: navigationSearch }}
            aria-label="Aslight 任务面板"
          >
            <span className="brand-mark">a.</span>
            <span className="brand-name">
              aslight<small>WOTA ARTS</small>
            </span>
          </Link>
          <div className="sidebar-section-label">任务面板</div>
          <nav className="page-navigation" aria-label="主要导航">
            {pages.map((item) => (
              <SidebarLink
                key={item.path}
                icon={item.icon}
                to={{
                  pathname: item.path,
                  search: navigationSearch,
                }}
                onClick={() => setChaptersExpanded(false)}
              >
                {item.title}
              </SidebarLink>
            ))}
          </nav>
          <div className="sidebar-divider" />
          <div className="sidebar-section-label">章节</div>
          <Button
            className="chapter-toggle"
            aria-label={chaptersExpanded ? '收起章节' : '展开章节'}
            aria-expanded={chaptersExpanded}
            aria-controls="chapter-navigation"
            onClick={() => setChaptersExpanded((value) => !value)}
          >
            {chaptersExpanded ? '收起章节' : '章节'}
          </Button>
          <nav id="chapter-navigation" className="chapter-navigation" aria-label="章节列表">
            {course?.chapters.map((item, index) => (
              <Link
                key={item.id}
                to={{
                  pathname: coursePage && pathname !== '/' ? pathname : '/flow',
                  search: `?${courseSearch(params, item.id).toString()}`,
                }}
                className={`sidebar-chapter${chapter?.id === item.id ? ' active' : ''}`}
                aria-current={chapter?.id === item.id ? 'true' : undefined}
                aria-label={item.title}
                title={item.title}
                onClick={() => setChaptersExpanded(false)}
              >
                <span className="chapter-number" aria-hidden="true">
                  <CourseImage
                    assetId={item.presentation?.iconAssetId}
                    decorative
                    fallback={item.icon ?? String(index + 1).padStart(2, '0')}
                  />
                </span>
                <span>{item.title}</span>
              </Link>
            ))}
            {!course && (
              <span className="sidebar-status">{error ? '章节加载失败' : '正在加载…'}</span>
            )}
            {course?.chapters.length === 0 && <span className="sidebar-status">暂无章节</span>}
          </nav>
          {(session?.user.role === 'admin' || canEdit) && (
            <nav className="admin-navigation" aria-label="管理导航">
              {canEdit && (
                <SidebarLink
                  icon="edit"
                  to={{ pathname: '/content', search: navigationSearch }}
                  onClick={() => setChaptersExpanded(false)}
                >
                  章节设计
                </SidebarLink>
              )}
              {session?.user.role === 'admin' && (
                <SidebarLink icon="admin" to="/admin" onClick={() => setChaptersExpanded(false)}>
                  管理后台
                </SidebarLink>
              )}
            </nav>
          )}
          <Link
            to="/account"
            className="sidebar-footer account-entry"
            aria-label={session ? '个人账号' : '登录或激活账号'}
          >
            <span className="preview-indicator" />
            <span className="account-name">
              {session ? session.user.name : '登录 / 激活'}
              <small>{session ? '个人账号' : '保存学习进度'}</small>
            </span>
            <span className="account-mobile-label">账号</span>
          </Link>
        </aside>
        <main id="page-content" className="main-content" tabIndex={-1} inert={chaptersExpanded}>
          <header className="page-header">
            <div className="page-heading">
              <p className="section-kicker">
                任务面板 <span aria-hidden="true">/</span> {chapter?.title ?? '章节'}
              </p>
              <h1>{page?.title ?? '任务面板'}</h1>
            </div>
            <div className="preview-label">
              <span className="preview-indicator" />
              <span>
                内容待添加
                <span className="preview-label-detail">
                  {' '}
                  · {session ? '账号进度' : '登录后保存'}
                </span>
              </span>
            </div>
          </header>
          {taskPage && (
            <div className="page-toolbar">
              <div className="task-filters" role="group" aria-label="任务类型">
                {filters.map((item) => (
                  <Button
                    variant="ghost"
                    key={item.value}
                    aria-label={item.label}
                    aria-pressed={filter === item.value}
                    onClick={() => changeFilter(item.value)}
                  >
                    <span className={`filter-dot ${item.value}`} aria-hidden="true" />
                    <span>{item.shortLabel}</span>
                  </Button>
                ))}
              </div>
              <span className="task-count">{visibleQuests.length} 项任务</span>
            </div>
          )}
          <div className={`page-content ${taskPage ? 'task-page' : ''}`}>
            {pathname === '/admin/learning' ? (
              <AdminLearning />
            ) : pathname === '/admin' ? (
              <Admin onPermissionChanged={() => setRetry((value) => value + 1)} />
            ) : pathname === '/content' ? (
              !canEdit && (
                <div className="empty-state">
                  {accessError ? (
                    <>
                      <p role="alert">无法检查编辑权限，请重试。</p>
                      <Button onClick={() => setRetry((v) => v + 1)}>重新检查</Button>
                    </>
                  ) : sessionPending || (session && editorAccess?.owner !== session.user.id) ? (
                    <p role="status">正在检查编辑权限…</p>
                  ) : (
                    <>
                      <p>需要内容编辑权限。请管理员在成员管理中分配。</p>
                      <ButtonLink to="/account">个人账号</ButtonLink>
                    </>
                  )}
                </div>
              )
            ) : pathname === '/account' ? (
              <Account />
            ) : !coursePage ? (
              <div className="empty-state">
                <p>页面不存在。</p>
                <ButtonLink to={{ pathname: '/flow', search: navigationSearch }}>
                  返回流程图
                </ButtonLink>
              </div>
            ) : pathname === '/' ? (
              <Navigate to={{ pathname: '/flow', search: params.toString() }} replace />
            ) : error ? (
              <div className="empty-state" role="alert">
                <p>{error}</p>
                <Button onClick={() => setRetry((value) => value + 1)}>重新加载</Button>
              </div>
            ) : coursePage && location?.issue ? (
              <div className="empty-state" role="alert">
                <p>{location.issue}</p>
                <ButtonLink
                  to={{ pathname, search: `?${courseSearch(params, chapter?.id).toString()}` }}
                >
                  返回章节
                </ButtonLink>
              </div>
            ) : course && course.chapters.length === 0 ? (
              <div className="empty-state">暂无可浏览的章节，请稍后再来。</div>
            ) : !map ? (
              <div className="empty-state" role="status">
                正在加载任务…
              </div>
            ) : (
              <Routes>
                <Route
                  path="/"
                  element={
                    <Navigate to={{ pathname: '/flow', search: navigationSearch }} replace />
                  }
                />
                <Route
                  path="/flow"
                  element={
                    <div className="flow-page">
                      <div className="map-stage">
                        <GraphBoundary key={map.chapter.id} search={navigationSearch}>
                          <Suspense
                            fallback={
                              <div className="empty-state" role="status">
                                正在加载流程图…
                              </div>
                            }
                          >
                            <QuestGraph
                              key={map.chapter.id}
                              quests={map.quests}
                              presentation={map.chapter.presentation}
                              filter={filter}
                              progress={progress}
                              selectedId={selectedId}
                              onSelect={selectQuest}
                            />
                          </Suspense>
                        </GraphBoundary>
                      </div>
                      <div className="map-footer">
                        <span>
                          <i className="legend-mark main" />
                          主线
                          <i className="legend-mark side" />
                          支线
                        </span>
                        <span className="desktop-map-hint">拖动平移 · 滚轮缩放</span>
                        <span className="mobile-map-hint">拖动查看 · 双指缩放</span>
                      </div>
                    </div>
                  }
                />
                <Route
                  path="/tasks"
                  element={
                    visibleQuests.length ? (
                      <TaskList quests={visibleQuests} progress={progress} onSelect={selectQuest} />
                    ) : (
                      <div className="empty-state">暂无该类型任务。</div>
                    )
                  }
                />
                <Route
                  path="/overview"
                  element={<Overview map={map} progress={progress} search={navigationSearch} />}
                />
                <Route
                  path="*"
                  element={
                    <div className="empty-state">
                      <p>页面不存在。</p>
                      <ButtonLink to="/flow">返回流程图</ButtonLink>
                    </div>
                  }
                />
              </Routes>
            )}
            {editorVisited && canEdit && (
              <div hidden={pathname !== '/content'}>
                <Suspense fallback={<div className="empty-state">正在加载章节设计…</div>}>
                  <ContentEditor
                    key={session?.user.id}
                    active={pathname === '/content'}
                    onSaved={() => setRetry((value) => value + 1)}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </main>
        {selected && course && taskPage && !error && (
          <QuestDetails
            key={`${selected.id}:${session?.user.id ?? 'anonymous'}`}
            quest={selected}
            quests={course.quests}
            chapters={course.chapters}
            onSelect={selectQuest}
            onClose={closeQuest}
            progress={progress?.find((item) => item.questId === selected.id)}
            onStarted={() => setRetry((value) => value + 1)}
          />
        )}
      </div>
    </CourseMediaProvider>
  );
}
