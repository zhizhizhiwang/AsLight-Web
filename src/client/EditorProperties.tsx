import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Button } from './ui.tsx';
import { Icon } from './Icon.tsx';

function subscribe(callback: () => void) {
  const query = window.matchMedia('(max-width: 800px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
const isCompact = () => window.matchMedia('(max-width: 800px)').matches;
export function EditorProperties({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const compact = useSyncExternalStore(subscribe, isCompact),
    ref = useRef<HTMLDialogElement>(null),
    closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = window.document.activeElement;
    if (compact) ref.current?.showModal();
    else closeRef.current?.focus();
    return () => {
      ref.current?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [compact]);
  const content = (
    <>
      <header className="editor-properties-heading">
        <strong>{title}</strong>
        <Button ref={closeRef} variant="icon" aria-label="收起属性面板" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </header>
      <div className="editor-properties-content">
        {children}
        <Button onClick={onClose}>完成并返回画布</Button>
      </div>
    </>
  );
  return compact ? (
    <dialog ref={ref} className="editor-properties-dialog" aria-label={title} onCancel={onClose}>
      {content}
    </dialog>
  ) : (
    <aside
      className="editor-properties"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {content}
    </aside>
  );
}
