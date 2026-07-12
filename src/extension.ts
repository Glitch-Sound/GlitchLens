import * as vscode from 'vscode';

import { registerGlitchLensExtension } from './integration/extensionEntry';

export function activate(context: vscode.ExtensionContext): void {
	registerGlitchLensExtension(context);
}

export function deactivate(): void {}
