import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReplacement, applyUndo, canUndo, snapshotMessage } from '../undo.js';

test('undo exports callable snapshot and apply surfaces', () => {
    assert.equal(typeof snapshotMessage, 'function');
    assert.equal(typeof applyReplacement, 'function');
    assert.equal(typeof applyUndo, 'function');
    assert.equal(typeof canUndo, 'function');

    const snapshot = snapshotMessage({ mes: 'before' }, { chatKey: 'chat-1', index: 2 });
    assert.equal(snapshot.originalText, 'before');
    assert.equal(snapshot.chatKey, 'chat-1');
    assert.equal(snapshot.index, 2);
    assert.equal(applyReplacement().ok, false);
    assert.equal(applyUndo().ok, false);
    assert.equal(canUndo(null), false);
});
