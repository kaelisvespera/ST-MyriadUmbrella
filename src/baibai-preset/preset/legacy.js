const reservedIds = new Set(['__proto__', 'prototype', 'constructor']);

function isIdentifier(id) {
    return typeof id === 'string' && id.trim() !== '' && !reservedIds.has(id);
}

export function migrateLegacyPresetGroups(extensions) {
    const umbrella = extensions?.st_tavern_tools;
    const legacy = umbrella?.presetGroups;
    if (!Array.isArray(legacy?.groups)) return extensions;

    const groups = [];
    const ids = new Set();
    for (const group of legacy.groups) {
        if (!isIdentifier(group?.id) || ids.has(group.id)) continue;
        ids.add(group.id);
        groups.push({
            id: group.id,
            name: typeof group.name === 'string' ? group.name : '',
            order: groups.length,
            collapsed: group.collapsed === true,
            enabled: group.enabled !== false,
        });
    }

    const assignments = legacy.assignments && typeof legacy.assignments === 'object' && !Array.isArray(legacy.assignments)
        ? Object.entries(legacy.assignments) : [];
    const prompts = Object.fromEntries(assignments
        .filter(([id, groupId]) => isIdentifier(id) && ids.has(groupId))
        .map(([id, groupId]) => [id, { groupId }]));
    const promptIds = Array.isArray(legacy.favorites) ? [...new Set(legacy.favorites.filter(isIdentifier))] : [];
    const retainedUmbrella = { ...umbrella };
    delete retainedUmbrella.presetGroups;
    return {
        ...extensions,
        st_tavern_tools: retainedUmbrella,
        baibaiToolkit: {
            ...extensions.baibaiToolkit,
            presetPromptGroups: { version: 1, groups, prompts },
            presetPromptFavorites: { version: 1, promptIds, collapsed: legacy.favoritesCollapsed === true },
        },
    };
}
