export interface TextRange {
	readonly startLine: number;
	readonly startCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
}

export interface FunctionCandidate {
	readonly name: string;
	readonly range: TextRange;
}

const functionDeclarationPattern = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const arrowFunctionPattern = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;

export function findFunctionCandidates(text: string): FunctionCandidate[] {
	const lines = text.split(/\r?\n/);
	const candidates: FunctionCandidate[] = [];

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		const match = functionDeclarationPattern.exec(line) ?? arrowFunctionPattern.exec(line);

		if (match) {
			const name = match[1];
			const startCharacter = line.indexOf(name);
			candidates.push({
				name,
				range: {
					startLine: lineIndex,
					startCharacter,
					endLine: lineIndex,
					endCharacter: startCharacter + name.length,
				},
			});
		}
	}

	return candidates;
}
