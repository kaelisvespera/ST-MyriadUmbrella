import assert from 'node:assert/strict';
import test from 'node:test';

import { isCompactHome } from '../src/home-window.js';
import { retractInput } from '../src/host.js';
import { installTauriBack } from '../src/tauri-back.js';

test('TT mobile hosts use the compact home even at tablet widths', () => {
    assert.equal(isCompactHome({ innerWidth: 820, __TAURITAVERN_HOST__: { kind: 'mobile' } }), true);
    assert.equal(isCompactHome({ innerWidth: 820, __TAURITAVERN_HOST__: { kind: 'desktop' } }), false);
    assert.equal(isCompactHome({ innerWidth: 400 }), true);
});

test('TT Back leaves light DOM dialogs to the host and restores the previous bridge', () => {
    let hostDialog = true;
    let hostCalls = 0;
    let umbrellaCalls = 0;
    const original = () => { hostCalls++; return true; };
    const win = {
        __TAURITAVERN_HOST__: { kind: 'mobile' },
        __TAURITAVERN_HANDLE_BACK__: original,
        document: { querySelector: () => hostDialog },
    };
    const stop = installTauriBack(() => { umbrellaCalls++; return true; }, win);

    assert.equal(win.__TAURITAVERN_HANDLE_BACK__(), true);
    assert.deepEqual([hostCalls, umbrellaCalls], [1, 0]);
    hostDialog = false;
    assert.equal(win.__TAURITAVERN_HANDLE_BACK__(), true);
    assert.deepEqual([hostCalls, umbrellaCalls], [1, 1]);
    stop();
    assert.equal(win.__TAURITAVERN_HANDLE_BACK__, original);
});

test('TT QR retract stops before touching a replacement chat that reuses the chat array', async t => {
    const chat = [{ is_user: true, mes: 'old input' }, { mes: 'old reply' }];
    const replacement = [{ is_user: true, mes: 'new input' }, { mes: 'new reply' }];
    const deleted = [];
    const composer = new EventTarget();
    composer.value = '';
    composer.focus = () => assert.fail('must not focus the replacement chat');
    let chatId = 'old';
    const context = {
        chat,
        getCurrentChatId: () => chatId,
        async deleteMessage(index) {
            deleted.push(index);
            chat.splice(index, 1);
            chatId = 'new';
            chat.splice(0, chat.length, ...replacement);
        },
        async saveChat() { assert.fail('must not save the replacement chat'); },
    };
    const oldHost = globalThis.SillyTavern;
    const oldIdentity = globalThis.__TAURITAVERN_HOST__;
    t.after(() => {
        globalThis.SillyTavern = oldHost;
        globalThis.__TAURITAVERN_HOST__ = oldIdentity;
    });
    globalThis.SillyTavern = { getContext: () => ({ ...context }) };
    globalThis.__TAURITAVERN_HOST__ = { kind: 'mobile' };
    const documentRef = { getElementById: id => id === 'send_textarea' ? composer : null };

    await assert.rejects(retractInput(context, documentRef), /已停止回退/);
    assert.deepEqual(deleted, [1]);
    assert.deepEqual(chat, replacement);
});
