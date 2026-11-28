import assert from 'node:assert/strict';
import test from 'node:test';
import { readPresetGroupState, reorderPresetEntries } from '../src/preset-group-model.js';
import { installPromptGroupGate, readPromptPreset, savePromptPreset } from '../src/preset-group-host.js';

const legacy = {
    baibaiToolkit: {
        presetPromptGroups: {
            version: 1,
            groups: [{ id: 'notes', name: 'Notes', order: 1, enabled: false }, { id: 'style', name: 'Style', order: 0 }],
            prompts: { a: { groupId: 'notes' }, b: { groupId: 'missing' } },
        },
        presetPromptFavorites: { version: 1, promptIds: ['a', 'a'], collapsed: true },
    },
};

test('reads stored BaiBai groups and favorites and keeps an explicit empty replacement', () => {
    const state = readPresetGroupState(legacy);
    assert.deepEqual(state, {
        groups: [
            { id: 'style', name: 'Style', collapsed: false, enabled: true },
            { id: 'notes', name: 'Notes', collapsed: false, enabled: false },
        ],
        assignments: { a: 'notes' },
        favorites: ['a'],
        favoritesCollapsed: true,
    });
    const cleared = readPresetGroupState({ ...legacy, st_tavern_tools: { presetGroups: { groups: [] } } });
    assert.deepEqual(cleared, { groups: [], assignments: {}, favorites: [], favoritesCollapsed: false });
    assert.equal(legacy.baibaiToolkit.presetPromptGroups.groups[0].id, 'notes');
});

test('saving group order keeps the saved and working prompt flags independent', async t => {
    const order = [{ identifier: 'a', enabled: true }, { identifier: 'live', enabled: true }, { identifier: 'b', enabled: false }];
    const preset = {
        extensions: structuredClone(legacy),
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'a', enabled: false }, { identifier: 'b', enabled: true }] }],
    };
    const writes = [];
    const presets = {
        getSelectedPresetName: () => 'Original',
        getCompletionPresetByName: name => name === 'Original' ? preset : undefined,
        async savePreset(...args) { writes.push(structuredClone(args)); },
    };
    const manager = {
        serviceSettings: { extensions: { own: 'preserved' } },
        activeCharacter: { id: 100001 },
        getPromptOrderForCharacter: () => order,
        getPromptCollection() { return this.getPromptOrderForCharacter(this.activeCharacter).filter(item => item.enabled); },
        isPromptDisabledForActiveCharacter(id) { return !order.find(item => item.identifier === id)?.enabled; },
    };
    const context = { mainApi: 'openai', chat: [], getPresetManager: () => presets };
    const previousHost = globalThis.SillyTavern;
    globalThis.SillyTavern = { getContext: () => context };
    t.after(() => { globalThis.SillyTavern = previousHost; });
    const first = order[0];
    const state = readPresetGroupState(preset.extensions);
    const stop = installPromptGroupGate(manager);
    t.after(stop);
    assert.deepEqual(manager.getPromptCollection().map(item => item.identifier), ['live']);
    assert.equal(first.enabled, true);
    assert.equal(manager.isPromptDisabledForActiveCharacter('a'), true);

    const session = readPromptPreset(manager);
    assert.equal(await savePromptPreset(session, state, reorderPresetEntries(order, 'b', 'a')), true);
    assert.equal(writes[0][0], 'Original');
    assert.deepEqual(writes[0][2], { skipUpdate: true });
    assert.deepEqual(writes[0][1].prompt_order[0].order, [{ identifier: 'b', enabled: true }, { identifier: 'a', enabled: false }]);
    assert.deepEqual(order.map(item => item.identifier), ['b', 'a', 'live']);
    assert.equal(order[1], first);
    assert.equal(first.enabled, true);
    assert.equal(manager.serviceSettings.extensions.own, 'preserved');
    stop();
    assert.deepEqual(manager.getPromptCollection().map(item => item.identifier), ['a', 'live']);
});
