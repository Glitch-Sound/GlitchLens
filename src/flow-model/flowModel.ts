import type { FlowDiagnostic } from './diagnostics';
import type { FlowEdge } from './flowEdge';
import type { FlowNode } from './flowNode';
import type { AnalysisCompleteness, FlowModelMetadata } from './metadata';
import type { FlowSource, SourceLocation } from './sourceLocation';

export interface FlowFunction {
	readonly id: string;
	readonly name: string;
	readonly sourceLocation: SourceLocation;
}

export interface FlowModel {
	readonly metadata: FlowModelMetadata;
	readonly rootFunction: FlowFunction;
	readonly nodes: readonly FlowNode[];
	readonly edges: readonly FlowEdge[];
	readonly diagnostics: readonly FlowDiagnostic[];
	readonly source: FlowSource;
	readonly completeness: AnalysisCompleteness;
}
