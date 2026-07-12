import type { SourceLocation } from './sourceLocation';

export type FlowNodeId = string;

export const flowNodeKinds = [
	'call',
	'branch',
	'loop',
	'await',
	'return',
	'throw',
	'break',
	'continue',
	'expression',
	'try-catch',
] as const;

export type FlowNodeKind = typeof flowNodeKinds[number];

export const callResolutions = ['resolved', 'unknown', 'unresolved'] as const;

export type CallResolution = typeof callResolutions[number];

export interface BaseFlowNode {
	readonly id: FlowNodeId;
	readonly kind: FlowNodeKind;
	readonly order: number;
	readonly sourceLocation: SourceLocation;
	readonly label?: string;
}

export interface FlowCallNode extends BaseFlowNode {
	readonly kind: 'call';
	readonly calleeName: string;
	readonly resolution: CallResolution;
	readonly targetFunctionIdentifier?: string;
}

export interface FlowBranchNode extends BaseFlowNode {
	readonly kind: 'branch';
	readonly condition?: string;
}

export interface FlowLoopNode extends BaseFlowNode {
	readonly kind: 'loop';
	readonly condition?: string;
}

export interface FlowAwaitNode extends BaseFlowNode {
	readonly kind: 'await';
	readonly expression?: string;
}

export interface FlowReturnNode extends BaseFlowNode {
	readonly kind: 'return';
	readonly expression?: string;
}

export interface FlowThrowNode extends BaseFlowNode {
	readonly kind: 'throw';
	readonly expression?: string;
}

export interface FlowBreakNode extends BaseFlowNode {
	readonly kind: 'break';
	readonly label?: string;
}

export interface FlowContinueNode extends BaseFlowNode {
	readonly kind: 'continue';
	readonly label?: string;
}

export interface FlowExpressionNode extends BaseFlowNode {
	readonly kind: 'expression';
	readonly expression: string;
}

export interface FlowTryCatchNode extends BaseFlowNode {
	readonly kind: 'try-catch';
	readonly catchBinding?: string;
	readonly hasFinally?: boolean;
}

export type FlowNode =
	| FlowCallNode
	| FlowBranchNode
	| FlowLoopNode
	| FlowAwaitNode
	| FlowReturnNode
	| FlowThrowNode
	| FlowBreakNode
	| FlowContinueNode
	| FlowExpressionNode
	| FlowTryCatchNode;

export function isFlowNodeKind(value: string): value is FlowNodeKind {
	return flowNodeKinds.includes(value as FlowNodeKind);
}
