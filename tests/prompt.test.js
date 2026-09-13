import assert from 'node:assert/strict';
import test from 'node:test';
import { SYSTEM_PROMPT, buildPrompt, serializeMessage } from '../prompt.js';

const CONTEXT_HEADER = 'Вот контекст:';
const INSTRUCTION_HEADER = 'Вот инструкции которые нужно выполнить и все что ввел юзер';
const TARGET_HEADER = 'Сообщение для изменения:';

function msg(overrides) {
    return {
        name: '',
        is_user: false,
        is_system: false,
        mes: '',
        extra: { keep: true },
        ...overrides,
    };
}

function expectedPrompt({ feedback, contextMessages, target }) {
    const lines = [CONTEXT_HEADER];
    const contextBody = contextMessages.map(serializeMessage).join('\n\n');
    if (contextBody) {
        lines.push(contextBody);
    }
    lines.push('', INSTRUCTION_HEADER, feedback, '', TARGET_HEADER, serializeMessage(target));
    return lines.join('\n');
}

function splitContract(prompt) {
    const contextStart = `${CONTEXT_HEADER}\n`;
    assert.ok(prompt.startsWith(contextStart), 'prompt must start with the context header');

    const targetMarker = `\n\n${TARGET_HEADER}\n`;
    const targetAt = prompt.lastIndexOf(targetMarker);
    assert.ok(targetAt >= 0, 'prompt must contain the target header');
    assert.equal(prompt.indexOf(targetMarker), targetAt, 'target header must appear once');

    const beforeTarget = prompt.slice(0, targetAt);
    const instructionMarker = `\n\n${INSTRUCTION_HEADER}\n`;
    const instructionAt = beforeTarget.lastIndexOf(instructionMarker);
    assert.ok(instructionAt >= 0, 'prompt must contain the instruction header');

    return {
        context: prompt.slice(contextStart.length, instructionAt).replace(/^\n/, '').replace(/\n$/, ''),
        feedback: beforeTarget.slice(instructionAt + instructionMarker.length),
        target: prompt.slice(targetAt + targetMarker.length),
    };
}

function assertTargetOnce(result, chat, targetIndex, feedback) {
    const target = chat[targetIndex];
    const history = chat.filter((_, index) => index !== targetIndex);
    assert.equal(result.systemPrompt, SYSTEM_PROMPT);
    assert.equal(
        result.prompt,
        expectedPrompt({ feedback, contextMessages: history, target }),
    );

    const parts = splitContract(result.prompt);
    assert.equal(parts.feedback, feedback);
    assert.equal(parts.target, serializeMessage(target));
    assert.equal(parts.context, history.map(serializeMessage).join('\n\n'));

    const targetHeaderHits = result.prompt.split(`\n${TARGET_HEADER}\n`).length - 1;
    assert.equal(targetHeaderHits, 1);
}

test('serializeMessage keeps unambiguous role, name, flags, and current mes', () => {
    assert.equal(
        serializeMessage(msg({ name: 'User', is_user: true, mes: 'Hi' })),
        '[user] name="User" is_user=true is_system=false\nHi',
    );
    assert.equal(
        serializeMessage(msg({ name: 'Char', mes: 'Hello' })),
        '[assistant] name="Char" is_user=false is_system=false\nHello',
    );
    assert.equal(
        serializeMessage(msg({ name: 'Note', is_system: true, mes: 'Stay in scene' })),
        '[system] name="Note" is_user=false is_system=true\nStay in scene',
    );
    assert.equal(
        serializeMessage(msg({ name: 'A"B\nC', is_user: true, mes: 'x' })),
        '[user] name="A\\"B C" is_user=true is_system=false\nx',
    );
});

test('buildPrompt keeps a static systemPrompt and the approved user-prompt order', () => {
    const chat = [msg({ name: 'User', is_user: true, mes: 'Hello' })];
    const result = buildPrompt(chat, 0, 'shorter');

    assert.equal(
        result.systemPrompt,
        'Верни только переписанный текст выбранного сообщения. Не комментируй изменения, не добавляй кавычки или пояснения и не продолжай сцену за пределами этого сообщения.',
    );
    assert.equal(result.systemPrompt, SYSTEM_PROMPT);
    assert.equal(
        buildPrompt(chat, 0, 'warmer').systemPrompt,
        result.systemPrompt,
    );
    assertTargetOnce(result, chat, 0, 'shorter');
    assert.equal(
        result.prompt,
        [
            CONTEXT_HEADER,
            '',
            INSTRUCTION_HEADER,
            'shorter',
            '',
            TARGET_HEADER,
            '[user] name="User" is_user=true is_system=false',
            'Hello',
        ].join('\n'),
    );
    assert.equal(result.systemPrompt.includes('cache'), false);
    assert.equal(result.prompt.includes('<cache'), false);
    assert.equal(result.prompt.includes('cache_control'), false);

    const echoed = buildPrompt(chat, 0, 'keep my summary and cache notes');
    assertTargetOnce(echoed, chat, 0, 'keep my summary and cache notes');
});

test('first, middle, and last targets leave the chosen message only as the final editable block', () => {
    const chat = [
        msg({ name: 'User', is_user: true, mes: 'Ask' }),
        msg({ name: 'Char', mes: 'Reply' }),
        msg({ name: 'Sys', is_system: true, mes: 'Stage direction' }),
    ];

    assertTargetOnce(buildPrompt(chat, 0, 'softer'), chat, 0, 'softer');
    assertTargetOnce(buildPrompt(chat, 1, 'warmer'), chat, 1, 'warmer');
    assertTargetOnce(buildPrompt(chat, 2, 'shorter'), chat, 2, 'shorter');

    const middle = buildPrompt(chat, 1, 'warmer');
    assert.equal(
        middle.prompt,
        [
            CONTEXT_HEADER,
            '[user] name="User" is_user=true is_system=false',
            'Ask',
            '',
            '[system] name="Sys" is_user=false is_system=true',
            'Stage direction',
            '',
            INSTRUCTION_HEADER,
            'warmer',
            '',
            TARGET_HEADER,
            '[assistant] name="Char" is_user=false is_system=false',
            'Reply',
        ].join('\n'),
    );
});

test('all three message types stay in context when they are not the target', () => {
    const chat = [
        msg({ name: 'User', is_user: true, mes: 'Player line' }),
        msg({ name: 'Narrator', is_system: true, mes: 'System note' }),
        msg({ name: 'Char', mes: 'Character line' }),
    ];
    const result = buildPrompt(chat, 2, 'keep the tone');
    const parts = splitContract(result.prompt);

    assert.match(parts.context, /^\[user]/);
    assert.match(parts.context, /\n\n\[system]/);
    assert.equal(parts.target.startsWith('[assistant]'), true);
    assert.equal(parts.context.includes('[assistant]'), false);
    assertTargetOnce(result, chat, 2, 'keep the tone');
});

test('a later Feedback uses the already rewritten mes as the new target', () => {
    const chat = [
        msg({ name: 'User', is_user: true, mes: 'Hi' }),
        msg({ name: 'Char', mes: 'Original reply' }),
    ];
    const first = buildPrompt(chat, 1, 'make it shorter');
    assert.match(first.prompt, /Original reply/);

    chat[1].mes = 'Short reply';
    const second = buildPrompt(chat, 1, 'now warmer');
    assertTargetOnce(second, chat, 1, 'now warmer');
    assert.match(second.prompt, /Short reply/);
    assert.equal(second.prompt.includes('Original reply'), false);
});

test('Unicode names and bodies pass through unchanged', () => {
    const chat = [
        msg({ name: 'Игрок', is_user: true, mes: 'Привет 👋 café' }),
        msg({ name: '名前', mes: '世界 — naïvité\nвторая строка' }),
        msg({ name: 'Система', is_system: true, mes: 'ملاحظة' }),
    ];
    const result = buildPrompt(chat, 1, 'сделай мягче ✨');
    assertTargetOnce(result, chat, 1, 'сделай мягче ✨');
    assert.ok(result.prompt.includes('Привет 👋 café'));
    assert.ok(result.prompt.includes('世界 — naïvité\nвторая строка'));
    assert.ok(result.prompt.includes('ملاحظة'));
    assert.ok(result.prompt.includes('name="名前"'));
});

test('buildPrompt does not mutate the input chat array or message objects', () => {
    const chat = [
        msg({ name: 'User', is_user: true, mes: 'One' }),
        msg({ name: 'Char', mes: 'Two', extra: { keep: true, nested: { n: 1 } } }),
        msg({ name: 'Sys', is_system: true, mes: 'Three' }),
    ];
    const snapshot = structuredClone(chat);
    const refs = chat.map((message) => message);

    const result = buildPrompt(chat, 1, 'edit');
    assertTargetOnce(result, snapshot, 1, 'edit');
    assert.equal(chat.length, 3);
    assert.deepEqual(chat, snapshot);
    for (let index = 0; index < chat.length; index += 1) {
        assert.equal(chat[index], refs[index]);
    }

    Object.freeze(chat);
    for (const message of chat) {
        Object.freeze(message);
        Object.freeze(message.extra);
    }
    assert.doesNotThrow(() => buildPrompt(chat, 0, 'again'));
});

test('history is not truncated and no cache or summary markers are inserted', () => {
    const long = `line ${'я'.repeat(200)} `.repeat(50).trim();
    const chat = [
        msg({ name: 'User', is_user: true, mes: long }),
        msg({ name: 'Char', mes: 'Short' }),
    ];
    const result = buildPrompt(chat, 1, 'keep details');
    assertTargetOnce(result, chat, 1, 'keep details');
    assert.ok(splitContract(result.prompt).context.includes(long));
    assert.equal(result.prompt.includes(long), true);
    assert.equal(/\b(summary|cache_control|<\|)\b/i.test(SYSTEM_PROMPT), false);
});

test('empty feedback, bad index, and non-array chat are rejected', () => {
    const chat = [msg({ is_user: true, mes: 'Hi' })];
    assert.throws(() => buildPrompt(chat, 0, ''), /non-empty/);
    assert.throws(() => buildPrompt(chat, 0, '   '), /non-empty/);
    assert.throws(() => buildPrompt(chat, 0, 12), /non-empty/);
    assert.throws(() => buildPrompt(chat, -1, 'x'), /out of range/);
    assert.throws(() => buildPrompt(chat, 1, 'x'), /out of range/);
    assert.throws(() => buildPrompt(chat, 0.5, 'x'), /out of range/);
    assert.throws(() => buildPrompt({ 0: chat[0] }, 0, 'x'), /array/);
});
