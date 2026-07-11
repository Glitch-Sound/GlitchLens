import * as vscode from 'vscode';

import { isSupportedLanguage } from './documentSelector';

export const visualizeFunctionFlowCommandId = 'glitchlens.visualizeFunctionFlow';

export interface CodeLensCommandInput {
	readonly uri: string;
	readonly languageId: string;
	readonly version: number;
	readonly functionName: string;
	readonly functionRange: {
		readonly startLine: number;
		readonly startCharacter: number;
		readonly endLine: number;
		readonly endCharacter: number;
	};
}

export function registerGlitchLensCommands(context: vscode.ExtensionContext): void {
	const visualizeCommand = vscode.commands.registerCommand(visualizeFunctionFlowCommandId, (input?: CodeLensCommandInput) => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			void vscode.window.showInformationMessage('GlitchLens: Open a TypeScript or JavaScript file to visualize function flow.');
			return;
		}

		if (!isSupportedLanguage(editor.document.languageId)) {
			void vscode.window.showInformationMessage('GlitchLens: TypeScript and JavaScript are supported in the initial release.');
			return;
		}

		if (input) {
			void vscode.window.showInformationMessage(`GlitchLens: Ready to visualize ${input.functionName}.`);
			return;
		}

		void vscode.window.showInformationMessage('GlitchLens: Function flow visualization foundation is ready from cursor.');
	});

	context.subscriptions.push(visualizeCommand);
}
