import * as vscode from 'vscode';

import { registerGlitchLensCodeLensProvider } from './integration/codeLensProvider';
import { registerGlitchLensCommands } from './integration/commands';
import { getWorkspaceTrustState } from './integration/workspaceTrust';

export function activate(context: vscode.ExtensionContext): void {
	registerGlitchLensCommands(context);
	registerGlitchLensCodeLensProvider(context);
	getWorkspaceTrustState();
}

export function deactivate(): void {}
