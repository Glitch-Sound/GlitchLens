import type {
	AnalyzerConfiguration,
	AnalyzerError,
	AnalyzerInput,
	AnalyzerResult,
	SourceFileInput,
} from '../analyzers';
import type { FlowDiagnostic, FlowModel, SourceLocation } from '../flow-model';
import type { RenderResult, RendererWarning } from '../renderer';
import type { AnalyzerRegistry } from './analyzerRegistry';
import type { AnalysisCache, CacheKey } from './cache';

export interface VisualizationRequest {
	readonly source: SourceFileInput;
	readonly cursorOffset: number;
	readonly functionRange: SourceLocation['range'];
	readonly configuration: AnalyzerConfiguration;
	readonly cancellation: {
		readonly isCancellationRequested: boolean;
	};
}

export const visualizationStatuses = [
	'success',
	'partial',
	'unsupported-language',
	'target-not-found',
	'cancelled',
	'failed',
	'render-failed',
] as const;

export type VisualizationStatus = typeof visualizationStatuses[number];

export const visualizationNoticeKinds = [
	'unknown-call',
	'unresolved-call',
	'unsupported-syntax',
	'partial-analysis',
	'order-uncertain',
	'renderer-warning',
	'unsupported-language',
	'target-not-found',
	'cancelled',
	'analysis-failed',
	'render-failed',
] as const;

export type VisualizationNoticeKind = typeof visualizationNoticeKinds[number];

export type VisualizationNoticeSeverity = 'info' | 'warning' | 'error';

export interface VisualizationNotice {
	readonly id: string;
	readonly kind: VisualizationNoticeKind;
	readonly severity: VisualizationNoticeSeverity;
	readonly message: string;
	readonly sourceLocation?: SourceLocation;
	readonly nodeId?: string;
	readonly edgeId?: string;
}

export type VisualizationResult =
	| VisualizationSuccessResult
	| VisualizationFailureResult;

export interface VisualizationSuccessResult {
	readonly status: 'success' | 'partial';
	readonly mermaidText: string;
	readonly canCopyMermaid: true;
	readonly sourceMap: RenderResult['sourceMap'];
	readonly processNoteDecorations: RenderResult['processNoteDecorations'];
	readonly notices: readonly VisualizationNotice[];
	readonly completeness: 'complete' | 'partial';
	readonly model: FlowModel;
}

export interface VisualizationFailureResult {
	readonly status: Exclude<VisualizationStatus, 'success' | 'partial'>;
	readonly canCopyMermaid: false;
	readonly notices: readonly VisualizationNotice[];
	readonly error: VisualizationError;
}

export interface VisualizationError {
	readonly kind: VisualizationFailureResult['status'];
	readonly message: string;
	readonly languageId?: string;
	readonly analyzerId?: string;
}

export interface FlowRenderer {
	render(model: FlowModel): RenderResult;
}

interface RenderedVisualization {
	readonly result: VisualizationResult;
	readonly renderResult?: RenderResult;
}

export class VisualizeFunctionFlowUseCase {
	public constructor(
		private readonly analyzerRegistry: AnalyzerRegistry,
		private readonly renderer: FlowRenderer,
		private readonly cache?: AnalysisCache,
	) {}

	public async execute(request: VisualizationRequest): Promise<VisualizationResult> {
		const analyzerSelection = this.analyzerRegistry.resolve(request.source.languageId);
		if (analyzerSelection.status === 'error') {
			return failureFromAnalyzerError(analyzerSelection.error);
		}

		const cacheKey = createCacheKey(request, analyzerSelection.analyzer.id, analyzerSelection.analyzer.version);
		const cached = this.cache?.get(cacheKey);
		if (cached) {
			return cached.result;
		}

		const analyzerInput: AnalyzerInput = {
			source: request.source,
			cursorOffset: request.cursorOffset,
			configuration: request.configuration,
			cancellation: request.cancellation,
		};
		const analysis = await analyzerSelection.analyzer.analyze(analyzerInput);

		if (analysis.status === 'failed') {
			return failureFromAnalyzerError(analysis.error, analysis.diagnostics);
		}

		const rendered = this.renderAnalysis(analysis);
		const result = rendered.result;
		if (result.status === 'success' || result.status === 'partial') {
			this.cache?.set(cacheKey, {
				key: cacheKey,
				result,
				model: result.model,
				renderResult: rendered.renderResult ?? {
					mermaidText: result.mermaidText,
					warnings: [],
					sourceMap: result.sourceMap,
					processNoteDecorations: result.processNoteDecorations,
				},
				createdAt: new Date().toISOString(),
			});
		}
		return result;
	}

	private renderAnalysis(analysis: Extract<AnalyzerResult, { status: 'success' | 'partial' }>): RenderedVisualization {
		let rendered: RenderResult;
		try {
			rendered = this.renderer.render(analysis.model);
		} catch (error) {
			return {
				result: {
					status: 'render-failed',
					canCopyMermaid: false,
					error: {
						kind: 'render-failed',
						message: error instanceof Error ? error.message : 'Mermaid rendering failed.',
					},
					notices: uniqueNotices([
						{
							id: 'notice:render-failed',
							kind: 'render-failed',
							severity: 'error',
							message: error instanceof Error ? error.message : 'Mermaid rendering failed.',
						},
						...analysis.diagnostics.map(diagnosticToNotice),
					]),
				},
			};
		}

		const notices = uniqueNotices([
			...analysis.diagnostics.map(diagnosticToNotice),
			...rendered.warnings.map(rendererWarningToNotice),
		]);
		const status = analysis.status === 'partial' || analysis.completeness === 'partial' ? 'partial' : 'success';

		return {
			result: {
				status,
				mermaidText: rendered.mermaidText,
				canCopyMermaid: true,
				sourceMap: rendered.sourceMap,
				processNoteDecorations: rendered.processNoteDecorations,
				notices,
				completeness: analysis.completeness,
				model: analysis.model,
			},
			renderResult: rendered,
		};
	}
}

export function createCacheKey(request: VisualizationRequest, analyzerId: string, analyzerVersion: string): CacheKey {
	return {
		documentUri: request.source.uri,
		documentVersion: request.source.version,
		functionRange: request.functionRange,
		configurationDigest: request.configuration.configurationDigest,
		analyzerId,
		analyzerVersion,
	};
}

function failureFromAnalyzerError(error: AnalyzerError, diagnostics: readonly FlowDiagnostic[] = []): VisualizationFailureResult {
	const status = mapAnalyzerErrorStatus(error.kind);
	const notice = analyzerErrorToNotice(error, status);
	return {
		status,
		canCopyMermaid: false,
		error: {
			kind: status,
			message: error.message,
			languageId: error.languageId,
			analyzerId: error.analyzerId,
		},
		notices: uniqueNotices([
			notice,
			...diagnostics.map(diagnosticToNotice),
		]),
	};
}

function mapAnalyzerErrorStatus(kind: AnalyzerError['kind']): VisualizationFailureResult['status'] {
	if (kind === 'unsupported-language') {
		return 'unsupported-language';
	}
	if (kind === 'invalid-input') {
		return 'target-not-found';
	}
	if (kind === 'analysis-cancelled') {
		return 'cancelled';
	}
	return 'failed';
}

function analyzerErrorToNotice(error: AnalyzerError, status: VisualizationFailureResult['status']): VisualizationNotice {
	return {
		id: `notice:${status}`,
		kind: status === 'failed' ? 'analysis-failed' : status,
		severity: status === 'cancelled' ? 'info' : 'error',
		message: error.message,
	};
}

function diagnosticToNotice(diagnostic: FlowDiagnostic): VisualizationNotice {
	return {
		id: `notice:${diagnostic.id}`,
		kind: diagnostic.kind,
		severity: diagnostic.severity,
		message: diagnostic.message,
		sourceLocation: diagnostic.sourceLocation,
		nodeId: diagnostic.nodeId,
		edgeId: diagnostic.edgeId,
	};
}

function rendererWarningToNotice(warning: RendererWarning): VisualizationNotice {
	return {
		id: `notice:${warning.id}`,
		kind: 'renderer-warning',
		severity: 'warning',
		message: warning.message,
		sourceLocation: warning.sourceLocation,
		nodeId: warning.nodeId,
		edgeId: warning.edgeId,
	};
}

function uniqueNotices(notices: readonly VisualizationNotice[]): readonly VisualizationNotice[] {
	const seen = new Set<string>();
	const unique: VisualizationNotice[] = [];
	for (const notice of notices) {
		const key = [
			notice.kind,
			notice.severity,
			notice.message,
			notice.nodeId ?? '',
			notice.edgeId ?? '',
			notice.sourceLocation ? JSON.stringify(notice.sourceLocation.range) : '',
		].join('\u0000');
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(notice);
	}
	return unique;
}
