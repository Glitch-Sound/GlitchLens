import { parser } from '@lezer/python';
import type { SyntaxNode, Tree } from '@lezer/common';

export interface ParsedPythonSource {
	readonly tree: Tree;
	readonly hasErrors: boolean;
}

export function parsePython(text: string): ParsedPythonSource {
	const tree = parser.parse(text);
	let hasErrors = false;
	tree.iterate({
		enter: node => {
			if (node.type.isError) {
				hasErrors = true;
			}
		},
	});
	return { tree, hasErrors };
}

export function directChildren(node: SyntaxNode): SyntaxNode[] {
	const children: SyntaxNode[] = [];
	for (let child = node.firstChild; child; child = child.nextSibling) {
		children.push(child);
	}
	return children;
}

export function firstChildNamed(node: SyntaxNode, name: string): SyntaxNode | undefined {
	return directChildren(node).find(child => child.name === name);
}
