import type { FlowNodeId } from './flowNode';
import type { SourceLocation } from './sourceLocation';

export type FlowEdgeId = string;

export const flowEdgeKinds = [
	'next',
	'true',
	'false',
	'loop-body',
	'loop-exit',
	'break-exit',
	'continue-loop',
	'try',
	'catch',
	'finally',
	'return',
	'throw',
	'uncertain',
] as const;

export type FlowEdgeKind = typeof flowEdgeKinds[number];

export interface FlowEdge {
	readonly id: FlowEdgeId;
	readonly sourceNodeId: FlowNodeId;
	readonly targetNodeId: FlowNodeId;
	readonly kind: FlowEdgeKind;
	readonly executionOrder: number;
	readonly label?: string;
	readonly condition?: string;
	readonly sourceLocation?: SourceLocation;
}

export function isFlowEdgeKind(value: string): value is FlowEdgeKind {
	return flowEdgeKinds.includes(value as FlowEdgeKind);
}
