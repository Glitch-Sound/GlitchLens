import type { SyntaxNode } from '@lezer/common';

import type { SourceFileInput } from '../languageAnalyzer';
import type { FunctionCandidate, FunctionLocator, FunctionLocatorResult, FunctionRange } from '../functionLocator';
import { directChildren, firstChildNamed, parsePython } from './pythonParser';

export class PythonFunctionLocator implements FunctionLocator {
	public readonly id = 'python';
	public readonly version = '1.0.0';
	public readonly languageIds = ['python'] as const;

	public findFunctionCandidates(source: SourceFileInput): readonly FunctionCandidate[] {
		const parsed = parsePython(source.text);
		const candidates: FunctionCandidate[] = [];
		parsed.tree.iterate({
			enter: node => {
				if (node.name !== 'FunctionDefinition') {
					return;
				}
				const candidate = toCandidate(node.node, source.text);
				if (candidate) {
					candidates.push(candidate);
				}
			},
		});
		return candidates.sort((left, right) => left.fullRange.startOffset - right.fullRange.startOffset);
	}

	public findFunctionContainingOffset(source: SourceFileInput, offset: number): FunctionLocatorResult {
		const candidates = this.findFunctionCandidates(source);
		const functionCandidate = candidates
			.filter(candidate => candidate.fullRange.startOffset <= offset && offset <= candidate.fullRange.endOffset)
			.sort((left, right) => rangeLength(left.fullRange) - rangeLength(right.fullRange))[0];
		if (functionCandidate) {
			return { status: 'found', function: functionCandidate };
		}
		return {
			status: 'not-found',
			reason: candidates.length === 0 ? 'no-function-candidates' : 'cursor-outside-function',
		};
	}

	public findFunctionByRange(source: SourceFileInput, range: FunctionRange): FunctionLocatorResult {
		const matched = this.findFunctionCandidates(source).find(candidate => candidate.range.startOffset === range.startOffset && candidate.range.endOffset === range.endOffset);
		return matched
			? { status: 'found', function: matched }
			: { status: 'not-found', reason: 'range-not-matched' };
	}
}

function toCandidate(node: SyntaxNode, text: string): FunctionCandidate | undefined {
	const nameNode = directChildren(node).find(child => child.name === 'VariableName');
	const bodyNode = firstChildNamed(node, 'Body');
	if (!nameNode || !bodyNode) {
		return undefined;
	}
	const lineMap = new LineMap(text);
	return {
		name: text.slice(nameNode.from, nameNode.to),
		kind: 'function-declaration',
		range: lineMap.range(nameNode.from, nameNode.to),
		fullRange: lineMap.range(node.from, node.to),
		bodyRange: lineMap.range(bodyNode.from, bodyNode.to),
	};
}

function rangeLength(range: FunctionRange): number {
	return range.endOffset - range.startOffset;
}

class LineMap {
	private readonly starts: number[] = [0];

	public constructor(text: string) {
		for (let index = 0; index < text.length; index += 1) {
			if (text[index] === '\n') {
				this.starts.push(index + 1);
			}
		}
	}

	public range(startOffset: number, endOffset: number): FunctionRange {
		return {
			startOffset,
			endOffset,
			start: this.position(startOffset),
			end: this.position(endOffset),
		};
	}

	private position(offset: number): { readonly line: number; readonly character: number } {
		let low = 0;
		let high = this.starts.length;
		while (low + 1 < high) {
			const middle = Math.floor((low + high) / 2);
			if (this.starts[middle] <= offset) {
				low = middle;
			} else {
				high = middle;
			}
		}
		return { line: low, character: offset - this.starts[low] };
	}
}
