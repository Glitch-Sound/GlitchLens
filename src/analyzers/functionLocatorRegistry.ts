import type { AnalyzerError } from './languageAnalyzer';
import type { FunctionLocator, FunctionLocatorSelection } from './functionLocator';

export class FunctionLocatorRegistry {
	public constructor(private readonly locators: readonly FunctionLocator[]) {}

	public resolve(languageId: string): FunctionLocatorSelection {
		const locator = this.locators.find(candidate => candidate.languageIds.includes(languageId));
		if (locator) {
			return { status: 'found', locator };
		}
		const error: AnalyzerError = {
			kind: 'unsupported-language',
			message: `No function locator is registered for language "${languageId}".`,
			languageId,
		};
		return { status: 'error', error };
	}
}
