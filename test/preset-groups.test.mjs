import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateLegacyPresetGroups } from '../src/baibai-preset/preset/legacy.js';

test('migrates the latest 0.1.18 grouping and favorites without changing other preset extensions', () => {
    const previous = {
        st_tavern_tools: {
            custom: { retained: true },
            presetGroups: {
                groups: [
                    { id: 'notes', name: 'Notes', collapsed: true, enabled: false },
                    { id: 'style', name: 'Style', collapsed: false, enabled: true },
                    { id: 'empty', name: 'Empty' },
                ],
                assignments: { a: 'notes', b: 'style' },
                favorites: ['b', 'a'],
                favoritesCollapsed: true,
            },
        },
        baibaiToolkit: {
            presetPromptGroups: { version: 1, groups: [{ id: 'former' }] },
            presetPromptFavorites: { version: 1, promptIds: ['previous'] },
            extra: true,
        },
        regex_scripts: [{ id: 'untouched' }],
    };
    const snapshot = structuredClone(previous);
    const migrated = migrateLegacyPresetGroups(previous);
    assert.deepEqual(migrated, {
        st_tavern_tools: { custom: { retained: true } },
        baibaiToolkit: {
            presetPromptGroups: {
                version: 1,
                groups: [
                    { id: 'notes', name: 'Notes', order: 0, collapsed: true, enabled: false },
                    { id: 'style', name: 'Style', order: 1, collapsed: false, enabled: true },
                    { id: 'empty', name: 'Empty', order: 2, collapsed: false, enabled: true },
                ],
                prompts: { a: { groupId: 'notes' }, b: { groupId: 'style' } },
            },
            presetPromptFavorites: { version: 1, promptIds: ['b', 'a'], collapsed: true },
            extra: true,
        },
        regex_scripts: [{ id: 'untouched' }],
    });
    assert.deepEqual(previous, snapshot);
    assert.equal(migrateLegacyPresetGroups(migrated), migrated);
});

test('an explicit empty 0.1.18 grouping clears previous BaiBai metadata without reviving it on re-read', () => {
    const previous = {
        st_tavern_tools: { presetGroups: { groups: [], assignments: {}, favorites: [], favoritesCollapsed: false } },
        baibaiToolkit: {
            presetPromptGroups: { groups: [{ id: 'earlier' }] },
            presetPromptFavorites: ['old'],
        },
    };
    const migrated = migrateLegacyPresetGroups(previous);
    assert.deepEqual(migrated.baibaiToolkit, {
        presetPromptGroups: { version: 1, groups: [], prompts: {} },
        presetPromptFavorites: { version: 1, promptIds: [], collapsed: false },
    });
    assert.equal(Object.hasOwn(migrated.st_tavern_tools, 'presetGroups'), false);
    assert.equal(migrateLegacyPresetGroups(migrated), migrated);
});

test('invalid entries do not produce prototype keys, duplicates, or dangling assignments', () => {
    const migrated = migrateLegacyPresetGroups({
        st_tavern_tools: {
            presetGroups: {
                groups: [{ id: 'a', name: 'First' }, { id: 'a', name: 'Duplicate' }, { id: 'constructor' }],
                assignments: JSON.parse('{"__proto__":"a","constructor":"a","dangling":"absent","kept":"a"}'),
                favorites: ['kept', 'kept', 'constructor', ''],
            },
        },
    });
    const { presetPromptGroups, presetPromptFavorites } = migrated.baibaiToolkit;
    assert.deepEqual(presetPromptGroups.groups, [{ id: 'a', name: 'First', order: 0, collapsed: false, enabled: true }]);
    assert.deepEqual(presetPromptGroups.prompts, { kept: { groupId: 'a' } });
    assert.deepEqual(presetPromptFavorites.promptIds, ['kept']);
});
