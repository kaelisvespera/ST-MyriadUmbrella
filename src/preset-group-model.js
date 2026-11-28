const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor']);

function readField(record, key) {
    return record && typeof record === 'object' && Object.hasOwn(record, key) ? record[key] : undefined;
}

function validId(id) {
    return typeof id === 'string' && Boolean(id.trim()) && !RESERVED_IDS.has(id);
}

function entries(record) {
    return record && typeof record === 'object' && !Array.isArray(record) ? Object.entries(record) : [];
}

export function serializePresetGroupState(state) {
    const groups = [];
    const groupIds = new Set();
    const inputGroups = readField(state, 'groups');
    for (const group of Array.isArray(inputGroups) ? inputGroups : []) {
        const id = readField(group, 'id');
        if (!validId(id) || groupIds.has(id)) continue;
        const name = readField(group, 'name');
        groupIds.add(id);
        groups.push({
            id,
            name: typeof name === 'string' && name.trim() ? name.trim() : '未命名分组',
            collapsed: readField(group, 'collapsed') === true,
            enabled: readField(group, 'enabled') !== false,
        });
    }

    const inputAssignments = readField(state, 'assignments');
    const assignments = Object.fromEntries(entries(inputAssignments)
        .filter(([id, groupId]) => validId(id) && groupIds.has(groupId)));
    const inputFavorites = readField(state, 'favorites');
    const favorites = Array.isArray(inputFavorites) ? [...new Set(inputFavorites.filter(validId))] : [];
    return { groups, assignments, favorites, favoritesCollapsed: readField(state, 'favoritesCollapsed') === true };
}

export function readPresetGroupState(extensions) {
    const primary = readField(readField(extensions, 'st_tavern_tools'), 'presetGroups');
    if (Array.isArray(readField(primary, 'groups'))) return serializePresetGroupState(primary);

    const baiBai = readField(extensions, 'baibaiToolkit');
    const baiBaiGroups = readField(baiBai, 'presetPromptGroups');
    const baiBaiFavorites = readField(baiBai, 'presetPromptFavorites');
    const inputGroups = readField(baiBaiGroups, 'groups');
    const groups = Array.isArray(inputGroups) ? inputGroups.map((group, index) => {
        const order = Number(readField(group, 'order'));
        return { group, order: Number.isFinite(order) ? order : index };
    }).sort((a, b) => a.order - b.order).map(({ group }) => group) : [];
    const assignments = Object.fromEntries(entries(readField(baiBaiGroups, 'prompts'))
        .map(([id, metadata]) => [id, readField(metadata, 'groupId')]));
    return serializePresetGroupState({
        groups,
        assignments,
        favorites: Array.isArray(baiBaiFavorites) ? baiBaiFavorites : readField(baiBaiFavorites, 'promptIds'),
        favoritesCollapsed: readField(baiBaiFavorites, 'collapsed'),
    });
}

export function reorderPresetEntries(order, sourceId, targetId) {
    const from = order.findIndex(entry => entry?.identifier === sourceId);
    const to = order.findIndex(entry => entry?.identifier === targetId);
    if (from < 0 || to < 0 || from === to) return order;
    const next = order.slice();
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry);
    return next;
}
