import * as vscode from 'vscode';

export interface WorkspaceTrustState {
	readonly isTrusted: boolean;
}

export function getWorkspaceTrustState(): WorkspaceTrustState {
	return {
		isTrusted: vscode.workspace.isTrusted,
	};
}
