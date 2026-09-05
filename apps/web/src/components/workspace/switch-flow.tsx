import type { HarnessId, HarnessSummary } from '@seaveyon/harness-switch-shared';
import { type Edge, Handle, type Node, type NodeProps, Position, ReactFlow } from '@xyflow/react';
import { Box, Network } from 'lucide-react';
import { HarnessIcon } from '@/components/harness-icon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';

type Route = { provider: string; model: string };
type FlowNodeData = {
  label: string;
  value: string;
  kind: 'source' | 'model' | 'tool';
  lane?: 'current' | 'next';
  harnessId?: HarnessId;
};

const nodeTypes = { route: RouteNode };

export function SwitchFlow({
  current,
  candidate,
  harness,
}: {
  current: Route;
  candidate: Route;
  harness: HarnessSummary;
}) {
  const { t } = useTranslation();
  const nodes: Node<FlowNodeData>[] = [
    {
      id: 'current-source',
      type: 'route',
      position: { x: 108, y: 38 },
      data: {
        label: t('workspace.configuration'),
        value: current.provider,
        kind: 'source',
        lane: 'current',
      },
    },
    {
      id: 'current-model',
      type: 'route',
      position: { x: 344, y: 38 },
      data: {
        label: t('favorites.modelPicker'),
        value: current.model,
        kind: 'model',
        lane: 'current',
      },
    },
    {
      id: 'new-source',
      type: 'route',
      position: { x: 108, y: 184 },
      data: {
        label: t('workspace.provider'),
        value: candidate.provider,
        kind: 'source',
        lane: 'next',
      },
    },
    {
      id: 'new-model',
      type: 'route',
      position: { x: 344, y: 184 },
      data: {
        label: t('favorites.modelPicker'),
        value: candidate.model,
        kind: 'model',
        lane: 'next',
      },
    },
    {
      id: 'tool',
      type: 'route',
      position: { x: 536, y: 111 },
      data: {
        label: t('workspace.tool'),
        value: harness.label,
        kind: 'tool',
        harnessId: harness.id,
      },
    },
  ];
  const edges: Edge[] = [
    edge('current-source', 'current-model', undefined, false, 'straight'),
    edge('current-model', 'tool', 'current'),
    edge('new-source', 'new-model', undefined, true, 'straight'),
    edge('new-model', 'tool', 'new', true),
  ];
  return (
    <TooltipProvider delayDuration={250}>
      <div className="switch-flow-canvas">
        <span className="switch-flow-label switch-flow-label-current">
          {t('workspace.currentChain')}
        </span>
        <span className="switch-flow-label switch-flow-label-new">
          {t('workspace.candidateChain')}
          <span>{t('workspace.appliesAfterConfirm')}</span>
        </span>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </TooltipProvider>
  );
}

function edge(
  source: string,
  target: string,
  targetHandle?: string,
  animated = false,
  type: Edge['type'] = 'default',
): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    targetHandle,
    type,
    animated,
    style: {
      stroke: animated ? 'var(--primary)' : 'color-mix(in srgb, var(--primary) 58%, var(--border))',
      strokeWidth: 2,
    },
  };
}

function RouteNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const model = data.kind === 'model';
  return (
    <div
      className={
        data.lane === 'next' ? 'switch-flow-node switch-flow-node-next' : 'switch-flow-node'
      }
    >
      {data.kind === 'model' ? (
        <Handle type="target" position={Position.Left} className="switch-flow-handle" />
      ) : null}
      {data.kind === 'tool' ? (
        <Handle
          type="target"
          id="current"
          position={Position.Left}
          className="switch-flow-handle"
          style={{ top: '32%' }}
        />
      ) : null}
      {data.kind === 'tool' ? (
        <Handle
          type="target"
          id="new"
          position={Position.Left}
          className="switch-flow-handle"
          style={{ top: '68%' }}
        />
      ) : null}
      {data.kind === 'source' || data.kind === 'model' ? (
        <Handle type="source" position={Position.Right} className="switch-flow-handle" />
      ) : null}
      {data.kind === 'tool' && data.harnessId ? (
        <HarnessIcon id={data.harnessId} />
      ) : model ? (
        <Box className="text-primary" />
      ) : (
        <Network className="text-primary" />
      )}
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{data.label}</span>
        {model ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <strong className="block truncate font-mono text-xs">{data.value}</strong>
            </TooltipTrigger>
            <TooltipContent className="font-mono">{data.value}</TooltipContent>
          </Tooltip>
        ) : (
          <strong className="block truncate text-sm">{data.value}</strong>
        )}
      </span>
    </div>
  );
}
