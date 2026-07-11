import type { SupportedLanguageId } from './sourceLocation';

export const analysisCompletenessValues = ['complete', 'partial', 'failed'] as const;

export type AnalysisCompleteness = typeof analysisCompletenessValues[number];

export interface FlowModelMetadata {
	readonly schemaVersion: string;
	readonly analyzerId: string;
	readonly analyzerVersion: string;
	readonly languageId: SupportedLanguageId;
	readonly generatedAt: string;
	readonly sourceDocumentVersion: number;
	readonly completeness: AnalysisCompleteness;
	readonly configurationDigest: string;
	readonly rootFunctionIdentifier?: string;
}
