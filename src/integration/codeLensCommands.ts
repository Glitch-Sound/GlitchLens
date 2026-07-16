import { visualizeFunctionFlowCommandId } from './commandIds';
import { isSupportedLanguage } from './documentSelector';
import { findFunctionCandidates, type FunctionCandidate, type TextRange } from './functionRanges';
import type { FunctionLocatorRegistry } from '../analyzers';
import type { WorkspaceTrustGuard } from './workspaceTrustPolicy';

export interface CodeLensSourceInput {
	readonly uri: string;
	readonly languageId: string;
	readonly version: number;
	readonly text: string;
}

export interface FunctionCodeLensCommand {
	readonly title: string;
	readonly command: typeof visualizeFunctionFlowCommandId;
	readonly range: TextRange;
	readonly argument: {
		readonly uri: string;
		readonly languageId: string;
		readonly version: number;
		readonly functionName: string;
		readonly functionRange: TextRange;
	};
}

export function createFunctionCodeLensCommands(source: CodeLensSourceInput, trustGuard?: Pick<WorkspaceTrustGuard, 'canProvideCodeLens'>, locatorRegistry?: FunctionLocatorRegistry): FunctionCodeLensCommand[] {
	if (trustGuard?.canProvideCodeLens === false || !isSupportedLanguage(source.languageId)) {
		return [];
	}

	return findFunctionCandidates(source, locatorRegistry).map(candidate => toCommand(source, candidate));
}

function toCommand(source: CodeLensSourceInput, candidate: FunctionCandidate): FunctionCodeLensCommand {
	return {
		title: 'GlitchLens',
		command: visualizeFunctionFlowCommandId,
		range: candidate.range,
		argument: {
			uri: source.uri,
			languageId: source.languageId,
			version: source.version,
			functionName: candidate.name,
			functionRange: candidate.range,
		},
	};
}
