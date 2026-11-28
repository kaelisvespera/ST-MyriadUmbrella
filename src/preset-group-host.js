import { getHost } from './host.js';
import { readPresetGroupState, serializePresetGroupState } from './preset-group-model.js';

export async function loadPromptManager(context = getHost()) {
    return context.openai?.promptManager ?? (await import('/scripts/openai.js')).promptManager;
}

export function readPromptPreset(manager, context = getHost()) {
    if (!manager || context.mainApi !== 'openai') return null;
    const presets = context.getPresetManager?.('openai');
    const name = presets?.getSelectedPresetName?.();
    if (!name) return null;
    const preset = presets.getCompletionPresetByName?.(name);
    const order = manager.getPromptOrderForCharacter?.(manager.activeCharacter);
    if (!preset || !Array.isArray(order)) return null;
    return { manager, presets, name, preset, order };
}

function setGroupState(target, state) {
    target.extensions = {
        ...target.extensions,
        st_tavern_tools: { ...target.extensions?.st_tavern_tools, presetGroups: state },
    };
}

function promptIds(order) {
    return order.map(entry => entry?.identifier);
}

function sameOrder(order, ids) {
    return order.length === ids.length && order.every((entry, index) => entry?.identifier === ids[index]);
}

function savedOrderFor(preset, character) {
    if (!Array.isArray(preset.prompt_order)) return null;
    return preset.prompt_order.find(entry => String(entry?.character_id) === String(character?.id))?.order;
}

function orderSavedEntries(saved, newIds) {
    const entries = new Map(saved.map(entry => [entry?.identifier, entry]));
    const sorted = newIds.filter(id => entries.has(id)).map(id => entries.get(id));
    const reorderedIds = new Set(sorted.map(entry => entry.identifier));
    let index = 0;
    // Live-only entries stay unsaved. Saved-only entries keep their slots and flags.
    return saved.map(entry => reorderedIds.has(entry?.identifier) ? sorted[index++] : entry);
}

export async function savePromptPreset(session, state, nextOrder = null) {
    const context = getHost();
    const { manager, presets, name, preset, order } = session;
    const selected = readPromptPreset(manager, context);
    if (selected?.preset !== preset || selected.name !== name || selected.order !== order) {
        throw new Error('当前预设已变化，请重试。');
    }

    const groupState = serializePresetGroupState(state);
    const pending = structuredClone(preset);
    const originalIds = promptIds(order);
    const newIds = nextOrder && promptIds(nextOrder);
    const character = manager.activeCharacter;
    const chatId = context.getCurrentChatId?.() ?? context.chatId;
    setGroupState(pending, groupState);
    if (newIds) {
        const identifiers = new Set(newIds);
        if (newIds.length !== originalIds.length || identifiers.size !== originalIds.length
            || !originalIds.every(id => identifiers.has(id))) {
            throw new Error('预设条目已变化，请重试。');
        }
        const saved = savedOrderFor(pending, character);
        if (!Array.isArray(saved)) throw new Error('请先使用酒馆保存当前预设，再调整分组顺序。');
        saved.splice(0, saved.length, ...orderSavedEntries(saved, newIds));
    }

    // Saving the stored preset avoids committing the working prompt toggles or reselecting it.
    await presets.savePreset(name, pending, { skipUpdate: true });

    if (presets.getCompletionPresetByName(name) !== preset) return false;
    const activeContext = getHost();
    const active = readPromptPreset(manager, activeContext);
    const sameSelection = active?.name === name && active.preset === preset && active.order === order;
    const sameChat = activeContext.chat === context.chat
        && (activeContext.getCurrentChatId?.() ?? activeContext.chatId) === chatId
        && activeContext.groupId === context.groupId && activeContext.characterId === context.characterId;
    const applyOrder = newIds && sameSelection && sameChat && sameOrder(order, originalIds);

    setGroupState(preset, groupState);
    if (newIds) {
        const saved = savedOrderFor(preset, character);
        if (Array.isArray(saved) && saved !== order) {
            saved.splice(0, saved.length, ...orderSavedEntries(saved, newIds));
        }
    }
    if (!sameSelection) return false;
    setGroupState(manager.serviceSettings ?? activeContext.chatCompletionSettings, structuredClone(groupState));
    if (applyOrder) {
        const liveEntries = new Map(order.map(entry => [entry.identifier, entry]));
        order.splice(0, order.length, ...newIds.map(id => liveEntries.get(id)));
    }
    return !newIds || Boolean(applyOrder);
}

function replaceMethod(target, key, replacement) {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    target[key] = replacement;
    return () => {
        if (target[key] !== replacement) return;
        if (previous) Object.defineProperty(target, key, previous);
        else delete target[key];
    };
}

export function installPromptGroupGate(manager) {
    const collect = manager.getPromptCollection;
    const originalIsDisabled = manager.isPromptDisabledForActiveCharacter;
    if (typeof collect !== 'function') return () => {};
    let active = true;
    let cachedExtensions;
    let pausedIds = new Set();
    function paused() {
        if (!active) return null;
        const extensions = readPromptPreset(manager)?.preset.extensions;
        if (extensions !== cachedExtensions) {
            cachedExtensions = extensions;
            const state = readPresetGroupState(extensions);
            const groups = new Set(state.groups.filter(group => !group.enabled).map(group => group.id));
            pausedIds = new Set(Object.entries(state.assignments).filter(([, id]) => groups.has(id)).map(([promptId]) => promptId));
        }
        return pausedIds;
    }

    const restoreCollection = replaceMethod(manager, 'getPromptCollection', function (...args) {
        const hidden = paused();
        if (!hidden?.size) return collect.apply(this, args);
        const getOrder = this.getPromptOrderForCharacter;
        // TT reads the order synchronously here, before prompt injection and token accounting.
        const restoreOrder = replaceMethod(this, 'getPromptOrderForCharacter', function (character) {
            return getOrder.call(this, character).map(entry =>
                hidden.has(entry?.identifier) && entry.enabled !== false ? { ...entry, enabled: false } : entry);
        });
        try {
            return collect.apply(this, args);
        } finally {
            restoreOrder();
        }
    });
    const restoreIsDisabled = typeof originalIsDisabled === 'function'
        ? replaceMethod(manager, 'isPromptDisabledForActiveCharacter', function (identifier, ...args) {
            // TT also merges system markers after collection, then checks this predicate.
            return paused()?.has(identifier) === true || originalIsDisabled.call(this, identifier, ...args);
        })
        : () => {};
    return () => {
        active = false;
        restoreIsDisabled();
        restoreCollection();
    };
}
