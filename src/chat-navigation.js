import { getHost, notify } from './host.js';

// Navigation behavior follows Junezz's 回顶/回底 v1.1.
const commands = [
    ['回顶', 'tt-chat-up', '对齐当前消息的开头，已经在开头时回到上一条。', goUp],
    ['回底', 'tt-chat-bottom', '滚动到聊天最后一条消息的底部。', goBottom],
    ['回楼层', 'tt-chat-floor', '跳到指定消息楼层，或从当前楼层回退 10 / 20 层。', openFloorPicker],
];
export const chatNavigationReplies = commands.map(([label, name]) => [label, '/' + name]);

let floorPickerOpen = false;

function readChat() {
    const context = getHost();
    const container = document.getElementById('chat');
    if (!container || !context.chat?.length) throw new Error('当前聊天没有可导航的消息。');
    return { context, container, chatId: context.getCurrentChatId?.() };
}

function isSameChat({ context, chatId }) {
    const current = getHost();
    return current.chat === context.chat && current.getCurrentChatId?.() === chatId
        && current.characterId === context.characterId && current.groupId === context.groupId;
}

function viewportTop(container) {
    const padding = Number.parseFloat(getComputedStyle(container).paddingTop) || 0;
    return container.getBoundingClientRect().top + container.clientTop + padding;
}

function currentMessage({ container }) {
    const top = viewportTop(container);
    const bottom = container.getBoundingClientRect().top + container.clientTop + container.clientHeight;
    let previous = null;
    for (const row of container.querySelectorAll(':scope > .mes[mesid]')) {
        const rect = row.getBoundingClientRect();
        if (!rect.height) continue;
        const id = Number(row.getAttribute('mesid'));
        if (!Number.isSafeInteger(id) || id < 0) continue;
        if (rect.bottom > top && rect.top < bottom) return { id, top: rect.top, previous };
        if (rect.bottom <= top) previous = id;
    }
    return null;
}

function isMobile(context) {
    const host = globalThis.__TAURITAVERN_HOST__;
    return host ? host.kind === 'mobile' : context.isMobile?.() === true;
}

function scrollTo({ context, container }, top) {
    const options = {
        top,
        behavior: isMobile(context) || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    };
    if (typeof context.scrollChatSurfaceTo === 'function') context.scrollChatSurfaceTo(options);
    else container.scrollTo(options);
}

async function goToFloor(session, floor) {
    const { context, container } = session;
    if (!isSameChat(session)) return;
    if (!Number.isSafeInteger(floor) || floor < 0 || floor >= context.chat.length) {
        throw new Error(`请输入 #0 到 #${context.chat.length - 1} 之间的整数楼层。`);
    }
    const selector = `:scope > .mes[mesid="${floor}"]`;
    let row = container.querySelector(selector);
    if (!row) {
        if (context.SlashCommandParser?.commands?.['chat-jump'] && typeof context.executeSlashCommandsWithOptions === 'function') {
            // TT handles both bounded projection and ordinary history pagination.
            await context.executeSlashCommandsWithOptions(`/chat-jump ${floor}`);
            if (!isSameChat(session)) return;
            row = container.querySelector(selector);
            // Bounded projection centers the target. Keep the QR actions
            // aligned to the same message start as a jump to a mounted row.
            if (!row) return;
        } else {
            const first = Number(container.querySelector(':scope > .mes[mesid]')?.getAttribute('mesid'));
            if (Number.isSafeInteger(first) && floor < first) {
                const { showMoreMessages } = await import('/script.js');
                if (!isSameChat(session)) return;
                await showMoreMessages(first - floor);
                if (!isSameChat(session)) return;
                row = container.querySelector(selector);
            }
        }
    }
    if (!row) throw new Error(`当前无法找到 #${floor} 楼。`);
    scrollTo(session, container.scrollTop + row.getBoundingClientRect().top - viewportTop(container));
}

async function goUp() {
    const session = readChat();
    const current = currentMessage(session);
    if (!current) throw new Error('当前视野内没有可导航的消息。');
    const threshold = isMobile(session.context) ? 60 : 35;
    const atStart = Math.abs(current.top - viewportTop(session.container)) < threshold;
    if (atStart && current.id === 0) return;
    await goToFloor(session, atStart ? current.previous ?? current.id - 1 : current.id);
}

function goBottom() {
    const session = readChat();
    scrollTo(session, session.container.scrollHeight);
}

async function openFloorPicker() {
    if (floorPickerOpen) return;
    const session = readChat();
    const { context } = session;
    const { Popup, POPUP_TYPE, POPUP_RESULT } = context;
    const current = currentMessage(session)?.id ?? context.chat.length - 1;
    const summary = document.createElement('p');
    summary.textContent = `当前楼层 #${current} · 最后一层 #${context.chat.length - 1}`;
    const popup = new Popup(summary, POPUP_TYPE.INPUT, String(current), {
        label: '跳转楼层',
        inputLabel: '目标楼层',
        okButton: '跳转',
        cancelButton: '取消',
        customButtons: [
            { text: '回顶10层', result: POPUP_RESULT.CUSTOM1 },
            { text: '回顶20层', result: POPUP_RESULT.CUSTOM2 },
        ],
    });
    popup.mainInput.inputMode = 'numeric';
    floorPickerOpen = true;
    try {
        const input = await popup.show();
        if (popup.result === POPUP_RESULT.CUSTOM1) await goToFloor(session, Math.max(0, current - 10));
        else if (popup.result === POPUP_RESULT.CUSTOM2) await goToFloor(session, Math.max(0, current - 20));
        else if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
            const text = String(input).trim();
            await goToFloor(session, /^\d+$/.test(text) ? Number(text) : NaN);
        }
    } finally {
        floorPickerOpen = false;
    }
}

export function registerChatNavigationCommands(context = getHost()) {
    for (const [, name, helpString, action] of commands) {
        context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
            name, helpString,
            callback: async () => {
                try { await action(); }
                catch (error) { notify(error.message, 'warning'); }
                return '';
            },
        }));
    }
}
