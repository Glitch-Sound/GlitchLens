import * as vscode from 'vscode';

import { createFunctionCodeLensCommands } from './codeLensCommands';
import { visualizeFunctionFlowCommandId } from './commandIds';
import { isSupportedLanguage, supportedLanguageIds } from './documentSelector';
import { getWorkspaceTrustGuard, type WorkspaceTrustGuard } from './workspaceTrust';
import type { FunctionLocatorRegistry } from '../analyzers';

export function registerGlitchLensCodeLensProvider(context: vscode.ExtensionContext, locatorRegistry?: FunctionLocatorRegistry): void {
	const selectors = supportedLanguageIds.map(language => ({ language, scheme: 'file' }));
	const provider = new GlitchLensCodeLensProvider(getWorkspaceTrustGuard, locatorRegistry);

	context.subscriptions.push(vscode.languages.registerCodeLensProvider(selectors, provider));
}

export class GlitchLensCodeLensProvider implements vscode.CodeLensProvider {
	public constructor(
		private readonly trustGuardFactory: () => Pick<WorkspaceTrustGuard, 'canProvideCodeLens'> = getWorkspaceTrustGuard,
		private readonly locatorRegistry?: FunctionLocatorRegistry,
	) {}

	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
		const trustGuard = this.trustGuardFactory();
		if (token.isCancellationRequested || !trustGuard.canProvideCodeLens || !isSupportedLanguage(document.languageId) || !isCodeLensEnabled()) {
			return [];
		}

		return createFunctionCodeLensCommands({
			uri: document.uri.toString(),
			languageId: document.languageId,
			version: document.version,
			text: document.getText(),
		}, trustGuard, this.locatorRegistry).map(candidate => {
			const range = new vscode.Range(
				candidate.range.startLine,
				candidate.range.startCharacter,
				candidate.range.endLine,
				candidate.range.endCharacter,
			);

			return new vscode.CodeLens(range, {
				title: candidate.title,
				command: visualizeFunctionFlowCommandId,
				arguments: [candidate.argument],
			});
		});
	}
}

function isCodeLensEnabled(): boolean {
	return vscode.workspace.getConfiguration('glitchlens').get('codeLens.enabled', true);
}
