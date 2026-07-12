import * as vscode from 'vscode';

import { registerGlitchLensCodeLensProvider } from './codeLensProvider';
import { registerGlitchLensCommands } from './commands';
import { IntegrationTestProbe, registerIntegrationTestSupport } from './testSupport';
import { createVsCodeCommandController, createVsCodeVisualizationView } from './vscodeAdapters';

export function registerGlitchLensExtension(context: vscode.ExtensionContext): void {
	const probe = context.extensionMode === vscode.ExtensionMode.Test ? new IntegrationTestProbe() : undefined;
	const view = createVsCodeVisualizationView(probe);
	const controller = createVsCodeCommandController(view, probe);

	context.subscriptions.push(view);
	registerGlitchLensCommands(context, controller);
	registerGlitchLensCodeLensProvider(context);
	registerDocumentChangeCancellation(context, controller);
	registerWorkspaceTrustLifecycle(context);
	if (probe) {
		registerIntegrationTestSupport(context, probe, view);
	}
}

function registerDocumentChangeCancellation(context: vscode.ExtensionContext, controller: { cancelForDocument(documentUri: string): void }): void {
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
		controller.cancelForDocument(event.document.uri.toString());
	}));
}

function registerWorkspaceTrustLifecycle(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
		// Runtime guards read vscode.workspace.isTrusted at execution time.
	}));
}
