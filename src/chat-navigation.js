import { getHost, notify } from './host.js';
import { observeVeridisRewrites } from './veridis-rewrite.js';

// Navigation behavior follows Junezz's 回顶/回底 v1.1.
const commands = [
    ['回顶', 'tt-chat-up', '对齐当前消息的开头，已经在开头时回到上一条。', goUp],
    ['回底', 'tt-chat-bottom', '滚动到聊天最后一条消息的底部。', goBottom],
    ['回楼层', 'tt-chat-floor', '跳到指定消息楼层，或从当前楼层回退 10 / 20 层。', openFloorPicker],
];
export const chatNavigationReplies = commands.map(([label, name]) => [label, '/' + name]);

let floorPickerOpen = false;

function chatSession() {
    const context = getHost();
    const container = document.getElementById('chat');
    const chatId = context.getCurrentChatId?.() ?? context.chatId;
    return container && Array.isArray(context.chat) ? { context, container, chatId } : null;
}

function readChat() {
    const session = chatSession();
    if (!session?.context.chat.length) throw new Error('当前聊天没有可导航的消息。');
    return session;
}

function isSameChat({ context, chatId }) {
    const current = getHost();
    return current.chat === context.chat && (current.getCurrentChatId?.() ?? current.chatId) === chatId
        && current.groupId === context.groupId && (context.groupId != null || current.characterId === context.characterId);
}

function viewportTop(container) {
    const padding = Number.parseFloat(getComputedStyle(container).paddingTop) || 0;
    return container.getBoundingClientRect().top + container.clientTop + padding;
}

function replyLeadIn(container) {
    return Math.min(160, Math.max(24, container.clientHeight * 0.18));
}

function messageSelector(id) {
    return `:scope > .mes[mesid="${id}"]`;
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

function scrollTo({ context, container }, top, behavior) {
    const options = { top, behavior: behavior ?? (isMobile(context) || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth') };
    if (typeof context.scrollChatSurfaceTo === 'function') context.scrollChatSurfaceTo(options);
    else container.scrollTo(options);
}

async function goToFloor(session, floor, { before = 0, behavior, isTarget = () => isSameChat(session) } = {}) {
    const { context, container } = session;
    if (!isTarget()) return;
    if (!Number.isSafeInteger(floor) || floor < 0 || floor >= context.chat.length) {
        throw new Error(`请输入 #0 到 #${context.chat.length - 1} 之间的整数楼层。`);
    }
    const selector = messageSelector(floor);
    let row = container.querySelector(selector);
    if (!row) {
        if (context.SlashCommandParser?.commands?.['chat-jump'] && typeof context.executeSlashCommandsWithOptions === 'function') {
            // TT handles both bounded projection and ordinary history pagination.
            await context.executeSlashCommandsWithOptions(`/chat-jump ${floor}`);
            if (!isTarget()) return;
            row = container.querySelector(selector);
            // Bounded projection centers the target. Keep the QR actions
            // aligned to the same message start as a jump to a mounted row.
            if (!row) return;
        } else {
            const first = Number(container.querySelector(':scope > .mes[mesid]')?.getAttribute('mesid'));
            if (Number.isSafeInteger(first) && floor < first) {
                const { showMoreMessages } = await import('/script.js');
                if (!isTarget()) return;
                await showMoreMessages(first - floor);
                if (!isTarget()) return;
                row = container.querySelector(selector);
            }
        }
    }
    if (!row) throw new Error(`当前无法找到 #${floor} 楼。`);
    scrollTo(session, container.scrollTop + row.getBoundingClientRect().top - viewportTop(container) - before, behavior);
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

const generatedReplyTypes = new Set(['normal', 'continue', 'regenerate', 'swipe', 'append', 'appendFinal']);

export function installReplyLocation() {
    const { eventSource, eventTypes } = getHost();
    const input = new AbortController();
    const tauri = Boolean(globalThis.__TAURITAVERN_HOST__);
    let pending = null;
    let scrollFrame = 0;
    let mediaTimer = 0;
    let sendAnchor = null;
    let sendFrame = 0;
    const hidden = () => document.visibilityState === 'hidden';
    const nativeAutoScroll = () => tauri && getHost().powerUserSettings?.auto_scroll_chat_to_bottom === true;
    const sentRows = new MutationObserver(onUserRowMounted);
    const layout = new ResizeObserver(locateWhenVisible);
    const content = new MutationObserver(locateWhenVisible);
    const veridis = observeVeridisRewrites({
        capture: details => details.generationId && pending?.cancelled && isSameChat(pending.session) ? null : chatSession(),
        isSameChat,
        onRewrite(session, reply) {
            if (pending?.reply?.message === reply.message && !pending.locating && current(pending)) {
                pending.reply = reply;
            } else {
                if (pending?.groupOpen) return;
                reset();
                pending = { session, reply, ended: true };
            }
            ready();
        },
    });

    function stopLayoutWait() {
        cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        clearTimeout(mediaTimer);
        mediaTimer = 0;
        layout.disconnect();
        content.disconnect();
    }

    function clearSendAnchor() {
        sendAnchor = null;
        cancelAnimationFrame(sendFrame);
        sendFrame = 0;
        sentRows.disconnect();
    }

    function captureSendAnchor(session) {
        if (!session || hidden() || !nativeAutoScroll()) return;
        const { context: { chat }, container } = session;
        const nextId = chat.length;
        if (sendAnchor?.nextId === nextId && isSameChat(sendAnchor.session)) return;
        clearSendAnchor();
        const previous = chat[nextId - 1];
        if (!previous || previous.is_user || previous.is_system) return;
        const row = container.querySelector(messageSelector(nextId - 1));
        if (!row || !container.clientHeight) return;
        sendAnchor = { session, nextId, previous, offset: row.getBoundingClientRect().top - viewportTop(container) };
    }

    function onUserMessageSent(id) {
        const anchor = sendAnchor;
        if (!anchor || Number(id) !== anchor.nextId || !isSameChat(anchor.session)) return;
        const message = anchor.session.context.chat[anchor.nextId];
        if (!message?.is_user) return;
        anchor.message = message;
        sentRows.observe(anchor.session.container, { childList: true });
        onUserRowMounted();
    }

    function onUserRowMounted() {
        const anchor = sendAnchor;
        if (!anchor?.message || sendFrame) return;
        const { session, nextId, previous, offset, message } = anchor;
        const { container, context: { chat } } = session;
        if (!container.querySelector(messageSelector(nextId))) return;
        sentRows.disconnect();
        // TT appends the user row and queues its first bottom scroll in the
        // same task. Adjust only that frame, before any assistant row arrives.
        sendFrame = requestAnimationFrame(() => {
            clearSendAnchor();
            if (hidden() || !nativeAutoScroll() || !isSameChat(session)
                || chat.length !== nextId + 1 || chat[nextId] !== message || chat[nextId - 1] !== previous) return;
            const row = container.querySelector(messageSelector(nextId - 1));
            if (!row) return;
            const bottom = Math.max(0, container.scrollHeight - container.clientHeight);
            if (Math.abs(container.scrollTop - bottom) > 1) return;
            const top = row.getBoundingClientRect().top - viewportTop(container);
            const leadIn = replyLeadIn(container);
            if (Math.abs(top) > leadIn || Math.abs(top - offset) < leadIn) return;
            const restored = Math.max(0, Math.min(bottom, container.scrollTop + top - offset));
            if (Math.abs(restored - container.scrollTop) > 1) scrollTo(session, restored, 'instant');
        });
    }

    function reset() {
        pending = null;
        stopLayoutWait();
    }

    async function waitForIdle() {
        const { waitForGenerationIdle } = await import('/script.js');
        await waitForGenerationIdle();
    }

    function start(type, options, dryRun) {
        const kind = type ?? 'normal';
        if (dryRun || !generatedReplyTypes.has(kind)) return;
        veridis.clear();
        if (!(pending?.groupOpen || pending?.cancelledUntilIdle) || !isSameChat(pending.session)) {
            reset();
            const session = chatSession();
            if (!session) return;
            pending = { session, groupOpen: false, ended: false, cancelled: false, queued: false };
        }
        if (kind === 'normal') captureSendAnchor(pending.session);
        else clearSendAnchor();
        const chat = pending.session.context.chat;
        const tail = chat.at(-1);
        pending.firstNewFloor = chat.length;
        // Regenerate can replace the last reply in place. Continue and swipe
        // can update it without replacing the message object.
        pending.replacingTail = kind !== 'normal' && tail
            ? { message: tail, text: tail.mes, finished: tail.gen_finished } : null;
        pending.signal = options?.signal;
    }

    function startGroup({ type, selected_group: groupId } = {}) {
        const kind = type === 'auto' ? 'normal' : type;
        const session = chatSession();
        if (session?.context.groupId == null || String(session.context.groupId) !== String(groupId)
            || !generatedReplyTypes.has(kind ?? 'normal')) return;
        if (!pending || !current(pending) || pending.ended || pending.reply) start(kind);
        if (pending) pending.groupOpen = true;
    }

    function cancel() {
        veridis.clear();
        clearSendAnchor();
        const run = pending;
        if (!run || run.cancelled) return;
        if (run.firstNewFloor == null) { reset(); return; }
        run.cancelled = true;
        stopLayoutWait();
        if (tauri && !run.groupOpen) {
            // Automatic continuation also emits STARTED within this same transaction.
            run.cancelledUntilIdle = true;
            void waitForIdle().catch(() => {}).finally(() => { run.cancelledUntilIdle = false; });
        }
    }

    function current(run) {
        return pending === run && !run.cancelled && !run.signal?.aborted && isSameChat(run.session);
    }

    function locateWhenVisible() {
        const run = pending;
        if (!run?.idle || !current(run) || hidden() || scrollFrame || mediaTimer || run.locating) return;
        // TT can restore viewport size and then reproject ChatSurface on resume.
        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = requestAnimationFrame(() => {
                scrollFrame = 0;
                if (!current(run) || hidden()) return;
                const { session, reply } = run;
                const { chat } = session.context;
                const { container } = session;
                const isTarget = () => current(run) && !hidden() && chat[reply.id] === reply.message
                    && (reply.isRewritten ? reply.isRewritten() : chat.findLastIndex(message => message?.is_user) < reply.id);
                if (!isTarget()) { reset(); return; }
                if (!container.clientHeight) { layout.observe(container); return; }
                const row = container.querySelector(messageSelector(reply.id));
                if (row && !row.getBoundingClientRect().height) { layout.observe(row); return; }
                if (reply.isRewritten && row && (row.style.visibility === 'hidden' || row.querySelector('.mes_text[aria-busy="true"]'))) {
                    content.observe(row, { attributes: true, attributeFilter: ['style', 'aria-busy'], childList: true, subtree: true });
                    return;
                }
                if (nativeAutoScroll() && reply.message.extra?.media?.length && run.mediaReady !== reply) {
                    // TT 2.4 publishes attached media and compensates scroll
                    // after a load-or-200ms race. Let it finish before aligning.
                    mediaTimer = setTimeout(() => {
                        mediaTimer = 0;
                        run.mediaReady = reply;
                        locateWhenVisible();
                    }, 200);
                    return;
                }

                layout.disconnect();
                content.disconnect();
                run.locating = true;
                const before = replyLeadIn(container);
                void goToFloor(session, reply.id, { before, behavior: 'instant', isTarget })
                    .catch(error => { if (isTarget()) console.warn('[千机伞] 定位新消息失败', error); })
                    .finally(() => {
                        if (pending !== run) return;
                        run.locating = false;
                        if (!hidden()) reset();
                    });
            });
        });
    }

    function ready() {
        const run = pending;
        if (!run || !current(run) || run.groupOpen || run.queued || !run.reply || (!tauri && !run.ended)) return;
        run.queued = true;
        // The host awaits CHARACTER_MESSAGE_RENDERED listeners. Wait for its
        // generation transaction outside that listener so it can finish.
        void (async () => {
            if (tauri) await waitForIdle();
            if (!current(run)) return;
            run.idle = true;
            locateWhenVisible();
        })().catch(error => { if (current(run)) console.warn('[千机伞] 等待生成完成失败', error); });
    }

    function render(id, type) {
        const run = pending;
        if (run?.firstNewFloor == null || !current(run) || id == null || !generatedReplyTypes.has(type ?? 'normal')) return;
        const floor = Number(id);
        const message = run.session.context.chat[floor];
        if (!Number.isSafeInteger(floor) || floor < 0 || !message || message.is_user || message.is_system) return;
        if (floor < run.firstNewFloor) {
            const tail = run.replacingTail;
            if (floor !== run.firstNewFloor - 1 || !tail
                || (message === tail.message && message.mes === tail.text && message.gen_finished === tail.finished)) return;
        }
        if (run.reply && floor < run.reply.id) return;
        if (run.reply?.message === message && run.reply.isRewritten?.()) return;
        const stream = tauri ? getHost().streamingProcessor : null;
        if (stream?.isStopped && stream.messageId === floor && stream.timeStarted === message.gen_started) return;
        run.reply = { id: floor, message };
        ready();
    }

    function end() {
        clearSendAnchor();
        if (!pending) return;
        pending.ended = true;
        ready();
    }

    function endGroup({ selected_group: groupId } = {}) {
        if (!pending?.groupOpen || String(pending.session.context.groupId) !== String(groupId)) return;
        pending.groupOpen = false;
        end();
    }

    function leaveReply() {
        veridis.clear();
        clearSendAnchor();
        reset();
    }

    function sendIntent() {
        leaveReply();
        if (tauri) captureSendAnchor(chatSession());
    }

    const listeners = [
        [eventTypes.GENERATION_STARTED, start],
        [eventTypes.CHARACTER_MESSAGE_RENDERED, render],
        [eventTypes.MESSAGE_SENT, onUserMessageSent],
        [eventTypes.GENERATION_ENDED, end],
        [eventTypes.GENERATION_STOPPED, cancel],
        [eventTypes.GROUP_WRAPPER_STARTED, startGroup],
        [eventTypes.GROUP_WRAPPER_FINISHED, endGroup],
        [eventTypes.CHAT_CHANGED, leaveReply],
    ].filter(([type]) => type);
    for (const [type, listener] of listeners) eventSource.on(type, listener);
    document.addEventListener('visibilitychange', () => {
        if (hidden()) { clearSendAnchor(); stopLayoutWait(); }
        else locateWhenVisible();
    }, { signal: input.signal });
    window.addEventListener('pageshow', locateWhenVisible, { signal: input.signal });
    const interrupt = event => {
        if (!hidden() && event.target.closest?.('#chat')) cancel();
    };
    document.addEventListener('click', event => {
        // Cancel a previous reply's queued jump before the host's async send.
        if (event.isTrusted && event.target.closest?.('#send_but,[data-tt-chat-input-editor-action="send"]')) sendIntent();
    }, { capture: true, signal: input.signal });
    for (const type of ['wheel', 'touchmove']) {
        document.addEventListener(type, interrupt, { capture: true, passive: true, signal: input.signal });
    }
    document.addEventListener('keydown', event => {
        if (event.isTrusted && event.target.id === 'send_textarea' && event.key === 'Enter'
            && !event.isComposing && event.keyCode !== 229 && !event.shiftKey && !event.ctrlKey && !event.altKey) {
            const context = getHost();
            const mode = context.powerUserSettings?.send_on_enter ?? 0;
            if (mode === 1 || (mode === 0 && !isMobile(context))) sendIntent();
        }
        if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(event.key)
            && !event.target.closest?.('button, input, textarea, select, [contenteditable]')) interrupt(event);
    }, { capture: true, signal: input.signal });

    return () => {
        leaveReply();
        veridis.destroy();
        input.abort();
        for (const [type, listener] of listeners) eventSource.removeListener(type, listener);
    };
}
