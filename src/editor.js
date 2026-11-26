import { getHost, notify, saveEditedMessage } from './host.js';
import { locateDivider, locateText, replaceSpan } from './text-locate.js';
import { editDialog } from './ui.js';

const BLOCKS = 'p,li,summary,pre,blockquote,h1,h2,h3,h4,h5,h6,td,th,div';
const EDIT_CONTROLS = 'button,a,input,textarea,select,[contenteditable]:not([contenteditable="false"])';

function targetElement(event) {
    return event.target instanceof Element ? event.target : event.target?.parentElement;
}

function caretRange(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    const caret = document.caretPositionFromPoint?.(x, y);
    if (!caret) return null;
    const range = document.createRange();
    range.setStart(caret.offsetNode, caret.offset);
    range.collapse(true);
    return range;
}

function selectedRange() {
    const selection = window.getSelection();
    return selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
}

function clickedText(event, target, container, selection) {
    if (selection && container.contains(selection.commonAncestorContainer)
        && Array.from(selection.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom)) {
        return { range: selection, text: selection.toString(), wholeBlock: false };
    }
    const caret = caretRange(event.clientX, event.clientY);
    const node = caret?.startContainer;
    const caretElement = node instanceof Element ? node : node?.parentElement;
    const block = (node && container.contains(node) ? caretElement : target)?.closest(BLOCKS);
    if (block && block !== container && container.contains(block)) {
        const range = document.createRange();
        range.selectNodeContents(block);
        const clone = block.cloneNode(true);
        clone.querySelectorAll('details,ul,ol').forEach(child => child.remove());
        const text = clone.textContent;
        if (text.trim()) return { range, text, wholeBlock: true };
    }
    if (node?.nodeType === Node.TEXT_NODE && container.contains(node)) {
        const raw = node.textContent;
        caret.setStart(node, raw.lastIndexOf('\n', caret.startOffset - 1) + 1);
        const lineBreak = raw.indexOf('\n', caret.endOffset);
        caret.setEnd(node, lineBreak < 0 ? raw.length : lineBreak);
        return { range: caret, text: caret.toString(), wholeBlock: true };
    }
    if (target !== container) {
        const range = document.createRange();
        range.selectNodeContents(target);
        return { range, text: range.toString(), wholeBlock: true };
    }
    return null;
}

function locateEdit(event, target, container, selection, context, message, index, raw) {
    if (target.tagName === 'HR') {
        const dividers = Array.from(container.querySelectorAll('hr'));
        return locateDivider(raw, dividers.indexOf(target), dividers.length);
    }
    const picked = clickedText(event, target, container, selection);
    if (!picked?.text.trim()) return null;
    const prefix = document.createRange();
    prefix.selectNodeContents(container);
    prefix.setEnd(picked.range.startContainer, picked.range.startOffset);
    return locateText(raw, picked.text, {
        visibleText: container.textContent,
        beforeText: prefix.toString(),
        wholeBlock: picked.wholeBlock,
        renderText: marked => {
            const template = document.createElement('template');
            template.innerHTML = context.messageFormatting(marked, message.name, message.is_system, message.is_user, index);
            return template.content.textContent;
        },
    });
}

function detailsState(container) {
    return Array.from(container.querySelectorAll('details'), element => ({
        open: element.open,
        summary: element.querySelector('summary')?.textContent.trim() ?? '',
    }));
}

function restoreDetails(row, states) {
    const details = Array.from(row.querySelectorAll('.mes_text details'));
    const restored = new Set();
    for (const [index, state] of states.entries()) {
        let element = details[index];
        const sameSummary = candidate => (candidate.querySelector('summary')?.textContent.trim() ?? '') === state.summary;
        if (!element || restored.has(element) || !sameSummary(element)) {
            element = details.find(candidate => !restored.has(candidate) && sameSummary(candidate))
                ?? (element && !restored.has(element) ? element : null);
        }
        if (!element) continue;
        restored.add(element);
        element.open = state.open;
    }
}

function watchRenderedMessage(chat, row, currentRow, restore) {
    let saved = false;
    let timeout;
    let deadline;
    let resolve;
    const finished = new Promise(done => { resolve = done; });
    const observer = new MutationObserver(records => {
        const updated = currentRow();
        if (!records.some(record => row.contains(record.target) || updated?.contains(record.target)
            || (updated && Array.from(record.addedNodes).some(node => node.contains(updated))))) return;
        restore();
        if (saved) {
            clearTimeout(timeout);
            timeout = setTimeout(stop, 40);
        }
    });
    observer.observe(chat, { childList: true, subtree: true });
    function stop() {
        observer.disconnect();
        clearTimeout(timeout);
        clearTimeout(deadline);
        resolve();
    }
    return {
        async settle() {
            saved = true;
            restore();
            timeout = setTimeout(stop, 40);
            deadline = setTimeout(stop, 250);
            await finished;
        },
        stop,
    };
}

export function installEditor() {
    const chat = document.getElementById('chat');
    if (!chat) return () => {};
    const style = document.createElement('style');
    style.id = 'st-tools-editor-style';
    style.textContent = `
        #chat .mes_text { touch-action: manipulation; }
        #chat .mes_text hr { position: relative; cursor: pointer; overflow: visible; }
        #chat .mes_text hr::after { content: ""; position: absolute; inset: -15px 0; }
        #st-tools-editor .popup-input { min-height: 50px; max-height: 155px; field-sizing: content; resize: none; overflow-y: auto; }
    `;
    document.head.append(style);

    const { eventSource, eventTypes } = getHost();
    let revision = 0;
    const onChatChange = () => { revision++; };
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChange);

    let editing = false;
    let disposed = false;
    let activeCleanup;
    let gesture = null;
    let taps = [];
    let lastTouchAt = -Infinity;
    let mouseSelection = null;

    const edit = async (event, selection, fromTouch = false) => {
        const target = targetElement(event);
        const container = target?.closest('.mes_text');
        const row = container?.closest('.mes[mesid]');
        if (!row || editing || disposed || target.closest(EDIT_CONTROLS)) return;
        const index = Number(row.getAttribute('mesid'));
        if (!Number.isInteger(index) || index < 0) return;
        const context = getHost();
        const message = context.chat[index];
        if (!message || typeof message.mes !== 'string') return;
        const raw = message.mes;
        const swipe = message.swipe_id;
        const originalChatId = context.getCurrentChatId?.();
        const originalRevision = revision;
        const isCurrent = () => {
            if (disposed || revision !== originalRevision) return false;
            const current = getHost();
            return current.chat === context.chat && current.chat[index] === message
                && current.characterId === context.characterId && current.groupId === context.groupId
                && current.getCurrentChatId?.() === originalChatId && message.swipe_id === swipe;
        };

        let span;
        try {
            span = locateEdit(event, target, container, selection, context, message, index, raw);
        } catch (error) {
            console.error('[千机伞] 定位正文失败', error);
        }
        if (!span) {
            notify('无法准确定位这段原文，请选中更完整的文字后再试。', 'warning');
            return;
        }

        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        window.getSelection()?.removeAllRanges();
        editing = true;
        const offset = row.getBoundingClientRect().top - chat.getBoundingClientRect().top;
        const details = detailsState(container);
        let userScrolled = false;
        let render;
        let dialog;
        const markScroll = () => { userScrolled = true; };
        const scrollEvents = ['wheel', 'touchmove'];
        const currentRow = () => chat.querySelector('.mes[mesid="' + index + '"]');
        const restore = () => {
            const updated = isCurrent() && currentRow();
            if (updated) restoreDetails(updated, details);
        };
        const cleanup = () => {
            render?.stop();
            for (const name of scrollEvents) chat.removeEventListener(name, markScroll);
        };
        activeCleanup = () => { cleanup(); void dialog?.dismiss(); };
        for (const name of scrollEvents) chat.addEventListener(name, markScroll, { passive: true });

        try {
            dialog = editDialog(context, span.text);
            const text = await dialog.result;
            dialog = null;
            if (disposed || typeof text !== 'string' || text === span.text) return;
            if (!isCurrent() || message.mes !== raw) {
                throw new Error('编辑期间聊天、消息或备选回复已变化，本次未保存。');
            }
            render = watchRenderedMessage(chat, row, currentRow, restore);
            const saved = await saveEditedMessage(context, index, message, replaceSpan(raw, span, text), isCurrent);
            if (!saved || !isCurrent()) return;
            await render.settle();
        } catch (error) {
            console.error('[千机伞] 编辑失败', error);
            if (!disposed) notify(error.message || '文字修改未能完成，请重新打开编辑。', 'error');
        } finally {
            if (fromTouch && !disposed && isCurrent()) {
                // The native keyboard may still be settling after the popup closes.
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            const updated = isCurrent() && currentRow();
            if (updated && !userScrolled) {
                chat.scrollTop += updated.getBoundingClientRect().top - chat.getBoundingClientRect().top - offset;
            }
            cleanup();
            activeCleanup = null;
            editing = false;
            taps = [];
            mouseSelection = null;
        }
    };

    const isTouchMouse = event => {
        const touchOrigin = event.sourceCapabilities?.firesTouchEvents;
        return event.pointerType === 'touch' || touchOrigin === true
            || (event.pointerType !== 'mouse' && touchOrigin !== false && performance.now() - lastTouchAt < 800);
    };
    const mouseDown = event => {
        if (event.detail === 1 && !isTouchMouse(event)) mouseSelection = selectedRange();
    };
    const doubleClick = event => {
        const selection = mouseSelection;
        mouseSelection = null;
        if (!isTouchMouse(event)) void edit(event, selection);
    };
    const cancel = () => { gesture = null; taps = []; mouseSelection = null; };
    const down = event => {
        if (event.pointerType !== 'touch') return;
        lastTouchAt = performance.now();
        const target = targetElement(event);
        const container = target?.closest('.mes_text');
        if (editing || !container || event.isPrimary === false || target.closest(EDIT_CONTROLS)) {
            cancel();
            return;
        }
        gesture = {
            id: event.pointerId,
            x: event.clientX, y: event.clientY,
            time: lastTouchAt, scrollTop: chat.scrollTop,
            container, selection: selectedRange(),
        };
    };
    const move = event => {
        if (gesture?.id === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 15) cancel();
    };
    const up = event => {
        if (event.pointerType === 'touch') lastTouchAt = performance.now();
        if (!gesture || gesture.id !== event.pointerId) return;
        const { container, time, x, y, selection, scrollTop } = gesture;
        gesture = null;
        if (lastTouchAt - time > 500 || Math.abs(chat.scrollTop - scrollTop) > 2
            || targetElement(event)?.closest('.mes_text') !== container
            || Math.hypot(x - event.clientX, y - event.clientY) > 15) {
            cancel();
            return;
        }
        const last = taps.at(-1);
        if (last && (lastTouchAt - last.time > 450 || last.container !== container
            || Math.abs(last.scrollTop - scrollTop) > 2
            || Math.hypot(last.x - event.clientX, last.y - event.clientY) > 35)) taps = [];
        taps.push({ time: lastTouchAt, x: event.clientX, y: event.clientY, container, selection, scrollTop });
        if (taps.length === 3) {
            const chosen = taps[0].selection;
            taps = [];
            void edit(event, chosen, true);
        }
    };

    const bindings = { mousedown: mouseDown, dblclick: doubleClick, pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel };
    for (const [name, handler] of Object.entries(bindings)) chat.addEventListener(name, handler);
    return () => {
        disposed = true;
        activeCleanup?.();
        for (const [name, handler] of Object.entries(bindings)) chat.removeEventListener(name, handler);
        eventSource.removeListener(eventTypes.CHAT_CHANGED, onChatChange);
        style.remove();
        cancel();
    };
}
