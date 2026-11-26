import { getHost } from './host.js';

const DETAILS_MARKER = 'data-collapse-btn';
const CODE_MARKER = 'data-frontend-collapse-btn';
const OWNED = 'data-myriad-details-collapse';
export const COLLAPSE_CONTROL = `[${DETAILS_MARKER}], [${CODE_MARKER}]`;
const TARGETS = 'details, .TH-render, iframe';
const STYLE = `
    [${OWNED}] { display: flex; align-items: center; justify-content: center; width: 100%;
        min-height: 32px; margin-top: 8px; padding: 4px 0; border: 0; border-top: 1px dashed var(--SmartThemeBorderColor, #555);
        border-radius: 0; background: transparent; color: var(--SmartThemeQuoteColor, #bbb); font: inherit;
        font-size: .85em; cursor: pointer; opacity: .72; -webkit-user-select: none; user-select: none; }
    [${OWNED}]:hover, [${OWNED}]:focus-visible { opacity: 1; }
`;

const mounted = new Map();
let startManaged;

function chatSurface() {
    const api = globalThis.__TAURITAVERN__?.api?.chatSurface;
    return api?.isManagedOwnershipRequired?.() ? api : null;
}

// ChatSurface requires registration before its first projection. The toolbox
// can enable/disable this participant's decorations without re-registering it.
export function registerDetailsCollapse() {
    const api = chatSurface();
    if (!api) return;
    api.registerParticipant({
        id: 'myriad-umbrella/details-collapse',
        protocolVersion: api.protocolVersion,
        didMount({ element }) {
            mounted.set(element, startManaged?.(element));
            return () => {
                mounted.get(element)?.();
                mounted.delete(element);
            };
        },
    });
}

function createStyle(doc) {
    const style = doc.createElement('style');
    style.textContent = STYLE;
    doc.head?.append(style);
    return style;
}

function centerIfOutside(scroller, rect, top, bottom, scroll) {
    if (rect.top >= top && rect.bottom <= bottom) return rect;
    const current = scroller.scrollTop;
    const offset = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
        current + (rect.top + rect.bottom - top - bottom) / 2));
    if (Math.abs(offset - current) < 1) return rect;
    scroll({ top: offset, behavior: 'instant' });
    return { top: rect.top + current - offset, bottom: rect.bottom + current - offset };
}

function reveal(control, chat) {
    let rect = control.getBoundingClientRect();
    while (control && chat.isConnected) {
        const doc = control.ownerDocument;
        const view = doc.defaultView;
        if (!view) return;
        const pageScroller = doc.scrollingElement;
        for (let parent = control.parentElement; parent && parent !== pageScroller; parent = parent.parentElement) {
            const hostChat = parent === chat;
            if (!hostChat && (parent.scrollHeight <= parent.clientHeight
                || !/^(auto|scroll|overlay)$/.test(view.getComputedStyle(parent).overflowY))) continue;
            const top = parent.getBoundingClientRect().top + parent.clientTop;
            const scroll = hostChat ? getHost().scrollChatSurfaceTo ?? parent.scrollTo.bind(parent) : parent.scrollTo.bind(parent);
            rect = centerIfOutside(parent, rect, top, top + parent.clientHeight, scroll);
            if (hostChat) return;
        }
        if (doc === chat.ownerDocument || !pageScroller) return;
        const viewportTop = view.visualViewport?.offsetTop ?? 0;
        const viewportHeight = view.visualViewport?.height ?? doc.documentElement.clientHeight;
        rect = centerIfOutside(pageScroller, rect, viewportTop, viewportTop + viewportHeight, view.scrollTo.bind(view));
        control = view.frameElement;
        if (!control) return;
        const frame = control.getBoundingClientRect();
        const scale = control.offsetHeight ? frame.height / control.offsetHeight : 1;
        const frameTop = frame.top + control.clientTop * scale;
        rect = { top: frameTop + rect.top * scale, bottom: frameTop + rect.bottom * scale };
    }
}

function observeCollapse(root, chat, frameDocument = null) {
    const frameStyle = frameDocument ? createStyle(frameDocument) : null;
    const frames = new Map();

    function watchFrame(frame) {
        let binding = frames.get(frame);
        if (!binding) {
            const load = () => watchFrame(frame);
            binding = { load, document: null, dispose: null };
            frames.set(frame, binding);
            frame.addEventListener('load', load);
        }
        // contentDocument is only readable for same-origin, non-opaque frames.
        const doc = frame.hasAttribute('sandbox') && !frame.sandbox.contains('allow-same-origin') ? null : frame.contentDocument;
        if (doc === binding.document) return;
        binding.dispose?.();
        binding.document = doc;
        binding.dispose = doc ? observeCollapse(doc, chat, doc) : null;
    }

    function stopFrame(frame, binding) {
        binding.dispose?.();
        frame.removeEventListener('load', binding.load);
        frames.delete(frame);
    }

    function sync(target) {
        if (!root.contains(target)) return;
        if (target.tagName === 'IFRAME') {
            watchFrame(target);
            return;
        }
        const native = target.tagName === 'DETAILS';
        const marker = native ? DETAILS_MARKER : CODE_MARKER;
        const top = target.querySelector(native ? ':scope > summary' : ':scope > .TH-collapse-code-block-button');
        const pre = native ? null : target.querySelector(':scope > pre');
        const expanded = native ? target.open : top?.textContent.trim() === '隐藏前端代码块'
            && pre && !top.classList.contains('hidden!') && !pre.classList.contains('hidden!');
        const controls = Array.from(target.querySelectorAll(`:scope > [${marker}]`));
        const owned = controls.filter(control => control.hasAttribute(OWNED));
        if (!expanded || controls.some(control => !control.hasAttribute(OWNED))) {
            owned.forEach(control => control.remove());
            return;
        }
        if (owned.length) return;
        const button = target.ownerDocument.createElement('button');
        button.type = 'button';
        button.setAttribute(marker, '');
        button.setAttribute(OWNED, '');
        button.setAttribute('aria-label', native ? '收起折叠区块' : '收起前端代码块');
        button.textContent = '▲ 收起';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (!root.contains(button)) return;
            const restoreFocus = event.detail === 0 && button.ownerDocument.activeElement === button;
            if (native) target.open = false;
            else top.click();
            sync(target);
            if (!top) return;
            if (restoreFocus) top.focus({ preventScroll: true });
            // Move to the header before the collapsed block's replacement content can paint.
            if (root.contains(top)) reveal(top, chat);
        });
        if (native) target.append(button);
        else pre.after(button);
    }

    function collect(node, descend, pending) {
        const element = node.nodeType === 1 ? node : node.parentElement;
        if (element) {
            const details = element.closest('details');
            const code = element.closest('.TH-render');
            if (details) pending.add(details);
            if (code) pending.add(code);
            if (element.tagName === 'IFRAME') pending.add(element);
        }
        if (descend) node.querySelectorAll?.(TARGETS).forEach(target => pending.add(target));
    }

    const observer = new MutationObserver(records => {
        if (frameStyle && frameDocument.head && frameStyle.parentNode !== frameDocument.head) frameDocument.head.append(frameStyle);
        const pending = new Set();
        for (const record of records) {
            collect(record.target, false, pending);
            for (const node of record.addedNodes) collect(node, true, pending);
        }
        pending.forEach(sync);
        for (const [frame, binding] of frames) {
            if (!root.contains(frame)) stopFrame(frame, binding);
        }
    });
    observer.observe(root, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['open', 'class', 'sandbox'],
    });
    const initial = new Set();
    collect(root, true, initial);
    initial.forEach(sync);
    return () => {
        observer.disconnect();
        for (const [frame, binding] of frames) stopFrame(frame, binding);
        root.querySelectorAll(`[${OWNED}]`).forEach(button => button.remove());
        frameStyle?.remove();
    };
}

export function installDetailsCollapse() {
    const style = createStyle(document);
    const { eventSource, eventTypes } = getHost();
    let chat;
    let stop;
    const attach = () => {
        const next = document.getElementById('chat');
        if (next === chat) return;
        stop?.();
        chat = next;
        stop = chat ? observeCollapse(chat, chat) : null;
    };
    const managed = chatSurface();
    if (managed) {
        startManaged = element => {
            const container = element.closest('#chat');
            return container ? observeCollapse(element, container) : undefined;
        };
        for (const element of mounted.keys()) mounted.set(element, startManaged(element));
    } else {
        attach();
        eventSource.on(eventTypes.CHAT_CHANGED, attach);
    }
    return () => {
        style.remove();
        if (managed) {
            startManaged = null;
            for (const [element, dispose] of mounted) {
                dispose?.();
                mounted.set(element, undefined);
            }
        } else {
            eventSource.removeListener(eventTypes.CHAT_CHANGED, attach);
            stop?.();
        }
    };
}
