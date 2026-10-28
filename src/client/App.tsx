import { Component, lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import type { QuestMap } from '../shared/quests.ts';

const QuestGraph = lazy(() => import('./QuestGraph.tsx'));

class GraphBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="empty-state" role="alert">
        地图加载失败，可以切换列表继续查看。
      </p>
    ) : (
      this.props.children
    );
  }
}

export function App() {
  const [map, setMap] = useState<QuestMap | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<'map' | 'list'>(() =>
    window.matchMedia('(max-width: 700px)').matches ? 'list' : 'map',
  );
  const [selectedId, setSelectedId] = useState('demo-start');

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void (async () => {
      try {
        const response = await api.api.demo['quest-map'].$get(
          {},
          { init: { signal: controller.signal } },
        );
        if (!response.ok) throw new Error('Request failed');
        const result = await response.json();
        if (!controller.signal.aborted) setMap(result);
      } catch {
        if (!controller.signal.aborted) setError('暂时无法加载任务路线，请重试。');
      }
    })();
    return () => controller.abort();
  }, [retry]);

  const selected = map?.quests.find((quest) => quest.id === selectedId);
  return (
    <div className="app-shell">
      <header className="site-header flex items-center justify-between gap-4">
        <a className="brand" href="/" aria-label="Aslight 首页">
          <span className="brand-mark">a.</span> aslight
        </a>
        <span className="header-note">WOTA ARTS · 一起练习，一点点进步</span>
      </header>
      <main>
        <section className="intro">
          <p className="eyebrow">YOUR NEXT MOVE</p>
          <h1>
            让每一次练习，
            <br />
            <span>都有下一步。</span>
          </h1>
          <p className="intro-copy">
            沿主线打好基础，在支线探索更多可能。
            <br />
            从一个动作，到属于你的完整演出。
          </p>
        </section>
        <div className="demo-notice" role="note">
          <span className="notice-dot" />
          课程结构预览 · 当前为示例任务，尚未开放账号与进度保存。
        </div>
        <section className="workspace" aria-label="学习路线">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">CHAPTER 01</p>
              <h2>{map?.chapter.title ?? '学习路线'}</h2>
            </div>
            <div className="view-toggle" role="group" aria-label="展示方式">
              <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
                路线图
              </button>
              <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
                任务列表
              </button>
            </div>
          </div>
          {error ? (
            <div className="empty-state" role="alert">
              <p>{error}</p>
              <button className="retry-button" onClick={() => setRetry((value) => value + 1)}>
                重新加载
              </button>
            </div>
          ) : !map ? (
            <p className="empty-state" role="status">
              正在加载学习路线…
            </p>
          ) : (
            <div className="workspace-body">
              <div className="map-panel">
                {view === 'map' ? (
                  <GraphBoundary>
                    <Suspense
                      fallback={
                        <p className="empty-state" role="status">
                          正在加载地图…
                        </p>
                      }
                    >
                      <QuestGraph
                        quests={map.quests}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                    </Suspense>
                  </GraphBoundary>
                ) : (
                  <ol className="quest-list">
                    {map.quests.map((quest, index) => (
                      <li key={quest.id}>
                        <button
                          className={selectedId === quest.id ? 'selected' : ''}
                          onClick={() => setSelectedId(quest.id)}
                          aria-pressed={selectedId === quest.id}
                        >
                          <span className="quest-number">{String(index + 1).padStart(2, '0')}</span>
                          <span>
                            <small>{quest.kind === 'main' ? '主线任务' : '支线任务'}</small>
                            <strong>{quest.title}</strong>
                          </span>
                          <span aria-hidden="true">↗</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="map-caption">主线与支线 · 连线表示前置任务关系</p>
              </div>
              <aside className="detail-panel" aria-live="polite">
                <p className="eyebrow">{selected?.kind === 'side' ? 'SIDE QUEST' : 'MAIN QUEST'}</p>
                <h3>{selected?.title}</h3>
                <p>{selected?.summary}</p>
                <div className="detail-divider" />
                <h4>前置任务</h4>
                <p>
                  {selected?.prerequisites.length
                    ? selected.prerequisites
                        .map((id) => map.quests.find((quest) => quest.id === id)?.title ?? id)
                        .join('、')
                    : '无前置任务。'}
                </p>
                <p className="preview-caption">当前仅预览任务结构，任务内容待添加。</p>
              </aside>
            </div>
          )}
        </section>
      </main>
      <footer>
        ASLIGHT <span>每一束光，都有自己的节奏。</span>
      </footer>
    </div>
  );
}
