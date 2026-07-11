import * as vscode from 'vscode';

import { visualizeFunctionFlowCommandId } from './commands';
import { isSupportedLanguage, supportedLanguageIds } from './documentSelector';
import { findFunctionCandidates } from './functionRanges';

export function registerGlitchLensCodeLensProvider(context: vscode.ExtensionContext): void {
	const selectors = supportedLanguageIds.map(language => ({ language, scheme: 'file' }));
	const provider = new GlitchLensCodeLensProvider();

	context.subscriptions.push(vscode.languages.registerCodeLensProvider(selectors, provider));
}

class GlitchLensCodeLensProvider implements vscode.CodeLensProvider {
	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
		if (token.isCancellationRequested || !isSupportedLanguage(document.languageId) || !isCodeLensEnabled()) {
			return [];
		}

		return findFunctionCandidates(document.getText()).map(candidate => {
			const range = new vscode.Range(
				candidate.range.startLine,
				candidate.range.startCharacter,
				candidate.range.endLine,
				candidate.range.endCharacter,
			);

			return new vscode.CodeLens(range, {
				title: 'GlitchLens: Visualize Function Flow',
				command: visualizeFunctionFlowCommandId,
				arguments: [{
					uri: document.uri.toString(),
					languageId: document.languageId,
					version: document.version,
					functionName: candidate.name,
					functionRange: candidate.range,
				}],
			});
		});
	}
}

function isCodeLensEnabled(): boolean {
	return vscode.workspace.getConfiguration('glitchlens').get('codeLens.enabled', true);
}
