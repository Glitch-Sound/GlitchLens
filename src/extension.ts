import * as vscode from 'vscode';

import { registerGlitchLensCodeLensProvider } from './integration/codeLensProvider';
import { registerGlitchLensCommands } from './integration/commands';

export function activate(context: vscode.ExtensionContext): void {
	registerGlitchLensCommands(context);
	registerGlitchLensCodeLensProvider(context);
}

export function deactivate(): void {}
