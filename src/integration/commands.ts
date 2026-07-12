import * as vscode from 'vscode';

import type { SourceRange } from '../flow-model';
import { CommandController, type CommandPosition, type CommandTextDocument } from './commandController';
import { visualizeFunctionFlowCommandId } from './commandIds';

export { visualizeFunctionFlowCommandId } from './commandIds';

export interface CodeLensCommandInput {
	readonly uri: string;
	readonly languageId: string;
	readonly version: number;
	readonly functionName: string;
	readonly functionRange: CodeLensFunctionRange;
}

type CodeLensFunctionRange =
	| {
		readonly startLine: number;
		readonly startCharacter: number;
		readonly endLine: number;
		readonly endCharacter: number;
	}
	| {
		readonly start: {
			readonly line: number;
			readonly character: number;
		};
		readonly end: {
			readonly line: number;
			readonly character: number;
		};
	};

export function registerGlitchLensCommands(context: vscode.ExtensionContext, controller: CommandController): vscode.Disposable {
	const visualizeCommand = vscode.commands.registerCommand(visualizeFunctionFlowCommandId, async (input?: CodeLensCommandInput) => {
		const editor = vscode.window.activeTextEditor;

		if (!editor && !input) {
			void vscode.window.showInformationMessage('GlitchLens: Open a TypeScript or JavaScript file to visualize function flow.');
			return;
		}

		if (input) {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(input.uri));
			await controller.visualizeFromCodeLens({
				document: toCommandDocument(document),
				functionRange: sourceRangeFromCodeLens(input.functionRange),
				cancellation: { isCancellationRequested: false },
			});
			return;
		}

		const activeEditor = editor;
		if (!activeEditor) {
			return;
		}
		await controller.visualizeFromCursor({
			document: toCommandDocument(activeEditor.document),
			position: activeEditor.selection.active,
			cancellation: { isCancellationRequested: false },
		});
	});

	context.subscriptions.push(visualizeCommand);
	return visualizeCommand;
}

function toCommandDocument(document: vscode.TextDocument): CommandTextDocument {
	return {
		uri: document.uri,
		languageId: document.languageId,
		version: document.version,
		getText: () => document.getText(),
		offsetAt: (position: CommandPosition) => document.offsetAt(new vscode.Position(position.line, position.character)),
	};
}

function sourceRangeFromCodeLens(range: CodeLensFunctionRange): SourceRange {
	if ('start' in range) {
		return {
			start: { line: range.start.line, character: range.start.character },
			end: { line: range.end.line, character: range.end.character },
		};
	}

	return {
		start: { line: range.startLine, character: range.startCharacter },
		end: { line: range.endLine, character: range.endCharacter },
	};
}
