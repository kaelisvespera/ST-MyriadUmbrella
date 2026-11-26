import { NATIVE_DOCK_EVENT, REQUEST_BADGE } from './dock-compat.js';
import { findTarget, fingerprint, floatingTarget, isDockedTarget, targetKey } from './dock-targets.js';

const POSITION_KEY = 'st-tavern-tools-floating-positions';
const MIN_DRAG = 5;

function viewport() {
    const view = window.visualViewport;
    const left = view?.offsetLeft ?? 0;
    const top = view?.offsetTop ?? 0;
    return { left, top, right: left + (view?.width ?? innerWidth), bottom: top + (view?.height ?? innerHeight) };
}

function resolve(value) {
    try {
        if (value.elementId && document.querySelectorAll(`#${CSS.escape(value.elementId)}`).length !== 1) return null;
        return findTarget(value);
    } catch { return null; }
}

function visibleBox(element) {
    if (!element?.isConnected || isDockedTarget(element)) return null;
    const style = getComputedStyle(element);
    if (style.position !== 'fixed' || style.visibility !== 'visible') return null;
    const rect = element.getBoundingClientRect();
    return rect.width >= 14 && rect.height >= 14 && rect.width <= 140 && rect.height <= 140 ? { rect, style } : null;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function restore(element, saved, view) {
    const box = visibleBox(element);
    if (!box) return;
    const { rect, style } = box;
    const peek = clamp(Number(saved.peek) || 0, 0, rect.width - 14);
    const header = element.matches(REQUEST_BADGE) ? document.getElementById('top-settings-holder') : null;
    const minTop = Math.max(view.top, header?.getBoundingClientRect().height ?? 0);
    const x = clamp(saved.x, view.left - peek, view.right - rect.width + peek);
    const y = clamp(saved.y, minTop, view.bottom - rect.height);
    if (Math.abs(x - rect.left) < 1 && Math.abs(y - rect.top) < 1) return;
    // Offset coordinates remove the element's own translate without discarding it.
    const left = Math.round(x - rect.left + element.offsetLeft - (parseFloat(style.marginLeft) || 0));
    const top = Math.round(y - rect.top + element.offsetTop - (parseFloat(style.marginTop) || 0));
    element.style.setProperty('left', `${left}px`, element.style.getPropertyPriority('left'));
    element.style.setProperty('top', `${top}px`, element.style.getPropertyPriority('top'));
    element.style.setProperty('right', 'auto', element.style.getPropertyPriority('right'));
    element.style.setProperty('bottom', 'auto', element.style.getPropertyPriority('bottom'));
    return element.getAttribute('style');
}

export function installFloatingPositions() {
    const positions = new Map();
    try {
        for (const [key, saved] of Object.entries(JSON.parse(localStorage.getItem(POSITION_KEY) || '{}'))) {
            if (saved?.fingerprint && Number.isFinite(saved.x) && Number.isFinite(saved.y)) positions.set(key, saved);
        }
    } catch { /* local UI preferences may be unavailable */ }

    const nativeTouchStyle = document.createElement('style');
    nativeTouchStyle.textContent = `${REQUEST_BADGE}{touch-action:none!important}`;
    document.head.append(nativeTouchStyle);

    const targets = new Map();
    const watched = new WeakSet();
    const writtenStyles = new WeakMap();
    const pending = new Map();
    const listeners = new AbortController();
    const sizes = new ResizeObserver(refresh);
    let frame = 0;
    let gesture = null;

    function refresh() {
        if (frame || !positions.size) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            const view = viewport();
            for (const [key, saved] of positions) {
                const element = resolve(saved.fingerprint);
                const previous = targets.get(key);
                if (previous !== element) {
                    if (previous) sizes.unobserve(previous);
                    if (element) sizes.observe(element);
                }
                targets.set(key, element);
                const host = saved.fingerprint.elementId && document.getElementById(saved.fingerprint.elementId);
                if (host?.shadowRoot) watch(host.shadowRoot, { childList: true, subtree: true });
                for (let node = element || host; node && node !== document.body; node = node.parentElement || node.getRootNode().host) {
                    watch(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
                }
                if (element && gesture?.element !== element && !pending.has(element)) {
                    const written = restore(element, saved, view);
                    if (written !== undefined) writtenStyles.set(element, written);
                }
            }
        });
    }

    const observer = new MutationObserver(changes => {
        if (changes.some(({ type, attributeName, target }) => type === 'attributes'
            && (attributeName !== 'style' || writtenStyles.get(target) !== target.getAttribute('style')))
            || [...targets.values()].some(element => !element?.isConnected)) refresh();
    });
    function watch(node, options) {
        if (watched.has(node)) return;
        watched.add(node);
        observer.observe(node, options);
    }
    watch(document.body, { childList: true, subtree: true });
    // 构画 and 两三事 mount beside the body; a shadow stylesheet can size the ball later.
    watch(document.documentElement, { childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });

    function rememberDrop(element, previous) {
        if (pending.has(element)) cancelAnimationFrame(pending.get(element));
        // Native listeners finish their pointerup and any deferred edge snap first.
        pending.set(element, requestAnimationFrame(() => {
            pending.set(element, requestAnimationFrame(() => {
                pending.delete(element);
                const value = fingerprint(element);
                const box = visibleBox(element);
                const view = viewport();
                if (box && resolve(value) === element) {
                    const { rect } = box;
                    const changed = !previous || Math.hypot(rect.left - previous.rect.left, rect.top - previous.rect.top) >= 2;
                    const stable = !previous || Math.abs(previous.view.right - view.right) < 1 && Math.abs(previous.view.bottom - view.bottom) < 1
                        && Math.abs(previous.view.left - view.left) < 1 && Math.abs(previous.view.top - view.top) < 1;
                    if (changed && stable) {
                        const peek = clamp(Math.max(view.left - rect.left, rect.right - view.right), 0, rect.width - 14);
                        positions.set(targetKey(value), { fingerprint: value, x: Math.round(rect.left), y: Math.round(rect.top), peek });
                        try { localStorage.setItem(POSITION_KEY, JSON.stringify(Object.fromEntries(positions))); } catch { /* keep the last position in memory */ }
                    }
                }
                refresh();
            }));
        }));
    }

    function onDown(event) {
        if (!event.isTrusted || event[NATIVE_DOCK_EVENT] || event.button !== 0 || !event.isPrimary || gesture) return;
        const element = floatingTarget(event);
        const box = visibleBox(element);
        if (!box || pending.has(element) || resolve(fingerprint(element)) !== element) return;
        gesture = { element, rect: box.rect, view: viewport(), pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    }

    function onMove(event) {
        if (event.isTrusted && gesture?.pointerId === event.pointerId && !gesture.moved) {
            gesture.moved = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > MIN_DRAG;
        }
    }

    function onEnd(event) {
        if (!event.isTrusted || gesture?.pointerId !== event.pointerId) return;
        const previous = gesture;
        gesture = null;
        if (event.type === 'pointerup' && (previous.moved || Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > MIN_DRAG)) {
            rememberDrop(previous.element, previous);
        } else refresh();
    }

    const options = { capture: true, passive: true, signal: listeners.signal };
    window.addEventListener('pointerdown', onDown, options);
    window.addEventListener('pointermove', onMove, options);
    window.addEventListener('pointerup', onEnd, options);
    window.addEventListener('pointercancel', onEnd, options);
    window.addEventListener('blur', () => { gesture = null; refresh(); }, { signal: listeners.signal });
    window.addEventListener('resize', refresh, options);
    window.visualViewport?.addEventListener('resize', refresh, options);
    window.visualViewport?.addEventListener('scroll', refresh, options);
    refresh();

    return {
        rememberDrop,
        destroy() {
            listeners.abort();
            observer.disconnect();
            sizes.disconnect();
            cancelAnimationFrame(frame);
            for (const job of pending.values()) cancelAnimationFrame(job);
            nativeTouchStyle.remove();
        },
    };
}
