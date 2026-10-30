import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CourseMediaProvider } from './CourseContent.tsx';
import QuestGraph from './QuestGraph.tsx';
import { QuestDetails } from './QuestDetails.tsx';
import { Button } from './ui.tsx';
import type { CourseDocument } from '../shared/editor.ts';
import type { CourseAsset } from '../shared/content.ts';

export function ContentPreview({
  document,
  assets,
  chapterId,
  mobile,
}: {
  document: CourseDocument;
  assets: CourseAsset[];
  chapterId: string;
  mobile: boolean;
}) {
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (!selected && lastSelected.current)
      body?.ownerDocument.getElementById(`quest-trigger-${lastSelected.current}`)?.focus();
  }, [selected, body]);
  const [previewChapter, setPreviewChapter] = useState(chapterId);
  const chapters = document.chapters
    .filter((c) => !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const active = chapters.some((c) => c.id === previewChapter) ? previewChapter : chapters[0]?.id;
  const chapter = chapters.find((c) => c.id === active);
  const quests = document.quests.filter(
    (q) => !q.archived && chapters.some((c) => c.id === q.chapterId),
  );
  const task = quests.find((q) => q.id === selected);
  const select = (id: string) => {
    const q = quests.find((q) => q.id === id);
    if (q) {
      lastSelected.current = id;
      setSelected(id);
      setPreviewChapter(q.chapterId);
    }
  };
  return (
    <div className="editor-preview-scroll">
      <iframe
        title={mobile ? '手机课程预览' : '桌面课程预览'}
        className={`editor-preview-frame ${mobile ? 'mobile' : ''}`}
        srcDoc="<!doctype html><html lang='zh-CN'><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body></body></html>"
        onLoad={(e) => {
          const doc = e.currentTarget.contentDocument;
          if (!doc) return;
          for (const style of window.document.querySelectorAll('style,link[rel="stylesheet"]'))
            doc.head.appendChild(style.cloneNode(true));
          setBody(doc.body);
        }}
      />
      {body &&
        createPortal(
          <CourseMediaProvider assets={assets}>
            <div className="app-shell preview-shell">
              <aside className="sidebar" aria-label="预览章节">
                <span className="brand-mark">a.</span>
                <p className="account-note">课程预览</p>
                <nav className="chapter-navigation">
                  {chapters.map((c, i) => (
                    <Button
                      key={c.id}
                      title={c.title}
                      aria-pressed={c.id === active}
                      onClick={() => {
                        setPreviewChapter(c.id);
                        setSelected(null);
                      }}
                    >
                      {mobile ? i + 1 : c.title}
                    </Button>
                  ))}
                </nav>
              </aside>
              <main className="preview-main">
                <header className="preview-heading">
                  <strong>{chapter?.title ?? '暂无可浏览章节'}</strong>
                  <span>预览 · 不产生进度</span>
                </header>
                <div className="map-stage">
                  {chapter && (
                    <QuestGraph
                      key={`${chapter.id}:${mobile}:${JSON.stringify(chapter.presentation?.viewport)}`}
                      quests={quests.filter((q) => q.chapterId === chapter.id)}
                      presentation={chapter.presentation}
                      filter="all"
                      progress={null}
                      selectedId={selected}
                      onSelect={select}
                      preview
                      compactPreview={mobile}
                    />
                  )}
                </div>
              </main>
            </div>
            {task && (
              <QuestDetails
                key={task.id}
                quest={task}
                quests={quests}
                chapters={chapters}
                progress={undefined}
                onStarted={() => {}}
                onClose={() => setSelected(null)}
                onSelect={select}
                readOnlyPreview
              />
            )}
          </CourseMediaProvider>,
          body,
        )}
    </div>
  );
}
