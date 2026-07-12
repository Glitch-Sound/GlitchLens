import { findFunctionCandidates as findTypeScriptFunctionCandidates } from '../analyzers/typescript/functionLocator';

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

export function findFunctionCandidates(input: FunctionCandidateInput): FunctionCandidate[] {
	return findTypeScriptFunctionCandidates(input).map(candidate => ({
		name: candidate.name,
		range: {
			startLine: candidate.range.start.line,
			startCharacter: candidate.range.start.character,
			endLine: candidate.range.end.line,
			endCharacter: candidate.range.end.character,
		},
	}));
}
