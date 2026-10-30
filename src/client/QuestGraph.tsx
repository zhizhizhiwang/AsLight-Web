import {
  Background,
  Handle,
  Position,
  ReactFlow,
  Panel as FlowPanel,
  ViewportPortal,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import { useSyncExternalStore } from 'react';
import type { Edge, Node, NodeProps } from '@xyflow/react';
import type { Quest } from '../shared/quests.ts';
import type { ChapterPresentation } from '../shared/content.ts';
import { CourseImage, QuestArtwork } from './CourseContent.tsx';
import { Button } from './ui.tsx';
import { Icon } from './Icon.tsx';
import type { QuestProgress } from '../shared/progress.ts';
import { progressLabel, rewardLabel } from './progress.ts';
import type { QuestFilter } from './App.tsx';
import '@xyflow/react/dist/style.css';

export type QuestNode = Node<
  {
    quest: Quest;
    progress: QuestProgress | undefined;
    context: boolean;
    onSelect: (id: string) => void;
    selected: boolean;
    crossChapter: boolean;
    preview: boolean;
    editing?: boolean;
    onNudge?: (id: string, x: number, y: number) => void;
  },
  'quest'
>;

export function QuestMapNode({ data }: NodeProps<QuestNode>) {
  const { quest, context, onSelect, selected } = data;
  return (
    <div
      className={`quest-node-content ${quest.kind}${context ? ' context-node' : ''}${selected ? ' is-selected' : ''}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={Boolean(data.editing)} />
      <button
        id={`quest-trigger-${quest.id}`}
        type="button"
        className={`quest-node-button${data.editing ? '' : ' nodrag'}`}
        onClick={() => onSelect(quest.id)}
        aria-label={`${data.editing ? '编辑' : '查看'}${quest.title}${context ? '，前置任务' : ''}`}
        aria-pressed={selected}
        onKeyDown={(event) => {
          if (!data.editing || !data.onNudge) return;
          const step = event.shiftKey ? 1 : 10;
          const delta =
            event.key === 'ArrowLeft'
              ? [-step, 0]
              : event.key === 'ArrowRight'
                ? [step, 0]
                : event.key === 'ArrowUp'
                  ? [0, -step]
                  : event.key === 'ArrowDown'
                    ? [0, step]
                    : null;
          if (delta) {
            event.preventDefault();
            event.stopPropagation();
            data.onNudge(quest.id, delta[0] ?? 0, delta[1] ?? 0);
          }
        }}
      >
        <span className="quest-node-frame">
          <span className="quest-node-symbol" aria-hidden="true">
            <QuestArtwork quest={quest} />
          </span>
        </span>
        <strong>{quest.title}</strong>
        <small>
          {data.editing ? '拖动编排' : data.preview ? '预览' : progressLabel(data.progress)}
        </small>
        {rewardLabel(data.progress) && (
          <small className={`reward-badge ${data.progress?.rewardStatus}`}>
            {rewardLabel(data.progress)}
          </small>
        )}
        {context && <small>前置任务</small>}
        {data.crossChapter && <small>含跨章前置</small>}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={Boolean(data.editing)} />
    </div>
  );
}

const nodeTypes = { quest: QuestMapNode };

export function GraphControls({ taskIds, compact }: { taskIds: string[]; compact: boolean }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <FlowPanel
      position="bottom-left"
      className="graph-controls"
      aria-label="流程图缩放"
      role="group"
    >
      <Button
        variant="icon"
        aria-label="放大流程图"
        title="放大"
        disabled={zoom >= 1.99}
        onClick={() => void zoomIn()}
      >
        <Icon name="plus" />
      </Button>
      <Button
        variant="icon"
        aria-label="缩小流程图"
        title="缩小"
        disabled={zoom <= 0.351}
        onClick={() => void zoomOut()}
      >
        <Icon name="minus" />
      </Button>
      <Button
        variant="icon"
        aria-label="回到合适视野"
        title="回到合适视野"
        disabled={!taskIds.length}
        onClick={() =>
          void fitView({
            padding: 0.3,
            maxZoom: 1.2,
            nodes: (compact ? taskIds.slice(0, 1) : taskIds).map((id) => ({ id })),
          })
        }
      >
        <Icon name="fit" />
      </Button>
    </FlowPanel>
  );
}

function subscribeToCompactLayout(listener: () => void) {
  const query = window.matchMedia('(max-width: 600px)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function isCompactLayout() {
  return window.matchMedia('(max-width: 600px)').matches;
}

interface Props {
  quests: Quest[];
  filter: QuestFilter;
  progress: QuestProgress[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  presentation: ChapterPresentation | undefined;
  preview?: boolean;
  compactPreview?: boolean;
}

export default function QuestGraph({
  quests,
  progress,
  filter,
  selectedId,
  onSelect,
  presentation,
  preview = false,
  compactPreview,
}: Props) {
  const detectedCompact = useSyncExternalStore(subscribeToCompactLayout, isCompactLayout);
  const compact = compactPreview ?? detectedCompact;
  const matches = (quest: Quest) => filter === 'all' || quest.kind === filter;
  const visibleIds = new Set(quests.filter(matches).map((quest) => quest.id));
  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  // Retain prerequisites as muted context when a side-task filter would hide them.
  function includePrerequisites(id: string) {
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) {
      if (byId.has(prerequisite) && !visibleIds.has(prerequisite)) {
        visibleIds.add(prerequisite);
        includePrerequisites(prerequisite);
      }
    }
  }
  for (const id of [...visibleIds]) includePrerequisites(id);
  const visibleQuests = quests.filter((quest) => visibleIds.has(quest.id));
  const firstTask = visibleQuests.find(matches);
  const nodes: QuestNode[] = visibleQuests.map((quest) => ({
    id: quest.id,
    type: 'quest',
    position: quest.position,
    data: {
      quest,
      progress: progress?.find((item) => item.questId === quest.id),
      context: !matches(quest),
      selected: quest.id === selectedId,
      crossChapter: quest.prerequisites.some((id) => !byId.has(id)),
      preview,
      onSelect,
    },
    ariaLabel: quest.title,
  }));
  const edges: Edge[] = visibleQuests.flatMap((quest) =>
    quest.prerequisites
      .filter((source) => visibleIds.has(source))
      .map((source) => ({
        id: `${source}:${quest.id}`,
        source,
        target: quest.id,
        type: 'smoothstep',
        style: { stroke: quest.kind === 'side' ? '#b29360' : '#829181', strokeWidth: 1.8 },
      })),
  );

  return (
    <div className="quest-graph" aria-label="任务流程图">
      {presentation?.backgroundAssetId && (
        <div className="chapter-background" aria-hidden="true">
          <CourseImage assetId={presentation.backgroundAssetId} decorative />
        </div>
      )}
      <ReactFlow
        key={`${filter}:${compact}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView={!presentation?.viewport || compact || filter !== 'all'}
        defaultViewport={presentation?.viewport ?? { x: 0, y: 0, zoom: 1 }}
        fitViewOptions={{
          padding: 0.3,
          maxZoom: 1.2,
          ...(compact && firstTask ? { nodes: [{ id: firstTask.id }] } : {}),
        }}
        minZoom={0.35}
        maxZoom={2}
        nodesDraggable={false}
        nodesFocusable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
      >
        <Background color="#c8cec1" gap={24} size={1} />
        <ViewportPortal>
          <div className="chapter-decorations">
            {(presentation?.decorations ?? []).map((item) => (
              <div
                key={item.id}
                className={`canvas-decoration canvas-decoration--${item.type}`}
                style={{
                  left: item.position.x,
                  top: item.position.y,
                  width: item.width,
                  height: item.height,
                  zIndex: item.layer,
                }}
              >
                {item.type === 'image' ? (
                  <CourseImage assetId={item.assetId} alt={item.alt} />
                ) : (
                  <span>{item.text}</span>
                )}
              </div>
            ))}
          </div>
        </ViewportPortal>
        <GraphControls
          taskIds={visibleQuests.filter(matches).map((quest) => quest.id)}
          compact={compact}
        />
      </ReactFlow>
      {!firstTask && (
        <p className="canvas-empty-hint" role="status">
          {quests.length ? '暂无该类型任务。' : '本章暂无任务。'}
        </p>
      )}
    </div>
  );
}
