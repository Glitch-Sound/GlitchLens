export type MessageLabelKind = 'call' | 'return' | 'throw';

export interface MessageLabelInput {
	readonly kind: MessageLabelKind;
	readonly calleeName?: string;
	readonly expression?: string;
	readonly resolution?: 'resolved' | 'unknown' | 'unresolved';
	readonly awaited?: boolean;
}

export interface MessageLabelPolicy {
	readonly maxLength: number;
	readonly omission: string;
}

export const defaultMessageLabelPolicy: MessageLabelPolicy = {
	maxLength: 80,
	omission: '...',
};

export function formatMessageLabel(input: MessageLabelInput, policy: MessageLabelPolicy = defaultMessageLabelPolicy): string {
	const raw = input.kind === 'call' ? formatCall(input) : formatExpression(input);
	return limitLabel(raw, policy);
}

function formatCall(input: MessageLabelInput): string {
	if (input.resolution === 'unknown') {
		return 'unknown call';
	}
	const prefix = input.awaited ? 'await ' : '';
	const suffix = input.resolution === 'unresolved' ? ' (unresolved)' : '';
	return `${prefix}${input.calleeName ?? '<unknown>'}${suffix}`;
}

function formatExpression(input: MessageLabelInput): string {
	const prefix = input.kind === 'return' ? 'return' : 'throw';
	const expression = normalizeExpression(input.expression ?? '');
	if (!expression) {
		return prefix;
	}
	const callTarget = expression.match(/^([\p{L}_$][\w$]*(?:\.[\p{L}_$][\w$]*)*)\s*\(/u)?.[1];
	return callTarget ? `${prefix} ${callTarget}(...)` : `${prefix} ${expression}`;
}

function normalizeExpression(expression: string): string {
	return expression.replace(/\s+/g, ' ').trim();
}

function limitLabel(label: string, policy: MessageLabelPolicy): string {
	if (label.length <= policy.maxLength) {
		return label;
	}
	const omission = policy.omission;
	const limit = Math.max(0, policy.maxLength - omission.length);
	return `${label.slice(0, limit).trimEnd()}${omission}`;
}
