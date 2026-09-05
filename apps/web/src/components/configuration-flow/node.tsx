import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { type Edge, Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { Box, Network } from 'lucide-react';
import { HarnessIcon } from '@/components/harness-icon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
export type FlowNodeData = {
  dual?: boolean;
  action?: () => void;
  actionLabel?: string;
  disabled?: boolean;
  selected?: boolean;
  label: string;
  value: string;
  kind: 'source' | 'model' | 'tool';
  lane?: 'current' | 'next';
  harnessId?: HarnessId;
};

export function routeHandles(kind: string, dual = false): NonNullable<Node['handles']> {
  if (kind === 'tool') {
    if (!dual) {
      return [{ type: 'target', position: Position.Left, x: -4, y: 29, width: 8, height: 8 }];
    }
    return [
      {
        id: 'current',
        type: 'target',
        position: Position.Left,
        x: -4,
        y: 66 * 0.32 - 4,
        width: 8,
        height: 8,
      },
      {
        id: 'new',
        type: 'target',
        position: Position.Left,
        x: -4,
        y: 66 * 0.68 - 4,
        width: 8,
        height: 8,
      },
    ];
  }
  const source = {
    type: 'source' as const,
    position: Position.Right,
    x: 186,
    y: 29,
    width: 8,
    height: 8,
  };
  return kind === 'model'
    ? [source, { type: 'target', position: Position.Left, x: -4, y: 29, width: 8, height: 8 }]
    : [source];
}

export function flowEdge(
  source: string,
  target: string,
  targetHandle?: string,
  highlighted = false,
  type: Edge['type'] = 'default',
): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    targetHandle,
    type,
    animated: true,
    style: {
      stroke: highlighted
        ? 'var(--primary)'
        : 'color-mix(in srgb, var(--primary) 58%, var(--border))',
      strokeWidth: 2,
    },
  };
}

export function RouteNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const model = data.kind === 'model';
  return (
    <div
      className={
        data.lane === 'next' || data.selected
          ? 'switch-flow-node switch-flow-node-next'
          : 'switch-flow-node'
      }
    >
      {data.kind === 'model' ? (
        <Handle type="target" position={Position.Left} className="switch-flow-handle" />
      ) : null}
      {data.kind === 'tool' && data.dual ? (
        <Handle
          type="target"
          id="current"
          position={Position.Left}
          className="switch-flow-handle"
          style={{ top: '32%' }}
        />
      ) : null}
      {data.kind === 'tool' && data.dual ? (
        <Handle
          type="target"
          id="new"
          position={Position.Left}
          className="switch-flow-handle"
          style={{ top: '68%' }}
        />
      ) : null}
      {data.kind === 'tool' && !data.dual ? (
        <Handle type="target" position={Position.Left} className="switch-flow-handle" />
      ) : null}
      {data.action ? (
        <Button
          variant="ghost"
          className="pointer-events-auto absolute inset-0 z-10 h-full w-full rounded-[14px]"
          aria-label={data.actionLabel ?? data.value}
          disabled={data.disabled}
          onClick={(event) => {
            event.stopPropagation();
            data.action?.();
          }}
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
