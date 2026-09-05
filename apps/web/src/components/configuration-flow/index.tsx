import { type Edge, type Node, ReactFlow } from '@xyflow/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type FlowNodeData, RouteNode, routeHandles } from './node';

export type { FlowNodeData } from './node';
export { flowEdge } from './node';

const nodeTypes = { route: RouteNode };
export function flowNode(id: string, x: number, y: number, data: FlowNodeData): Node<FlowNodeData> {
  return {
    id,
    type: 'route',
    position: { x, y },
    data,
    style: { pointerEvents: data.action ? 'all' : undefined },
    width: 190,
    height: 66,
    handles: routeHandles(data.kind, data.dual),
  };
}
export function ConfigurationFlow({
  nodes,
  edges,
  height = 160,
  children,
}: {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  height?: number;
  children?: ReactNode;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(820);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame);
      const nextWidth = Math.floor(entry.contentRect.width);
      frame = requestAnimationFrame(() => {
        if (nextWidth > 0) {
          setWidth((previous) => (previous === nextWidth ? previous : nextWidth));
        }
      });
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  const zoom = Math.min(1, width / 820);

  return (
    <TooltipProvider delayDuration={250}>
      <div ref={canvasRef} className="switch-flow-canvas" style={{ height: height * zoom }}>
        {children ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transformOrigin: 'top left',
              transform: `scale(${zoom})`,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            {children}
          </div>
        ) : null}
        <ReactFlow
          width={width}
          height={height * zoom}
          viewport={{ x: 0, y: 0, zoom }}
          minZoom={0.1}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => {
            if (!node.data.disabled) {
              node.data.action?.();
            }
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
        />
      </div>
    </TooltipProvider>
  );
}
