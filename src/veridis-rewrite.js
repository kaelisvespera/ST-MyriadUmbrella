const LOG_ATTRIBUTE = 'data-veridis-ai-rewrite-debug-events';
const SNAPSHOT = ':scope > [data-blai-atomic-message-snapshot="true"]';

function logEntries() {
    const log = globalThis.__veridisAiRewriteLog;
    return Array.isArray(log) ? log.filter(entry => entry && typeof entry === 'object') : [];
}

function readStage(message, branch) {
    const activeBranch = Array.isArray(message.swipes) ? `swipe:${message.swipe_id}` : 'main';
    if (branch !== activeBranch) return null;
    const stage = message.__blai_diff_branch_meta?.[branch];
    return typeof stage?.aiMes === 'string' && stage.reverted === false ? stage : null;
}

export function observeVeridisRewrites({ capture, isSameChat, onRewrite }) {
    const seen = new WeakSet(logEntries());
    let active = null;
    const observer = new MutationObserver(() => {
        // Veridis v3.5 exposes immutable log entries and updates this attribute
        // even when the managed TT renderer suppresses synthetic message events.
        for (const entry of logEntries()) {
            if (seen.has(entry)) continue;
            seen.add(entry);
            const { stage, details } = entry;
            const id = details?.index ?? details?.messageId;
            if (stage === 'run-start') {
                active = null;
                if (!Number.isSafeInteger(id) || id < 0 || typeof details.branchKey !== 'string') continue;
                const session = capture(details);
                const chat = session?.context.chat;
                const message = chat?.[id];
                if (!message || message.is_user || message.is_system) continue;
                active = { session, id, message, branch: details.branchKey, generation: details.generationId,
                    before: message.mes, previousStage: readStage(message, details.branchKey),
                    lastUser: chat.findLastIndex(item => item?.is_user) };
                continue;
            }
            if (!active || !['atomic-commit', 'task-cancelled'].includes(stage)
                || details?.generationId !== active.generation || id !== active.id) continue;

            const { session, message, branch, generation, lastUser, before, previousStage } = active;
            active = null;
            if (stage !== 'atomic-commit' || details.mode !== 'ai' || !isSameChat(session)) continue;
            const result = readStage(message, branch);
            const text = message.mes;
            if (!result || typeof text !== 'string') continue;
            const row = session.container.querySelector(`:scope > .mes[mesid="${id}"]`);
            // Metadata-only commits can also be logged. A real equal-length
            // edit leaves Veridis's atomic visual swap in place until render.
            const swapped = row?.style.visibility === 'hidden' && document.body.querySelector(SNAPSHOT);
            const lengthChanged = Number.isInteger(details.beforeLength) && details.beforeLength !== text.length
                && details.afterLength === text.length;
            // Automatic Veridis commits store the exact pre-write body as their original.
            const sourceText = generation ? result.originalMes : before;
            const contentChanged = text !== sourceText && result !== previousStage && details.afterLength === text.length;
            if (!lengthChanged && !contentChanged && !swapped) continue;
            const chat = session.context.chat;
            const isRewritten = () => chat[id] === message && message.mes === text
                && readStage(message, branch) === result && chat.findLastIndex(item => item?.is_user) === lastUser;
            if (isRewritten()) onRewrite(session, { id, message, isRewritten });
        }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [LOG_ATTRIBUTE] });
    return {
        clear() { active = null; },
        destroy() { observer.disconnect(); active = null; },
    };
}
