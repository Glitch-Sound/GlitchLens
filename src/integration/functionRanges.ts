import { FunctionLocatorRegistry, TypeScriptFunctionLocator } from '../analyzers';
import type { FunctionLocator } from '../analyzers';

export interface TextRange {
	readonly startLine: number;
	readonly startCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
}

export interface FunctionCandidate {
	readonly name: string;
	readonly range: TextRange;
}

export interface FunctionCandidateInput {
	readonly uri: string;
	readonly languageId: string;
	readonly version: number;
	readonly text: string;
}

const defaultFunctionLocatorRegistry = new FunctionLocatorRegistry([new TypeScriptFunctionLocator()]);

export function findFunctionCandidates(input: FunctionCandidateInput, registry = defaultFunctionLocatorRegistry): FunctionCandidate[] {
	const selected = registry.resolve(input.languageId);
	if (selected.status !== 'found') {
		return [];
	}
	return selected.locator.findFunctionCandidates(input).map(candidate => ({
		name: candidate.name,
		range: {
			startLine: candidate.range.start.line,
			startCharacter: candidate.range.start.character,
			endLine: candidate.range.end.line,
			endCharacter: candidate.range.end.character,
		},
	}));
}
