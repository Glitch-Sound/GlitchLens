import * as assert from 'assert';

import { formatMessageLabel, defaultMessageLabelPolicy } from '../renderer/messageLabel';

suite('MessageLabelFormatter', () => {
	test('summarizes a return call with object arguments', () => {
		const label = formatMessageLabel({
			kind: 'return',
			expression: 'JSON.stringify({ documentUri: key.documentUri, documentVersion: key.documentVersion })',
		}, defaultMessageLabelPolicy);

		assert.strictEqual(label, 'return JSON.stringify(...)');
	});

	test('keeps call identity and resolution markers', () => {
		assert.strictEqual(formatMessageLabel({ kind: 'call', calleeName: 'saveUser', awaited: true }, defaultMessageLabelPolicy), 'await saveUser');
		assert.strictEqual(formatMessageLabel({ kind: 'call', calleeName: 'execute', resolution: 'unresolved' }, defaultMessageLabelPolicy), 'execute (unresolved)');
		assert.strictEqual(formatMessageLabel({ kind: 'call', resolution: 'unknown' }, defaultMessageLabelPolicy), 'unknown call');
	});

	test('limits labels without dropping the operation prefix', () => {
		const label = formatMessageLabel({
			kind: 'return',
			expression: 'firstValue + secondValue + thirdValue + fourthValue + fifthValue + sixthValue + seventhValue',
		}, defaultMessageLabelPolicy);

		assert.ok(label.length <= defaultMessageLabelPolicy.maxLength);
		assert.ok(label.startsWith('return '));
		assert.ok(label.endsWith('...'));
	});
});
