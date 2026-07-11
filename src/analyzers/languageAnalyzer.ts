import type { FlowDiagnostic, FlowModel, AnalysisCompleteness } from '../flow-model';

export interface SourceFileInput {
	readonly uri: string;
	readonly languageId: string;
	readonly version: number;
	readonly text: string;
}

export interface AnalyzerConfiguration {
	readonly configurationDigest: string;
	readonly maxDepth?: number;
}

export interface AnalyzerCancellationSignal {
	readonly isCancellationRequested: boolean;
}

export interface AnalyzerInput {
	readonly source: SourceFileInput;
	readonly cursorOffset: number;
	readonly configuration: AnalyzerConfiguration;
	readonly cancellation: AnalyzerCancellationSignal;
}

export interface AnalyzerSuccessResult {
	readonly status: 'success' | 'partial';
	readonly model: FlowModel;
	readonly diagnostics: readonly FlowDiagnostic[];
	readonly completeness: Exclude<AnalysisCompleteness, 'failed'>;
}

export interface AnalyzerFailureResult {
	readonly status: 'failed';
	readonly error: AnalyzerError;
	readonly diagnostics: readonly FlowDiagnostic[];
	readonly completeness: 'failed';
}

export type AnalyzerResult = AnalyzerSuccessResult | AnalyzerFailureResult;

export const analyzerErrorKinds = [
	'unsupported-language',
	'analysis-not-implemented',
	'analysis-cancelled',
	'invalid-input',
] as const;

export type AnalyzerErrorKind = typeof analyzerErrorKinds[number];

export interface AnalyzerError {
	readonly kind: AnalyzerErrorKind;
	readonly message: string;
	readonly analyzerId?: string;
	readonly languageId?: string;
	readonly cause?: unknown;
}

export interface LanguageAnalyzer {
	readonly id: string;
	readonly version: string;
	readonly languageIds: readonly string[];
	analyze(input: AnalyzerInput): Promise<AnalyzerResult>;
}
