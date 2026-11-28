import { event_types, eventSource } from '@sillytavern/script';
import { promptManager } from '@sillytavern/scripts/openai';
import { applyPresetGroupDeletedCleanup, applyPresetGroupImportCleanup } from './preset/groupState.js';
import { installPresetRenameSaveTracking, removePresetRenameSaveTracking } from './preset/renameSave.js';
import { applyPresetSaveOptimization, applyPresetToggleOptimization } from './preset/saveToggle.js';
import { configurePresetOptimizations, settings, setPresetGroupingEnabled } from './preset/state.js';
import { applyPresetGrouping, rebuildPresetVuePromptListDraggable, refreshPresetVuePromptListControlsLayout, schedulePresetVuePromptListManagerSync } from './preset/vueList.js';

const refresh = () => schedulePresetVuePromptListManagerSync(0);
const hostEvents = [
    event_types.OAI_PRESET_CHANGED_AFTER,
    event_types.MAIN_API_CHANGED,
    event_types.CHATCOMPLETION_MODEL_CHANGED,
    event_types.CHATCOMPLETION_SOURCE_CHANGED,
].filter(Boolean);

export function enablePresetGrouping(config, saveDragLock) {
    const enabled = settings.presetGroupingEnabled;
    if (!enabled && promptManager?.renderPromptManagerListItems?.__baiBaiToolkitPresetVueListPatched) {
        throw new Error('请先关闭柏宝箱里的预设分组和预设切换优化，再启用千机伞的分组。');
    }

    const editButtonInMenuChanged = settings.presetGroupingEditButtonInMenuEnabled !== config.presetGroupingEditButtonInMenu;
    const mobileDragChanged = settings.presetMobileWholeRowDragEnabled !== config.presetMobileWholeRowDrag;
    configurePresetOptimizations({
        settings: {
            presetGroupingEnabled: true,
            presetGroupingEditButtonInMenuEnabled: config.presetGroupingEditButtonInMenu,
            presetMobileWholeRowDragEnabled: config.presetMobileWholeRowDrag,
            presetVueDragLocked: config.presetVueDragLocked,
        },
        saveSettings: () => saveDragLock(settings.presetVueDragLocked),
    });

    if (enabled) {
        if (editButtonInMenuChanged) refreshPresetVuePromptListControlsLayout();
        if (mobileDragChanged) rebuildPresetVuePromptListDraggable();
        return;
    }

    installPresetRenameSaveTracking();
    applyPresetGroupDeletedCleanup();
    applyPresetGroupImportCleanup();
    applyPresetToggleOptimization();
    applyPresetSaveOptimization();
    applyPresetGrouping();
    for (const event of hostEvents) eventSource.on(event, refresh);
}

export function disablePresetGrouping() {
    if (!settings.presetGroupingEnabled) return;
    setPresetGroupingEnabled(false);
    for (const event of hostEvents) eventSource.removeListener(event, refresh);
    applyPresetGrouping();
    removePresetRenameSaveTracking();
}
