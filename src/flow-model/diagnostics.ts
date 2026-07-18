import type { FlowEdgeId } from './flowEdge';
import type { FlowNodeId } from './flowNode';
import type { SourceLocation } from './sourceLocation';

export const flowDiagnosticSeverities = ['info', 'warning', 'error'] as const;

export type FlowDiagnosticSeverity = typeof flowDiagnosticSeverities[number];

export const flowDiagnosticKinds = [
	'unknown-call',
	'unresolved-call',
	'unsupported-syntax',
	'partial-analysis',
	'analysis-failed',
	'order-uncertain',
] as const;

export type FlowDiagnosticKind = typeof flowDiagnosticKinds[number];

export interface FlowDiagnostic {
	readonly id: string;
	readonly kind: FlowDiagnosticKind;
	readonly severity: FlowDiagnosticSeverity;
	readonly message: string;
	readonly nodeId?: FlowNodeId;
	readonly edgeId?: FlowEdgeId;
	readonly sourceLocation?: SourceLocation;
}
