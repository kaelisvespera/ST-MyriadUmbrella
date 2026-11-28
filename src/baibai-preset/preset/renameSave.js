import { oai_settings } from '@sillytavern/scripts/openai';
import { PRESET_RENAME_SAVE_GATE_TIMEOUT_MS, PRESET_SAVE_URL } from './constants.js';
import { clearPendingPresetPromptChangesForSavedRevision, getPresetPromptSaveRevision } from './pendingChanges.js';
import { LOG_PREFIX, extensionState } from './state.js';

// Observe the host's own preset saves so rename cannot overtake a pending update.
export function installPresetRenameSaveTracking() {
    if (extensionState.presetRenameSaveTracking || typeof globalThis.fetch !== 'function') return;
    const originalFetch = globalThis.fetch;
    const state = { originalFetch, wrappedFetch: null };
    state.wrappedFetch = function (input, init) {
        const body = isPresetSaveRequest(input, init) ? readPresetSaveBodySync(init) : null;
        const promise = originalFetch.call(globalThis, input, init);
        if (isOpenAiPresetSaveBody(body)) trackOpenAiPresetSaveRequest(state, body, promise);
        return promise;
    };
    extensionState.presetRenameSaveTracking = state;
    globalThis.fetch = state.wrappedFetch;
}

export function removePresetRenameSaveTracking() {
    const state = extensionState.presetRenameSaveTracking;
    if (state && globalThis.fetch === state.wrappedFetch) {
        globalThis.fetch = state.originalFetch;
        delete extensionState.presetRenameSaveTracking;
    }
}

function isPresetSaveRequest(input, init) {
    if (getPresetAutoBackupFetchMethod(input, init) !== 'POST') {
        return false;
    }

    const url = getPresetAutoBackupFetchUrl(input);

    if (!url) {
        return false;
    }

    if (!url.includes(PRESET_SAVE_URL)) {
        return false;
    }

    try {
        return new URL(url, location.href).pathname === PRESET_SAVE_URL;
    } catch {
        return false;
    }
}

function readPresetSaveBodySync(init) {
    try {
        const raw = init && typeof init.body === 'string' ? init.body : null;
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function isOpenAiPresetSaveBody(body) {
    return Boolean(isPresetSaveBody(body) && body.apiId === 'openai');
}

function trackOpenAiPresetSaveRequest(state, body, requestPromise) {
    if (!(state.activeOpenAiPresetSaveRequests instanceof Map)) {
        state.activeOpenAiPresetSaveRequests = new Map();
    }

    const presetName = body.name;
    const requests = state.activeOpenAiPresetSaveRequests.get(presetName) ?? new Set();
    // The caller still has post-fetch work (response.json + in-memory preset cache updates).
    // Keep the request active through the next task so rename cannot overtake that continuation.
    const trackedPromise = Promise.resolve(requestPromise).then(
        response => new Promise(resolve => setTimeout(resolve, 0, response)),
        error => new Promise((_, reject) => setTimeout(reject, 0, error)),
    );
    requests.add(trackedPromise);
    state.activeOpenAiPresetSaveRequests.set(presetName, requests);

    const renameGate = getOpenAiPresetRenameSaveGate();

    if (renameGate && (presetName === renameGate.oldName || presetName === renameGate.newName)) {
        renameGate.latestSaveRequest = {
            presetName,
            revision: getPresetPromptSaveRevision(presetName),
            promise: trackedPromise,
        };
    }

    const cleanup = () => {
        requests.delete(trackedPromise);

        if (!requests.size) {
            state.activeOpenAiPresetSaveRequests.delete(presetName);
        }
    };

    trackedPromise.then(cleanup, cleanup);
}

function getActiveOpenAiPresetSaveRequests(presetName) {
    const state = extensionState.presetRenameSaveTracking;
    const requests = state?.activeOpenAiPresetSaveRequests?.get(presetName);
    return requests instanceof Set ? Array.from(requests) : [];
}

function getOpenAiPresetRenameSaveGate() {
    const gate = extensionState.openAiPresetRenameSaveGate;
    return gate && typeof gate === 'object' ? gate : null;
}

function isOpenAiPresetRenameSaveGateActive() {
    return Boolean(getOpenAiPresetRenameSaveGate());
}

function beginOpenAiPresetRenameSaveGate(oldName, newName) {
    const existingGate = getOpenAiPresetRenameSaveGate();

    if (existingGate) {
        settleOpenAiPresetRenameSaveGate(existingGate, getOpenAiPresetRenameFallbackName(existingGate));
    }

    let resolveCompletion;
    const gate = {
        oldName,
        newName,
        renamed: false,
        latestSaveRequest: null,
        finalSavedRevision: null,
        deferredSaveTail: Promise.resolve(),
        completionPromise: new Promise(resolve => {
            resolveCompletion = resolve;
        }),
        resolveCompletion: null,
        timeout: 0,
    };

    gate.resolveCompletion = resolveCompletion;
    gate.timeout = setTimeout(() => {
        if (getOpenAiPresetRenameSaveGate() !== gate) {
            return;
        }

        console.debug(`${LOG_PREFIX} Preset rename save gate timed out`, {
            oldName: gate.oldName,
            newName: gate.newName,
            renamed: gate.renamed,
        });
        settleOpenAiPresetRenameSaveGate(gate, getOpenAiPresetRenameFallbackName(gate));
    }, PRESET_RENAME_SAVE_GATE_TIMEOUT_MS);
    extensionState.openAiPresetRenameSaveGate = gate;

    const activeRequests = [
        ...getActiveOpenAiPresetSaveRequests(oldName),
        ...getActiveOpenAiPresetSaveRequests(newName),
    ];

    return Promise.allSettled(Array.from(new Set(activeRequests)));
}

function markOpenAiPresetRenameSaveGateRenamed(oldName, newName) {
    const gate = getOpenAiPresetRenameSaveGate();

    if (!gate || gate.oldName !== oldName || gate.newName !== newName) {
        return false;
    }

    gate.renamed = true;
    return true;
}

function getOpenAiPresetRenameFallbackName(gate) {
    if (gate?.renamed || oai_settings?.preset_settings_openai === gate?.newName) {
        return gate?.newName;
    }

    return gate?.oldName;
}

function settleOpenAiPresetRenameSaveGate(gate, resolvedPresetName) {
    if (!gate || getOpenAiPresetRenameSaveGate() !== gate) {
        return false;
    }

    clearTimeout(gate.timeout);
    delete extensionState.openAiPresetRenameSaveGate;
    gate.resolveCompletion(resolvedPresetName);
    return true;
}

async function finishOpenAiPresetRenameSaveGateAfterFinalSave() {
    const gate = getOpenAiPresetRenameSaveGate();

    if (!gate || !gate.renamed) {
        return;
    }

    const finalSaveRequest = gate.latestSaveRequest;
    let saved = false;

    if (finalSaveRequest?.promise) {
        try {
            const response = await finalSaveRequest.promise;
            saved = response?.ok !== false;
        } catch (error) {
            console.debug(`${LOG_PREFIX} Failed to finish the final renamed preset save`, error);
        }
    }

    if (saved && Number.isFinite(finalSaveRequest.revision)) {
        gate.finalSavedRevision = finalSaveRequest.revision;
        clearPendingPresetPromptChangesForSavedRevision(
            finalSaveRequest.presetName,
            finalSaveRequest.revision,
        );
    }

    settleOpenAiPresetRenameSaveGate(gate, gate.newName);
}

function getOpenAiPresetSaveStateName(presetName) {
    const gate = getOpenAiPresetRenameSaveGate();

    if (!gate || (presetName !== gate.oldName && presetName !== gate.newName)) {
        return presetName;
    }

    return gate.renamed ? gate.newName : gate.oldName;
}

function isPresetSaveBody(body) {
    return Boolean(
        body
        && typeof body === 'object'
        && !Array.isArray(body)
        && typeof body.name === 'string'
        && body.name.trim()
        && body.preset
        && typeof body.preset === 'object',
    );
}

function getPresetAutoBackupFetchUrl(input) {
    if (typeof input === 'string') {
        return input;
    }

    if (input instanceof URL) {
        return input.href;
    }

    if (isPresetAutoBackupRequest(input)) {
        return input.url;
    }

    return '';
}

function getPresetAutoBackupFetchMethod(input, init) {
    return String(init?.method || (isPresetAutoBackupRequest(input) ? input.method : '') || 'GET').toUpperCase();
}

function isPresetAutoBackupRequest(value) {
    return typeof Request === 'function' && value instanceof Request;
}

export {
    beginOpenAiPresetRenameSaveGate,
    finishOpenAiPresetRenameSaveGateAfterFinalSave,
    getOpenAiPresetRenameSaveGate,
    getOpenAiPresetSaveStateName,
    isOpenAiPresetRenameSaveGateActive,
    markOpenAiPresetRenameSaveGateRenamed,
};
