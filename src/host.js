export function getHost() {
    const host = globalThis.SillyTavern || globalThis.Luker;
    if (!host?.getContext) throw new Error('酒馆尚未准备好，请稍后再试。');
    return host.getContext();
}

export function notify(message, type = 'info') {
    globalThis.toastr?.[type]?.(message, '千机伞');
}

export function triggerRegenerate(documentRef = document) {
    const action = documentRef.getElementById('option_regenerate');
    if (!action) throw new Error('未找到重新生成入口，请先打开一个聊天。');
    // Keep the native edit checks, group generation and extension hooks intact.
    action.click();
}

export async function retractInput(context = getHost(), documentRef = document) {
    const input = documentRef.getElementById('send_textarea');
    if (!input) throw new Error('未找到消息输入框。');
    if (input.value.trim()) throw new Error('输入框里还有未发送的文字，请先发送或移走，再回退上一轮。');
    const stop = documentRef.getElementById('mes_stop');
    if (stop?.getClientRects().length) throw new Error('请先停止生成，再回退上一轮。');
    const chat = context.chat;
    const index = chat.findLastIndex(message => message?.is_user);
    if (index < 0) throw new Error('还没有可回退的用户消息。');
    const message = chat[index];
    if (message.extra?.media?.length || message.extra?.image || message.extra?.file) {
        throw new Error('这条输入带有附件，请用酒馆原生编辑处理，避免撤回后丢失附件。');
    }
    const tt = globalThis.__TAURITAVERN_HOST__;
    const chatId = context.getCurrentChatId?.() ?? context.chatId;
    const targets = chat.slice(index);
    function verifyTauriChat(length) {
        if (!tt) return;
        const current = getHost();
        if ((current.getCurrentChatId?.() ?? current.chatId) !== chatId
            || current.characterId !== context.characterId || current.groupId !== context.groupId
            || current.chat !== chat || chat.length !== length
            || documentRef.getElementById('send_textarea') !== input) {
            throw new Error('聊天或消息已变化，已停止回退。');
        }
    }
    // Keep the user's words in the composer before asking the host to delete
    // the tail. This is a user-requested withdrawal, not a generation retry.
    input.value = String(message.mes || '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const indices = Array.from({ length: targets.length }, (_, offset) => index + offset);
    if (typeof context.deleteMessages === 'function') {
        await context.deleteMessages(indices);
    } else {
        for (const id of indices.reverse()) {
            verifyTauriChat(id + 1);
            if (tt && chat[id] !== targets[id - index]) throw new Error('消息已变化，已停止回退。');
            await context.deleteMessage(id, undefined, false);
        }
        verifyTauriChat(index);
        await context.saveChat();
    }
    verifyTauriChat(index);
    input.focus();
}

export async function saveEditedMessage(context, index, message, text, isCurrent = () => context.chat[index] === message) {
    const previousText = message.mes;
    const tt = globalThis.__TAURITAVERN_HOST__ ? await import('/script.js') : null;
    if (!isCurrent() || message.mes !== previousText) return false;

    if (tt && previousText !== text) {
        message.extra ??= {};
        delete message.extra.reasoning_signature;
        delete message.extra.native;
    }
    message.mes = text;
    if (context.chatMetadata) context.chatMetadata.tainted = true;
    if (tt && message.swipe_id !== undefined) {
        // Update only the active swipe and preserve any unloaded alternatives.
        tt.ensureSwipes(message);
        tt.syncMesToSwipe(index);
    } else if (Array.isArray(message.swipes)) {
        message.swipes[message.swipe_id ?? 0] = text;
    }

    await context.eventSource.emit(context.eventTypes.MESSAGE_EDITED, index);
    if (!isCurrent()) return false;
    context.updateMessageBlock(index, message);
    if (tt) {
        await tt.finalizeMessageContent(index, context.eventTypes.MESSAGE_UPDATED);
    } else {
        await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, index);
    }
    if (!isCurrent()) return false;
    // Luker's updateMessages currently persists/renders without edit events;
    // upstream has no Messages API. Emit once above and centralize this split.
    if (typeof context.updateMessages === 'function') {
        await context.updateMessages({ index, patch: {} }, { rerender: false });
    } else {
        await context.saveChat();
    }
    return true;
}
