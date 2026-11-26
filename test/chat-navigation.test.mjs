import assert from 'node:assert/strict';
import test from 'node:test';
import { chatNavigationReplies, registerChatNavigationCommands } from '../src/chat-navigation.js';

function fixture(t, { materializeJumps = false } = {}) {
    const scrolls = [];
    const jumps = [];
    const warnings = [];
    let currentChatId = 'a';
    let currentPopup;
    const container = {
        clientTop: 0,
        clientHeight: 300,
        scrollHeight: 5100,
        scrollTop: 3175,
        querySelectorAll() { return rows; },
        querySelector(selector) {
            const id = /mesid="(\d+)"/.exec(selector)?.[1];
            return id == null ? rows[0] : rows.find(row => row.getAttribute('mesid') === id);
        },
        getBoundingClientRect() { return { top: 40 }; },
    };
    const makeRow = id => ({
        getAttribute: () => String(id),
        getBoundingClientRect() {
            const top = 40 + id * 100 - container.scrollTop;
            return { top, bottom: top + 100, height: 100 };
        },
    });
    const rows = [31, 32, 33, 34].map(makeRow);
    const context = {
        chat: Array.from({ length: 51 }, () => ({})),
        getCurrentChatId: () => currentChatId,
        SlashCommandParser: {
            commands: { 'chat-jump': {} },
            addCommandObject(command) { this.commands[command.name] = command; },
        },
        SlashCommand: { fromProps: props => props },
        executeSlashCommandsWithOptions: async text => {
            jumps.push(text);
            if (materializeJumps) {
                const id = Number(text.split(' ')[1]);
                rows.unshift(makeRow(id));
                container.scrollTop = id * 100 - 80;
            }
        },
        scrollChatSurfaceTo(options) { scrolls.push(options); container.scrollTop = options.top; },
        POPUP_TYPE: { INPUT: 3 },
        POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CUSTOM1: 1001, CUSTOM2: 1002 },
        Popup: class {
            mainInput = {};
            constructor(content, type, value, options) {
                this.content = content;
                this.value = value;
                this.type = type;
                this.options = options;
                currentPopup = this;
            }
            show() { return new Promise(resolve => { this.resolve = resolve; }); }
            close(result, input) { this.result = result; this.resolve(input); }
        },
    };
    const globals = {
        SillyTavern: { getContext: () => context },
        __TAURITAVERN_HOST__: { kind: 'mobile', platform: 'android' },
        toastr: { warning: message => warnings.push(message) },
        document: { getElementById: id => id === 'chat' && container, createElement: () => ({}) },
        getComputedStyle: () => ({ paddingTop: '0px' }),
        matchMedia: () => ({ matches: false }),
    };
    for (const [key, value] of Object.entries(globals)) {
        const original = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { value, configurable: true });
        t.after(() => {
            if (original) Object.defineProperty(globalThis, key, original);
            else delete globalThis[key];
        });
    }
    registerChatNavigationCommands();
    const run = name => context.SlashCommandParser.commands[name].callback();
    return { container, scrolls, jumps, warnings, run, popup: () => currentPopup, switchChat: () => { currentChatId = 'b'; } };
}

test('native QR navigation aligns the current message, loads the previous floor through TT and reaches the bottom', async t => {
    const { scrolls, jumps, run, warnings } = fixture(t, { materializeJumps: true });
    assert.deepEqual(chatNavigationReplies, [
        ['回顶', '/tt-chat-up'], ['回底', '/tt-chat-bottom'], ['回楼层', '/tt-chat-floor'],
    ]);
    await run('tt-chat-up');
    assert.deepEqual(scrolls, [{ top: 3100, behavior: 'instant' }]);
    assert.deepEqual(jumps, []);
    await run('tt-chat-up');
    assert.deepEqual(jumps, ['/chat-jump 30']);
    assert.deepEqual(scrolls.at(-1), { top: 3000, behavior: 'instant' });
    await run('tt-chat-bottom');
    assert.deepEqual(scrolls.at(-1), { top: 5100, behavior: 'instant' });
    assert.deepEqual(warnings, []);
});

test('floor picker handles unloaded quick jumps, strict floor input, cancellation and changing chats', async t => {
    const { container, scrolls, jumps, run, popup, switchChat, warnings } = fixture(t);
    let pending = run('tt-chat-floor');
    assert.equal(popup().value, '31');
    assert.equal(popup().mainInput.inputMode, 'numeric');
    assert.match(popup().content.textContent, /#31.*#50/);
    assert.deepEqual(popup().options.customButtons.map(button => button.text), ['回顶10层', '回顶20层']);
    popup().close(1001);
    await pending;
    pending = run('tt-chat-floor');
    popup().close(1002);
    await pending;
    pending = run('tt-chat-floor');
    popup().close(1, '3');
    await pending;
    assert.deepEqual(jumps, ['/chat-jump 21', '/chat-jump 11', '/chat-jump 3']);

    pending = run('tt-chat-floor');
    popup().close(1, '3.1');
    await pending;
    assert.deepEqual(warnings, ['请输入 #0 到 #50 之间的整数楼层。']);
    pending = run('tt-chat-floor');
    popup().close(0);
    await pending;
    pending = run('tt-chat-floor');
    switchChat();
    popup().close(1, '33');
    await pending;
    assert.deepEqual(scrolls, []);
    assert.equal(container.scrollTop, 3175);
    assert.equal(jumps.length, 3);
});
