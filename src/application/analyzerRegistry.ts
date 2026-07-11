import { AnalyzerFactory, type AnalyzerFactoryResult } from '../analyzers';
import type { LanguageAnalyzer } from '../analyzers';

export class AnalyzerRegistry {
	private readonly factory: AnalyzerFactory;

	public constructor(analyzers: readonly LanguageAnalyzer[]) {
		this.factory = new AnalyzerFactory(analyzers);
	}

	public resolve(languageId: string): AnalyzerFactoryResult {
		return this.factory.createAnalyzer(languageId);
	}
}
