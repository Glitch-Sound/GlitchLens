import type { CallResolution } from './flowNode';

export const flowParticipantKinds = ['instance', 'class', 'unknown', 'unresolved'] as const;

export type FlowParticipantKind = typeof flowParticipantKinds[number];

export interface FlowParticipant {
	readonly key: string;
	readonly label: string;
	readonly kind: FlowParticipantKind;
}

export function namedParticipant(kind: Extract<FlowParticipantKind, 'instance' | 'class'>, name: string): FlowParticipant {
	return { key: `${kind}:${name}`, label: name, kind };
}

export function fallbackParticipant(resolution: CallResolution): FlowParticipant {
	return resolution === 'unresolved'
		? { key: 'unresolved', label: 'Unresolved', kind: 'unresolved' }
		: { key: 'unknown', label: 'Unknown', kind: 'unknown' };
}
