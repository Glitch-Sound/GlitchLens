import type { AnalyzerError, SourceFileInput } from './languageAnalyzer';
import type { FunctionCandidate, FunctionLocatorResult, FunctionRange } from './typescript/functionLocator';
import { findFunctionCandidates, findFunctionContainingOffset, findFunctionByRange } from './typescript/functionLocator';

export type { FunctionCandidate, FunctionLocatorResult, FunctionRange } from './typescript/functionLocator';

export interface FunctionLocator {
	readonly id: string;
	readonly version: string;
	readonly languageIds: readonly string[];
	findFunctionCandidates(source: SourceFileInput): readonly FunctionCandidate[];
	findFunctionContainingOffset(source: SourceFileInput, offset: number): FunctionLocatorResult;
	findFunctionByRange(source: SourceFileInput, range: FunctionRange): FunctionLocatorResult;
}

export type FunctionLocatorSelection =
	| { readonly status: 'found'; readonly locator: FunctionLocator }
	| { readonly status: 'error'; readonly error: AnalyzerError };

export class TypeScriptFunctionLocator implements FunctionLocator {
	public readonly id = 'typescript';
	public readonly version = '0.4.0';
	public readonly languageIds = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'] as const;

	public findFunctionCandidates(source: SourceFileInput): readonly FunctionCandidate[] {
		return findFunctionCandidates(source);
	}

	public findFunctionContainingOffset(source: SourceFileInput, offset: number): FunctionLocatorResult {
		return findFunctionContainingOffset(source, offset);
	}

	public findFunctionByRange(source: SourceFileInput, range: FunctionRange): FunctionLocatorResult {
		return findFunctionByRange(source, range);
	}
}
