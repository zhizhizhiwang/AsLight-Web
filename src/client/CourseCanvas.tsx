import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import type { Edge, Node, NodeProps } from '@xyflow/react';
import type { Quest } from '../shared/quests.ts';
import type { ChapterPresentation } from '../shared/content.ts';
import type { CanvasMove } from './course-editing.ts';
import { QuestMapNode, GraphControls } from './QuestGraph.tsx';
import type { QuestNode } from './QuestGraph.tsx';
import { CourseImage } from './CourseContent.tsx';
import { Button } from './ui.tsx';

type Decoration = NonNullable<ChapterPresentation['decorations']>[number];
type DecorationNode = Node<
  { item: Decoration; editable: boolean; onNudge: (id: string, x: number, y: number) => void },
  'decoration'
>;
type EditorNode = QuestNode | DecorationNode;
function isDecoration(node: EditorNode): node is DecorationNode {
  return node.type === 'decoration';
}
function EditableQuest(props: NodeProps<QuestNode>) {
  return <QuestMapNode {...props} data={{ ...props.data, selected: Boolean(props.selected) }} />;
}
function EditableDecoration({ id, data, selected }: NodeProps<DecorationNode>) {
  const item = data.item;
  return (
    <div
      className={`editor-decoration canvas-decoration--${item.type}${selected ? ' selected' : ''}`}
      tabIndex={data.editable ? 0 : undefined}
      role={data.editable ? 'button' : undefined}
      aria-label={`装饰：${item.type === 'text' ? item.text || '未填写文字' : item.alt}`}
      onKeyDown={(e) => {
        if (!data.editable) return;
        const step = e.shiftKey ? 1 : 10,
          dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (dx || dy) {
          e.preventDefault();
          e.stopPropagation();
          data.onNudge(id, dx, dy);
        }
      }}
    >
      {item.type === 'image' ? (
        <CourseImage assetId={item.assetId} alt={item.alt} />
      ) : (
        <span>{item.text || '请在章节设置中填写装饰文字'}</span>
      )}
    </div>
  );
}
const nodeTypes = { quest: EditableQuest, decoration: EditableDecoration };
function subscribeCompact(callback: () => void) {
  const query = window.matchMedia('(max-width:600px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
const isCompact = () => window.matchMedia('(max-width:600px)').matches;
type Props = {
  quests: Quest[];
  presentation: ChapterPresentation | undefined;
  selectedId: string | null;
  focusToken: number;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onCreate: (position: { x: number; y: number }) => void;
  onMove: (moves: CanvasMove[]) => boolean;
  onDecorationMove: (moves: CanvasMove[]) => boolean;
  onConnect: (source: string, target: string) => boolean;
  onDisconnect: (source: string, target: string) => boolean;
  feedback: string;
  onClearFeedback: () => void;
  onDuplicate: (ids: string[]) => void;
  onProperties: () => void;
};
export default function CourseCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
function Canvas(props: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [mode, setMode] = useState<'move' | 'select' | 'add' | 'connect' | 'decoration'>('move');
  const [source, setSource] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{ source: string; target: string } | null>(null);
  const [context, setContext] = useState<{
    left: number;
    top: number;
    position: { x: number; y: number };
  } | null>(null);
  const [count, setCount] = useState(0);
  const { screenToFlowPosition, fitView } = useReactFlow<EditorNode>();
  const compact = useSyncExternalStore(subscribeCompact, isCompact);
  const root = useRef<HTMLDivElement>(null),
    contextButton = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef(-1);
  const lastSelected = useRef<string | null>(props.selectedId);
  const current = useRef({ ...props, mode, source, nodes });
  current.current = { ...props, mode, source, nodes };
  const restore = useCallback(
    () =>
      setNodes((items) =>
        items.map((n) => {
          if (isDecoration(n)) {
            const item = current.current.presentation?.decorations?.find(
              (d) => d.id === n.data.item.id,
            );
            return item ? { ...n, position: item.position } : n;
          }
          const q = current.current.quests.find((q) => q.id === n.id);
          return q ? { ...n, position: q.position } : n;
        }),
      ),
    [setNodes],
  );
  const commit = useCallback(
    (items: EditorNode[]) => {
      const questMoves = items
        .filter((n) => !isDecoration(n))
        .map((n) => ({ id: n.id, position: n.position }));
      const artMoves = items
        .filter(isDecoration)
        .map((n) => ({ id: n.data.item.id, position: n.position }));
      const okay = questMoves.length
        ? current.current.onMove(questMoves)
        : artMoves.length
          ? current.current.onDecorationMove(artMoves)
          : true;
      if (!okay) restore();
    },
    [restore],
  );
  const nudge = useCallback(
    (id: string, x: number, y: number) => {
      if (
        current.current.disabled ||
        current.current.mode === 'connect' ||
        current.current.mode === 'add'
      )
        return;
      const all = current.current.nodes,
        target = all.find((n) => n.id === id);
      if (!target) return;
      const selected = target.selected ? all.filter((n) => n.selected) : [target];
      const next = selected.map((n) => ({
        ...n,
        position: { x: n.position.x + x, y: n.position.y + y },
      }));
      commit(next);
    },
    [commit],
  );
  const select = useCallback((id: string) => {
    if (current.current.disabled) return;
    if (current.current.mode === 'connect') {
      if (!current.current.source) setSource(id);
      else if (current.current.onConnect(current.current.source, id)) setSource(null);
    } else {
      lastSelected.current = id;
      current.current.onSelect(id);
    }
  }, []);
  useEffect(() => {
    const reset =
      lastFocus.current !== props.focusToken || lastSelected.current !== props.selectedId;
    lastFocus.current = props.focusToken;
    lastSelected.current = props.selectedId;
    setNodes((old) => [
      ...props.quests.map((q): QuestNode => ({
        id: q.id,
        type: 'quest',
        position: q.position,
        zIndex: 50,
        selected:
          mode !== 'decoration' &&
          (reset ? q.id === props.selectedId : (old.find((n) => n.id === q.id)?.selected ?? false)),
        draggable: !props.disabled && mode !== 'decoration' && mode !== 'connect' && mode !== 'add',
        selectable: mode !== 'decoration',
        data: {
          quest: q,
          progress: undefined,
          context: false,
          selected: false,
          crossChapter: q.prerequisites.some((id) => !props.quests.some((q) => q.id === id)),
          preview: true,
          editing: !props.disabled && mode !== 'decoration',
          onSelect: select,
          onNudge: nudge,
        },
      })),
      ...(props.presentation?.decorations ?? []).map((item): DecorationNode => ({
        id: `decoration:${item.id}`,
        type: 'decoration',
        position: item.position,
        width: item.width,
        height: item.height,
        style: {
          width: item.width,
          height: item.height,
          pointerEvents: mode === 'decoration' ? 'auto' : 'none',
        },
        zIndex: item.layer,
        selected:
          mode === 'decoration' &&
          (old.find((n) => n.id === `decoration:${item.id}`)?.selected ?? false),
        draggable: !props.disabled && mode === 'decoration',
        selectable: mode === 'decoration',
        data: { item, editable: !props.disabled && mode === 'decoration', onNudge: nudge },
      })),
    ]);
  }, [
    props.quests,
    props.presentation,
    props.disabled,
    props.focusToken,
    props.selectedId,
    mode,
    select,
    nudge,
    setNodes,
  ]);
  useEffect(() => {
    setEdges((old) =>
      props.quests.flatMap((q) =>
        q.prerequisites
          .filter((id) => props.quests.some((q) => q.id === id))
          .map((id) => ({
            id: `${id}:${q.id}`,
            source: id,
            target: q.id,
            type: 'smoothstep',
            zIndex: 30,
            selected: old.find((e) => e.id === `${id}:${q.id}`)?.selected ?? false,
            style: { stroke: q.kind === 'side' ? '#b29360' : '#829181', strokeWidth: 2 },
          })),
      ),
    );
  }, [props.quests, setEdges]);
  useEffect(() => {
    if (context) contextButton.current?.focus();
  }, [context]);
  const selectedTasks = () =>
    current.current.nodes.filter((n) => n.selected && !isDecoration(n)).map((n) => n.id);
  function changeMode(next: typeof mode) {
    setMode(next);
    setSource(null);
    props.onClearFeedback();
  }
  function createAtCenter() {
    const rect = root.current?.getBoundingClientRect();
    if (rect)
      props.onCreate(
        screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
      );
  }
  return (
    <div className="course-canvas-workspace">
      <div className="canvas-toolbar" role="group" aria-label="画布编排工具">
        <Button
          disabled={props.disabled}
          aria-pressed={mode === 'move'}
          onClick={() => {
            changeMode('move');
          }}
        >
          平移／移动
        </Button>
        <Button
          disabled={props.disabled}
          aria-pressed={mode === 'select'}
          onClick={() => {
            changeMode('select');
          }}
        >
          框选
        </Button>
        <Button
          disabled={props.disabled}
          aria-pressed={mode === 'add'}
          onClick={() => {
            changeMode('add');
          }}
        >
          在画布新增
        </Button>
        <Button disabled={props.disabled} onClick={createAtCenter}>
          在视野中心新增
        </Button>
        <Button
          disabled={props.disabled}
          aria-pressed={mode === 'connect'}
          onClick={() => {
            changeMode(mode === 'connect' ? 'move' : 'connect');
          }}
        >
          连接前置
        </Button>
        <Button
          disabled={props.disabled || !props.presentation?.decorations?.length}
          aria-pressed={mode === 'decoration'}
          onClick={() => {
            changeMode(mode === 'decoration' ? 'move' : 'decoration');
          }}
        >
          移动装饰
        </Button>
        <Button
          disabled={props.disabled || !count}
          onClick={() => props.onDuplicate(selectedTasks())}
        >
          复制选中{count ? `（${count}）` : ''}
        </Button>
        <Button disabled={props.disabled} onClick={props.onProperties}>
          章节设置
        </Button>
        <Button
          disabled={!count}
          onClick={() =>
            void fitView({
              nodes: selectedTasks().map((id) => ({ id })),
              maxZoom: 1.2,
              padding: 0.4,
            })
          }
        >
          定位选中
        </Button>
      </div>
      <p className="canvas-instructions" role="status">
        {mode === 'add'
          ? '点击画布空白处放置新任务。'
          : mode === 'connect'
            ? source
              ? `已选前置「${props.quests.find((q) => q.id === source)?.title ?? '任务'}」，再点击后续任务。`
              : '依次点击前置任务和后续任务；也可从右侧圆点连到后续任务左侧圆点。主线与支线均可作为前置。'
            : mode === 'select'
              ? '拖出矩形选择任务，拖动任一选中任务可成组移动。'
              : mode === 'decoration'
                ? '拖动图片或文字装饰，按方向键也可调整；任务暂不接收拖动。'
                : '拖动任务调整位置，拖动空白处平移；Ctrl／⌘ 可多选。选中任务后用方向键移动，Shift 配合方向键微调。'}
      </p>
      {props.feedback && (
        <div className="canvas-feedback form-error" role="alert">
          <span>{props.feedback}</span>
          <Button variant="ghost" onClick={props.onClearFeedback}>
            关闭提示
          </Button>
        </div>
      )}
      <div
        ref={root}
        className="course-editor-canvas"
        aria-label="章节编排画布"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setContext(null);
            changeMode('move');
            root.current?.focus();
          }
        }}
      >
        {props.presentation?.backgroundAssetId && (
          <div className="chapter-background" aria-hidden="true">
            <CourseImage assetId={props.presentation.backgroundAssetId} decorative />
          </div>
        )}
        <ReactFlow<EditorNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={(_event, _node, moved) => commit(moved)}
          onConnect={(connection) => {
            if (!props.disabled && props.onConnect(connection.source, connection.target))
              setSource(null);
          }}
          onEdgeClick={(_event, edge) =>
            setSelectedEdge({ source: edge.source, target: edge.target })
          }
          onSelectionChange={({ nodes: selection }) =>
            setCount(selection.filter((n) => n.type === 'quest').length)
          }
          onPaneClick={(event) => {
            setContext(null);
            setSelectedEdge(null);
            if (mode === 'add' && !props.disabled) {
              props.onCreate(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
              setMode('move');
            } else if (mode !== 'connect') props.onSelect(null);
          }}
          onPaneContextMenu={(event) => {
            if (props.disabled) return;
            event.preventDefault();
            const rect = root.current?.getBoundingClientRect();
            if (rect)
              setContext({
                left: Math.max(8, Math.min(event.clientX - rect.left, rect.width - 200)),
                top: Math.max(8, Math.min(event.clientY - rect.top, rect.height - 170)),
                position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              });
          }}
          nodesConnectable={!props.disabled && mode !== 'decoration'}
          nodesFocusable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          panOnDrag={mode === 'select' ? [1, 2] : mode === 'add' ? false : true}
          selectionOnDrag={mode === 'select'}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Control', 'Meta']}
          selectionMode={SelectionMode.Partial}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          fitView={!props.presentation?.viewport || compact}
          defaultViewport={props.presentation?.viewport ?? { x: 0, y: 0, zoom: 1 }}
          fitViewOptions={{
            padding: 0.3,
            maxZoom: 1.2,
            nodes: (compact ? props.quests.slice(0, 1) : props.quests).map((q) => ({ id: q.id })),
          }}
          minZoom={0.35}
          maxZoom={2}
          onMove={() => {
            if (context) setContext(null);
          }}
        >
          <Background color="#c8cec1" gap={24} size={1} />
          <GraphControls taskIds={props.quests.map((q) => q.id)} compact={compact} />
        </ReactFlow>
        {!props.quests.length && (
          <p className="canvas-empty-hint">本章暂无任务，点击“在画布新增”开始编排。</p>
        )}
        {selectedEdge && (
          <div className="canvas-edge-actions">
            <span>
              {props.quests.find((q) => q.id === selectedEdge.source)?.title ?? '前置任务'} →{' '}
              {props.quests.find((q) => q.id === selectedEdge.target)?.title ?? '后续任务'}
            </span>
            <Button
              disabled={props.disabled}
              onClick={() => {
                if (props.onDisconnect(selectedEdge.source, selectedEdge.target))
                  setSelectedEdge(null);
              }}
            >
              取消这条前置关系
            </Button>
            <Button onClick={() => setSelectedEdge(null)}>关闭</Button>
          </div>
        )}
        {context && (
          <div
            className="canvas-context-menu"
            role="dialog"
            aria-label="画布操作"
            style={{ left: context.left, top: context.top }}
          >
            <Button
              ref={contextButton}
              onClick={() => {
                props.onCreate(context.position);
                setContext(null);
              }}
            >
              在此新增任务
            </Button>
            <Button
              onClick={() => {
                props.onProperties();
                setContext(null);
              }}
            >
              章节设置
            </Button>
            <Button onClick={() => setContext(null)}>关闭菜单</Button>
          </div>
        )}
      </div>
    </div>
  );
}
