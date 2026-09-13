import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireLock, beginInit, isInitialized, isLocked, releaseLock } from '../common.js';
import { FEEDBACK_TIMEOUT_MS, runFeedbackGeneration } from '../generation.js';
import { initFeedPros, registerAppReady } from '../index.js';

test('runFeedbackGeneration is a callable generation surface', async () => {
    assert.equal(typeof runFeedbackGeneration, 'function');
    assert.equal(FEEDBACK_TIMEOUT_MS, 30_000);

    const result = await runFeedbackGeneration();
    assert.equal(result.timedOut, false);
    assert.equal(result.timeoutMs, FEEDBACK_TIMEOUT_MS);
});

test('runtime lock rejects a second acquire until release', () => {
    releaseLock();
    assert.equal(isLocked(), false);
    assert.equal(acquireLock(), true);
    assert.equal(isLocked(), true);
    assert.equal(acquireLock(), false);
    releaseLock();
    assert.equal(isLocked(), false);
    assert.equal(acquireLock(), true);
    releaseLock();
});

test('APP_READY initializes once and ignores a second call', async () => {
    const listeners = [];
    const context = {
        event_types: { APP_READY: 'APP_READY' },
        eventSource: {
            on(type, handler) {
                assert.equal(type, 'APP_READY');
                listeners.push(handler);
            },
        },
        extensionSettings: {},
    };

    assert.equal(registerAppReady(context), true);
    assert.equal(listeners.length, 1);
    listeners[0]();

    await new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
            if (isInitialized()) {
                resolve();
                return;
            }
            if (Date.now() - startedAt > 1000) {
                reject(new Error('APP_READY init did not run'));
                return;
            }
            setTimeout(tick, 5);
        };
        tick();
    });
    assert.equal(isInitialized(), true);
    assert.ok(context.extensionSettings.feedPros);

    const settingsRef = context.extensionSettings.feedPros;
    const runtime = await initFeedPros(context);
    assert.equal(runtime.initialized, true);
    assert.equal(context.extensionSettings.feedPros, settingsRef);
    assert.equal(beginInit(), false);
});
