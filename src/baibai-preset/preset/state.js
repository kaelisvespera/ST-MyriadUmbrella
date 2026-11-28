export const LOG_PREFIX = '[千机伞 / 柏宝箱预设分组]';
export const extensionState = {};
export const settings = {
    presetGroupingEnabled: false,
    presetGroupingEditButtonInMenuEnabled: false,
    presetMobileWholeRowDragEnabled: true,
    presetVueDragLocked: false,
    // Keep host-owned editors, preview optimizations and unrelated backend services out of this module.
    presetAutoBackupEnabled: false,
    presetAutoSaveAfterPromptEditEnabled: false,
    presetDragOptimizationEnabled: false,
    presetPromptCodeMirrorEditorEnabled: false,
    presetSwitchOptimizationEnabled: false,
    presetToggleOptimizationEnabled: false,
    tokenizerBulkCountEnabled: false,
};
export let savePresetOptimizationSettings = null;

export function configurePresetOptimizations({ settings: initial = {}, saveSettings } = {}) {
    if (typeof initial.presetGroupingEditButtonInMenuEnabled === 'boolean') {
        settings.presetGroupingEditButtonInMenuEnabled = initial.presetGroupingEditButtonInMenuEnabled;
    }
    if (typeof initial.presetMobileWholeRowDragEnabled === 'boolean') {
        settings.presetMobileWholeRowDragEnabled = initial.presetMobileWholeRowDragEnabled;
    }
    if (typeof initial.presetVueDragLocked === 'boolean') settings.presetVueDragLocked = initial.presetVueDragLocked;
    if (typeof initial.presetGroupingEnabled === 'boolean') setPresetGroupingEnabled(initial.presetGroupingEnabled);
    if (typeof saveSettings === 'function') savePresetOptimizationSettings = saveSettings;
}

export function setPresetGroupingEnabled(enabled) {
    settings.presetGroupingEnabled = enabled === true;
}
