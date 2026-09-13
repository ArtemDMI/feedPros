export const EXTENSION_NAME = 'feedPros';
export const SETTINGS_KEY = 'feedPros';
export const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;
export const FEEDBACK_TIMEOUT_MS = 30_000;

// Symbol.for survives duplicate module evaluation, which ST can trigger on reload.
const RUNTIME_KEY = Symbol.for('feedPros.runtime');
const INIT_GUARD = Symbol.for('feedPros.initialized');

export function getRuntime() {
    if (!globalThis[RUNTIME_KEY]) {
        globalThis[RUNTIME_KEY] = {
            initialized: false,
            operationLock: false,
            chatObserver: null,
            operationId: null,
            previousUndoBuffer: null,
            appReadyRegistered: false,
            api: null,
        };
    }

    return globalThis[RUNTIME_KEY];
}

export function isInitialized() {
    return Boolean(globalThis[INIT_GUARD]);
}

export function beginInit() {
    if (globalThis[INIT_GUARD]) {
        return false;
    }

    globalThis[INIT_GUARD] = true;
    getRuntime().initialized = true;
    return true;
}

export function isLocked() {
    return Boolean(getRuntime().operationLock);
}

export function acquireLock() {
    const runtime = getRuntime();
    if (runtime.operationLock) {
        return false;
    }

    runtime.operationLock = true;
    return true;
}

export function releaseLock() {
    getRuntime().operationLock = false;
}

export function notifyError(text, exception) {
    const message = exception ? `${text}\n${exception}` : text;
    // toastr exists in ST; Node tests still need a callable error surface.
    if (typeof globalThis.toastr?.error === 'function') {
        globalThis.toastr.error(message, EXTENSION_NAME);
    } else {
        console.error(`[${EXTENSION_NAME}]`, message);
    }
}

export function notifyWarning(text, exception) {
    const message = exception ? `${text}\n${exception}` : text;
    if (typeof globalThis.toastr?.warning === 'function') {
        globalThis.toastr.warning(message, EXTENSION_NAME);
    } else {
        console.warn(`[${EXTENSION_NAME}]`, message);
    }
}
