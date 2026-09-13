import {
    acquireLock, beginInit, getRuntime, notifyError, notifyWarning, releaseLock,
} from './common.js';
import { buildPrompt } from './prompt.js';
import { runFeedbackGeneration } from './generation.js';
import { applyReplacement, applyUndo, snapshotMessage } from './undo.js';
import {
    getSettings, loadSettings, refreshSettingsOptions, renderSettings, saveSettings,
} from './settings.js';

export {
    applyReplacement,
    applyUndo,
    buildPrompt,
    loadSettings,
    renderSettings,
    runFeedbackGeneration,
    snapshotMessage,
};

export async function initFeedPros(context = globalThis.SillyTavern?.getContext?.()) {
    if (!beginInit()) {
        return getRuntime();
    }

    const runtime = getRuntime();
    runtime.api = {
        buildPrompt,
        runFeedbackGeneration,
        snapshotMessage,
        applyReplacement,
        applyUndo,
    };

    try {
        loadSettings(context);
        await renderSettings(context);
        setupMessageUi(context);
        registerLifecycle(context);
    } catch (error) {
        notifyError('feedPros failed to initialize settings.', error);
    }

    return runtime;
}

function makeButton(kind, icon, title) {
    const button = document.createElement('div');
    button.className = `mes_button fa-solid ${icon} interactable feedpros-${kind}`;
    button.title = title;
    button.tabIndex = 0;
    return button;
}

function addButtons(container) {
    if (!container?.querySelector('.feedpros-feedback')) {
        container?.prepend(makeButton('feedback', 'fa-comment-dots', 'Feedback'));
    }
    if (!container?.querySelector('.feedpros-undo')) {
        container?.querySelector('.feedpros-feedback')
            ?.after(makeButton('undo', 'fa-rotate-left', 'Undo last Feedback'));
    } else {
        // Reorder existing buttons too, because extension reload can preserve message DOM.
        container.querySelector('.feedpros-feedback')
            ?.after(container.querySelector('.feedpros-undo'));
    }
}

function refreshButtons(root = document) {
    root.querySelectorAll?.('.mes[mesid]').forEach((message) => {
        addButtons(message.querySelector('.mes_buttons .extraMesButtons'));
    });
}

function setupMessageUi(context) {
    if (typeof document === 'undefined') return;
    addButtons(document.querySelector('#message_template .mes_buttons .extraMesButtons'));
    refreshButtons();
    const runtime = getRuntime();
    runtime.chatObserver?.disconnect();
    const chat = document.querySelector('#chat');
    if (chat) {
        runtime.chatObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) refreshButtons(node);
                }
            }
        });
        runtime.chatObserver.observe(chat, { childList: true, subtree: true });
    }
    document.removeEventListener('click', handleClick);
    document.addEventListener('click', handleClick);
    runtime.context = context;
}

async function requestFeedback() {
    const context = globalThis.SillyTavern.getContext();
    const popupApi = context.Popup
        ? context
        : await import('../../../../scripts/popup.js');
    const { Popup, POPUP_RESULT, POPUP_TYPE } = popupApi;
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = 'Введите фидбэк';
    const textarea = document.createElement('textarea');
    textarea.className = 'feedpros-feedback-input text_pole';
    textarea.rows = 4;
    textarea.setAttribute('aria-label', 'Введите фидбэк');
    label.append(textarea);
    wrapper.append(label);
    const popup = new Popup(wrapper.outerHTML, POPUP_TYPE.TEXT, '', { okButton: 'OK' });
    const showPromise = popup.show();
    const liveTextarea = document.querySelector('.popup:not([style*="display: none"]) .feedpros-feedback-input')
        ?? document.querySelector('.feedpros-feedback-input');
    const popupElement = liveTextarea?.closest('.popup');
    if (popupElement) {
        // Override SillyTavern's centered dialog positioning for this short feedback form.
        popupElement.style.top = '100px';
        popupElement.style.transform = 'translateX(-50%)';
    }
    liveTextarea?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            popup.complete(POPUP_RESULT.AFFIRMATIVE);
        }
    });
    setTimeout(() => liveTextarea?.focus(), 0);
    const result = await showPromise;
    return result === POPUP_RESULT.AFFIRMATIVE ? liveTextarea?.value ?? '' : null;
}

async function ensureChatKey(context) {
    const metadata = context.chatMetadata;
    if (!metadata.feedProsChatKey) {
        metadata.feedProsChatKey = globalThis.crypto?.randomUUID?.()
            ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await context.saveMetadata();
    }
    return metadata.feedProsChatKey;
}

async function runFeedback(index) {
    if (!acquireLock()) {
        notifyWarning('Another feedPros operation is already running.');
        return;
    }
    const runtime = getRuntime();
    const operationId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    runtime.operationId = operationId;
    document.body.classList.add('feedpros-busy');
    try {
        const feedback = await requestFeedback();
        if (feedback == null || feedback.trim() === '') return;
        const context = globalThis.SillyTavern.getContext();
        const target = context.chat?.[index];
        if (!target) throw new Error('Selected message no longer exists');
        const chatKey = await ensureChatKey(context);
        const previousBuffer = getSettings(context).undoBuffer;
        const snapshot = snapshotMessage(target, { chatKey, index, operationId });
        getSettings(context).undoBuffer = { ...snapshot, expectedAfterText: null };
        saveSettings(context);
        try {
            const request = buildPrompt(structuredClone(context.chat), index, feedback);
            const result = await runFeedbackGeneration({
                context,
                settings: getSettings(context),
                isCurrentOperation: () => getRuntime().operationId === operationId,
                onRestoreError: (name, error) => notifyError(`Could not restore ${name}.`, error),
                ...request,
            });
            const fresh = globalThis.SillyTavern.getContext();
            const applied = await applyReplacement({
                context: fresh, snapshot, newText: result.text,
                chatKey: fresh.chatMetadata?.feedProsChatKey,
            });
            if (!applied.ok) throw Object.assign(new Error('Message changed while Feedback was running'), { stale: true });
            getSettings(fresh).undoBuffer = applied.buffer;
            saveSettings(fresh);
        } catch (error) {
            getSettings(context).undoBuffer = previousBuffer;
            saveSettings(context);
            throw error;
        }
    } catch (error) {
        if (error?.stale) notifyWarning(error.message);
        else notifyError(error?.timedOut ? 'Feedback timed out.' : 'Feedback failed.', error);
    } finally {
        runtime.operationId = null;
        document.body.classList.remove('feedpros-busy');
        releaseLock();
    }
}

async function runUndo() {
    if (!acquireLock()) return notifyWarning('Another feedPros operation is already running.');
    document.body?.classList.add('feedpros-busy');
    try {
        const context = globalThis.SillyTavern.getContext();
        const current = getSettings(context);
        if (!current.undoBuffer) return notifyWarning('There is no Feedback to undo in this chat.');
        const result = await applyUndo({
            context,
            buffer: current.undoBuffer,
            chatKey: context.chatMetadata?.feedProsChatKey,
        });
        if (!result.ok) {
            const message = result.reason === 'save'
                ? 'Undo could not save the restored message'
                : 'Undo target changed';
            throw Object.assign(new Error(message), { stale: result.reason === 'stale' });
        }
        current.undoBuffer = null;
        saveSettings(context);
    } catch (error) {
        if (error.stale) notifyWarning(error.message);
        else notifyError('Undo failed.', error);
    } finally {
        document.body?.classList.remove('feedpros-busy');
        releaseLock();
    }
}

function handleClick(event) {
    const button = event.target.closest('.feedpros-feedback, .feedpros-undo');
    if (!button) return;
    if (button.classList.contains('feedpros-undo')) return void runUndo();
    const index = Number(button.closest('.mes')?.getAttribute('mesid'));
    if (Number.isInteger(index)) void runFeedback(index);
}

function registerLifecycle(context) {
    const runtime = getRuntime();
    if (runtime.lifecycleRegistered) return;
    const types = context.event_types ?? context.eventTypes ?? {};
    const onChatChanged = () => {
        runtime.operationId = null;
        const fresh = globalThis.SillyTavern?.getContext?.() ?? context;
        const current = getSettings(fresh);
        const key = fresh.chatMetadata?.feedProsChatKey;
        if (current.undoBuffer && (current.undoBuffer.chatKey !== key
            || fresh.chat?.[current.undoBuffer.index]?.mes !== current.undoBuffer.expectedAfterText)) {
            current.undoBuffer = null;
            saveSettings(fresh);
        }
        refreshButtons();
    };
    for (const type of [types.CHAT_CHANGED]) if (type) context.eventSource.on(type, onChatChanged);
    for (const type of [types.MORE_MESSAGES_LOADED, types.MESSAGE_RECEIVED, types.MESSAGE_SWIPED]) {
        if (type) context.eventSource.on(type, () => refreshButtons());
    }
    for (const type of [types.MAIN_API_CHANGED, types.PRESET_CHANGED]) {
        if (type) context.eventSource.on(type, () => void refreshSettingsOptions(globalThis.SillyTavern.getContext()));
    }
    runtime.lifecycleRegistered = true;
}

export function registerAppReady(context = globalThis.SillyTavern?.getContext?.()) {
    const eventType = context?.event_types?.APP_READY;
    if (!context?.eventSource?.on || !eventType) {
        return false;
    }

    const runtime = getRuntime();
    if (runtime.appReadyRegistered) {
        return true;
    }

    context.eventSource.on(eventType, () => {
        // ST awaits APP_READY listeners; defer so this setup does not block readiness.
        setTimeout(() => {
            const fresh = globalThis.SillyTavern?.getContext?.() ?? context;
            void initFeedPros(fresh);
        }, 0);
    });

    runtime.appReadyRegistered = true;
    return true;
}

export function onDisable() {
    const runtime = getRuntime();
    runtime.disabled = true;
    runtime.operationId = null;
    runtime.chatObserver?.disconnect();
    if (typeof document !== 'undefined') document.removeEventListener('click', handleClick);
}

export function onDelete() {
    onDisable();
}

function startWhenContextReady() {
    if (registerAppReady()) {
        return;
    }

    if (typeof window === 'undefined') {
        return;
    }

    // Third-party scripts can evaluate before getContext() exists; retry until APP_READY can be bound.
    const startedAt = Date.now();
    const timer = setInterval(() => {
        if (registerAppReady() || Date.now() - startedAt > 30_000) {
            clearInterval(timer);
        }
    }, 50);
}

startWhenContextReady();
