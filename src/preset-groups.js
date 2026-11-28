import { writeConfig } from './config.js';
import { notify } from './host.js';

export function installPresetGroups() {
    const bundleUrl = new URL('./baibai-preset.bundle.js', import.meta.url);
    bundleUrl.search = new URL(import.meta.url).search;
    let runtime;
    let config;
    let loading;

    function applyConfig() {
        if (!config) return;
        try {
            runtime.enablePresetGrouping(config, locked => writeConfig({ presetVueDragLocked: locked }));
        } catch (error) {
            reportError(error);
        }
    }

    function reportError(error) {
        if (!config) return;
        console.error('[千机伞] 加载柏宝箱预设分组失败', error);
        notify(error.message || '无法加载预设分组。', 'warning');
    }

    return {
        update(next) {
            config = next;
            if (runtime) {
                applyConfig();
                return;
            }
            loading ??= import(/* webpackIgnore: true */ bundleUrl.href).then(module => {
                runtime = module;
                applyConfig();
            }).catch(reportError).finally(() => { loading = null; });
        },
        destroy() {
            config = null;
            runtime?.disablePresetGrouping();
        },
    };
}
