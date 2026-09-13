export const SYSTEM_PROMPT = [
    'Верни только переписанный текст выбранного сообщения.',
    'Не комментируй изменения, не добавляй кавычки или пояснения и не продолжай сцену за пределами этого сообщения.',
].join(' ');

const INSTRUCTION_HEADER = 'Перефразируй и переделай сообщение, соблюдая эти инструкции:';
const CONTEXT_HEADER = 'Контекст:';
const TARGET_HEADER = 'Сообщение для изменения:';

function roleOf(message) {
    if (message?.is_user) {
        return 'user';
    }
    if (message?.is_system) {
        return 'system';
    }
    return 'assistant';
}

function headerName(name) {
    // A newline in the name would split the header and make role/name labels ambiguous.
    return String(name ?? '').replace(/[\r\n]+/g, ' ');
}

export function serializeMessage(message) {
    const isUser = Boolean(message?.is_user);
    const isSystem = Boolean(message?.is_system);
    // JSON quotes keep names with spaces, quotes, or `is_user=` from blending into neighboring labels.
    const header = `[${roleOf(message)}] name=${JSON.stringify(headerName(message?.name))} is_user=${isUser} is_system=${isSystem}`;
    const text = message?.mes == null ? '' : String(message.mes);
    return `${header}\n${text}`;
}

function formatMessages(messages) {
    return messages.map(serializeMessage).join('\n\n');
}

export function buildPrompt(chat, targetIndex, feedback) {
    if (!Array.isArray(chat)) {
        throw new Error('chat must be an array');
    }
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= chat.length) {
        throw new Error('targetIndex is out of range');
    }
    if (typeof feedback !== 'string' || feedback.trim() === '') {
        throw new Error('feedback must be a non-empty string');
    }

    const target = chat[targetIndex];
    // Filter instead of splice so the caller's chat snapshot stays untouched.
    const history = chat.filter((_, index) => index !== targetIndex);
    const contextBody = formatMessages(history);
    const parts = [
        INSTRUCTION_HEADER,
        feedback,
        '',
        CONTEXT_HEADER,
    ];

    if (contextBody) {
        parts.push(contextBody);
    }

    parts.push('', TARGET_HEADER, serializeMessage(target));

    return {
        systemPrompt: SYSTEM_PROMPT,
        prompt: parts.join('\n'),
    };
}
