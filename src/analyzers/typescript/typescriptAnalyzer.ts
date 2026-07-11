import type { AnalyzerInput, AnalyzerResult, LanguageAnalyzer } from '../languageAnalyzer';

export class TypeScriptAnalyzer implements LanguageAnalyzer {
	public readonly id = 'typescript';
	public readonly version = '0.1.0';
	public readonly languageIds = ['typescript', 'javascript'] as const;

	public analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
		return Promise.resolve({
			status: 'failed',
			completeness: 'failed',
			diagnostics: [],
			error: {
				kind: 'analysis-not-implemented',
				message: 'TypeScriptAnalyzer skeleton does not perform AST analysis yet.',
				analyzerId: this.id,
				languageId: input.source.languageId,
			},
		});
	}
}
