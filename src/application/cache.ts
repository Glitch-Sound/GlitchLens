import type { SourceRange } from '../flow-model';
import type { RenderResult } from '../renderer';
import type { VisualizationSuccessResult } from './visualizeFunctionFlow';

export interface CacheKey {
	readonly documentUri: string;
	readonly documentVersion: number;
	readonly functionRange: SourceRange;
	readonly configurationDigest: string;
	readonly analyzerId: string;
	readonly analyzerVersion: string;
}

export interface AnalysisCacheEntry {
	readonly key: CacheKey;
	readonly result: VisualizationSuccessResult;
	readonly model: VisualizationSuccessResult['model'];
	readonly renderResult: RenderResult;
	readonly createdAt: string;
}

export class AnalysisCache {
	private readonly entries = new Map<string, AnalysisCacheEntry>();

	public get(key: CacheKey): AnalysisCacheEntry | undefined {
		return this.entries.get(serializeCacheKey(key));
	}

	public set(key: CacheKey, entry: AnalysisCacheEntry): void {
		this.entries.set(serializeCacheKey(key), { ...entry, key });
	}

	public invalidate(key: CacheKey): void {
		this.entries.delete(serializeCacheKey(key));
	}

	public invalidateDocument(documentUri: string): void {
		for (const [serialized, entry] of this.entries) {
			if (entry.key.documentUri === documentUri) {
				this.entries.delete(serialized);
			}
		}
	}

	public clear(): void {
		this.entries.clear();
	}
}

export function serializeCacheKey(key: CacheKey): string {
	return JSON.stringify({
		documentUri: key.documentUri,
		documentVersion: key.documentVersion,
		functionRange: key.functionRange,
		configurationDigest: key.configurationDigest,
		analyzerId: key.analyzerId,
		analyzerVersion: key.analyzerVersion,
	});
}
