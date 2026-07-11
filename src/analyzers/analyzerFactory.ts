import type { AnalyzerError, LanguageAnalyzer } from './languageAnalyzer';

export type AnalyzerFactoryResult =
	| {
		readonly status: 'found';
		readonly analyzer: LanguageAnalyzer;
	}
	| {
		readonly status: 'error';
		readonly error: AnalyzerError;
	};

export class AnalyzerFactory {
	private readonly analyzers: readonly LanguageAnalyzer[];

	public constructor(analyzers: readonly LanguageAnalyzer[]) {
		this.analyzers = analyzers;
	}

	public createAnalyzer(languageId: string): AnalyzerFactoryResult {
		const analyzer = this.analyzers.find(candidate => candidate.languageIds.includes(languageId));

		if (analyzer) {
			return {
				status: 'found',
				analyzer,
			};
		}

		return {
			status: 'error',
			error: {
				kind: 'unsupported-language',
				message: `No analyzer is registered for language "${languageId}".`,
				languageId,
			},
		};
	}
}
