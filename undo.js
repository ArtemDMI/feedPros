import { isLocked } from './common.js';

export function snapshotMessage(message, meta = {}) {
    return {
        chatKey: meta.chatKey ?? null,
        index: meta.index ?? -1,
        operationId: meta.operationId ?? null,
        originalText: message?.mes ?? '',
        expectedAfterText: meta.expectedAfterText ?? null,
        message: structuredClone(message),
        identity: {
            is_user: Boolean(message?.is_user),
            is_system: Boolean(message?.is_system),
            name: message?.name ?? '',
        },
    };
}

function validTarget(chat, snapshot, expectedText) {
    const message = chat?.[snapshot?.index];
    return Boolean(message)
        && message.mes === expectedText
        && Boolean(message.is_user) === snapshot.identity.is_user
        && Boolean(message.is_system) === snapshot.identity.is_system
        && (message.name ?? '') === snapshot.identity.name;
}

function validUndoTarget(chat, buffer) {
    const message = chat?.[buffer?.index];
    return Boolean(message) && message.mes === buffer.expectedAfterText;
}

function setText(message, text) {
    message.mes = text;
    if (Array.isArray(message.swipes)
        && Number.isInteger(message.swipe_id)
        && message.swipe_id >= 0
        && message.swipe_id < message.swipes.length) {
        message.swipes[message.swipe_id] = text;
    }
}

async function persist(context) {
    await context.saveChat();
    await context.reloadCurrentChat?.();
}

export function applyReplacement({ context, snapshot, newText, chatKey } = {}) {
    if (!context || !snapshot || snapshot.chatKey !== chatKey
        || !validTarget(context.chat, snapshot, snapshot.originalText)) {
        return { ok: false, reason: 'stale' };
    }
    return applyReplacementAsync({ context, snapshot, newText });
}

async function applyReplacementAsync({ context, snapshot, newText }) {
    const target = context.chat[snapshot.index];
    const beforeMutation = structuredClone(target);
    try {
        setText(target, newText);
        if (typeof context.getTokenCountAsync === 'function') {
            target.extra ??= {};
            target.extra.token_count = await context.getTokenCountAsync(newText);
        }
        await persist(context);
        return {
            ok: true,
            buffer: { ...snapshot, expectedAfterText: newText },
        };
    } catch (error) {
        context.chat[snapshot.index] = beforeMutation;
        return { ok: false, reason: 'save', error };
    }
}

export function applyUndo({ context, buffer, chatKey } = {}) {
    if (!context || !buffer || buffer.chatKey !== chatKey
        || !validUndoTarget(context.chat, buffer)) {
        return { ok: false, reason: 'stale' };
    }
    return applyUndoAsync({ context, buffer });
}

async function applyUndoAsync({ context, buffer }) {
    const current = structuredClone(context.chat[buffer.index]);
    try {
        context.chat[buffer.index] = structuredClone(buffer.message);
        // Old chats can contain an inconsistent active swipe; restoring the captured text keeps both views aligned.
        setText(context.chat[buffer.index], buffer.originalText);
        await persist(context);
        return { ok: true };
    } catch (error) {
        context.chat[buffer.index] = current;
        return { ok: false, reason: 'save', error };
    }
}

export function canUndo(buffer) {
    return !isLocked() && Boolean(buffer);
}
