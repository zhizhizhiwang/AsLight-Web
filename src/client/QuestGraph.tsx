import { Background, Controls, MarkerType, Position, ReactFlow } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import type { Quest } from '../shared/quests.ts';
import '@xyflow/react/dist/style.css';

interface Props {
  quests: Quest[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function QuestGraph({ quests, selectedId, onSelect }: Props) {
  const nodes: Node[] = quests.map((quest) => ({
    id: quest.id,
    position: quest.position,
    data: {
      label: (
        <button
          className="quest-node-button"
          onClick={() => onSelect(quest.id)}
          aria-pressed={quest.id === selectedId}
        >
          <span className="node-kind">{quest.kind === 'main' ? '主线' : '支线'}</span>
          <strong>{quest.title}</strong>
        </button>
      ),
    },
    className: `quest-node ${quest.kind}${quest.id === selectedId ? ' is-selected' : ''}`,
    ariaLabel: `${quest.kind === 'main' ? '主线' : '支线'}：${quest.title}`,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));
  const edges: Edge[] = quests.flatMap((quest) =>
    quest.prerequisites.map((source) => ({
      id: `${source}:${quest.id}`,
      source,
      target: quest.id,
      type: 'smoothstep',
      style: { stroke: quest.kind === 'side' ? '#bb9152' : '#557c69', strokeWidth: 2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: quest.kind === 'side' ? '#bb9152' : '#557c69',
      },
    })),
  );

  return (
    <div className="quest-graph" aria-label="任务路线图">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.3}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesFocusable={false}
        nodesConnectable={false}
        onNodeClick={(_event, node) => onSelect(node.id)}
      >
        <Background color="#d5d9cd" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
