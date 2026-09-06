import type { HarnessSummary } from '@seaveyon/harness-switch-shared';
import type { Edge, Node } from '@xyflow/react';
import { useMemo } from 'react';
import { ConfigurationFlow, type FlowNodeData, flowEdge } from '@/components/configuration-flow';
import { routeHandles } from '@/components/configuration-flow/node';
import { useTranslation } from '@/lib/i18n';

type Route = { provider: string; model: string; sourceLabel?: string };
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
  const nodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      [
        {
          id: 'current-source',
          type: 'route',
          position: { x: 24, y: 38 },
          data: {
            label: current.sourceLabel ?? t('workspace.configuration'),
            value: current.provider,
            kind: 'source',
            lane: 'current',
          },
        },
        {
          id: 'current-model',
          type: 'route',
          position: { x: 260, y: 38 },
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
          position: { x: 24, y: 154 },
          data: {
            label: candidate.sourceLabel ?? t('templates.tag'),
            value: candidate.provider,
            kind: 'source',
            lane: 'next',
          },
        },
        {
          id: 'new-model',
          type: 'route',
          position: { x: 260, y: 154 },
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
          position: { x: 606, y: 96 },
          data: {
            dual: true,
            label: t('workspace.tool'),
            value: harness.label,
            kind: 'tool',
            harnessId: harness.id,
          },
        },
      ].map((node) => ({
        ...node,
        data: node.data as FlowNodeData,
        width: 190,
        height: 66,
        handles: routeHandles(node.data.kind, node.data.kind === 'tool'),
      })),
    [
      current.provider,
      current.model,
      current.sourceLabel,
      candidate.provider,
      candidate.model,
      candidate.sourceLabel,
      harness.id,
      harness.label,
      t,
    ],
  );
  const edges: Edge[] = [
    flowEdge('current-source', 'current-model', undefined, false, 'straight'),
    flowEdge('current-model', 'tool', 'current'),
    flowEdge('new-source', 'new-model', undefined, true, 'straight'),
    flowEdge('new-model', 'tool', 'new', true),
  ];

  return (
    <ConfigurationFlow nodes={nodes} edges={edges} height={250}>
      <span className="switch-flow-label switch-flow-label-current">
        {t('workspace.currentChain')}
      </span>
      <span className="switch-flow-label switch-flow-label-new">
        {t('workspace.candidateChain')}
        <span>{t('workspace.appliesAfterConfirm')}</span>
      </span>
    </ConfigurationFlow>
  );
}
