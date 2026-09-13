import { FEEDBACK_TIMEOUT_MS } from './common.js';

export { FEEDBACK_TIMEOUT_MS };

export async function runFeedbackGeneration({
    context,
    generate,
    timer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (id) => clearTimeout(id),
    isCurrentOperation,
    settings = {},
    onRestoreError = () => {},
    timeoutMs = FEEDBACK_TIMEOUT_MS,
    systemPrompt,
    prompt,
} = {}) {
    if (!context && !generate) {
        return { text: '', timedOut: false, restored: false, timeoutMs };
    }
    if (!context) throw new Error('SillyTavern context is unavailable');
    const runGenerate = generate ?? ((args) => context.generateRaw(args));
    const command = (text) => context.executeSlashCommandsWithOptions(text, { handleParserErrors: false });
    const api = context.mainApi?.toLowerCase() ?? '';
    const useProfile = settings.useDifferentProfile && settings.profileName;
    const presetName = settings.apiPresets?.[api];
    const usePreset = settings.useDifferentApiPreset && presetName;
    let previousProfile = null;
    let previousPreset = null;
    let profileChanged = false;
    let presetChanged = false;
    let timedOut = false;
    let timeoutId;
    context.deactivateSendButtons?.();
    try {
        if (useProfile) {
            previousProfile = (await command('/profile'))?.pipe;
            const result = await command(`/profile ${settings.profileName}`);
            if (result?.isError) throw new Error(`Could not switch to Connection Profile "${settings.profileName}"`);
            profileChanged = true;
        }
        if (usePreset) {
            previousPreset = context.getPresetManager().getSelectedPresetName();
            const result = await command(`/preset ${presetName}`);
            if (result?.isError) throw new Error(`Could not switch to API Preset "${presetName}"`);
            presetChanged = true;
        }
        const generation = Promise.resolve().then(() => runGenerate({ systemPrompt, prompt }));
        // Observe a rejection after timeout so providers cannot create an unhandled rejection.
        generation.catch(() => {});
        const timeout = new Promise((_, reject) => {
            timeoutId = timer(() => {
                timedOut = true;
                reject(new Error(`Feedback timed out after ${timeoutMs} ms`));
            }, timeoutMs);
        });
        const text = await Promise.race([generation, timeout]);
        clearTimer(timeoutId);
        if (timedOut || (isCurrentOperation && !isCurrentOperation())) {
            throw new Error('Feedback operation is no longer current');
        }
        if (typeof text !== 'string' || text.trim() === '') {
            throw new Error('Model returned an empty response');
        }
        return { text, timedOut: false, restored: true, timeoutMs };
    } catch (error) {
        error.timedOut = timedOut;
        throw error;
    } finally {
        if (timeoutId !== undefined) clearTimer(timeoutId);
        if (profileChanged) {
            try {
                const result = await command(`/profile ${previousProfile}`);
                if (result?.isError) throw new Error('Profile restore command failed');
            } catch (error) {
                onRestoreError('Connection Profile', error);
            }
        }
        if (presetChanged) {
            try {
                const result = await command(`/preset ${previousPreset}`);
                if (result?.isError) throw new Error('Preset restore command failed');
            } catch (error) {
                onRestoreError('API Preset', error);
            }
        }
        context.activateSendButtons?.();
    }
}
