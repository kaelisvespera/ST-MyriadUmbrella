import { getHost, notify } from './host.js';
import { readPresetGroupState, reorderPresetEntries } from './preset-group-model.js';
import { installPromptGroupGate, loadPromptManager, readPromptPreset, savePromptPreset } from './preset-group-host.js';

const entryId = 'st-tools-preset-groups';
const listId = 'completion_prompt_manager_list';
const paneId = 'st-tools-preset-groups-dialog';
const css = `
    #${paneId} { color: var(--st-home-ink, var(--SmartThemeBodyColor)); background: var(--st-home-surface, var(--SmartThemeBlurTintColor)); }
    #${paneId} [hidden] { display:none !important; }
    #${paneId} .st-pg-pane { text-align:start; --pg-line:color-mix(in srgb,currentColor 20%,transparent); --pg-fill:color-mix(in srgb,currentColor 6%,transparent); }
    #${paneId} h3 { margin:0; }
    #${paneId} .st-pg-subtitle { opacity:.72; margin:4px 0 10px; overflow-wrap:anywhere; }
    #${paneId} .st-pg-tools { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:10px; }
    #${paneId} .st-pg-tools input { flex:1 1 150px; min-width:0; margin:0; }
    #${paneId} :is(button,select) { font:inherit; color:inherit; background:var(--pg-fill); border:1px solid var(--pg-line); border-radius:6px; min-height:34px; padding:4px 8px; }
    #${paneId} button:disabled { opacity:.45; }
    #${paneId} .st-pg-group { border:1px solid var(--pg-line); border-radius:9px; margin:8px 0; padding:0 8px; }
    #${paneId} .st-pg-head { display:flex; flex-wrap:wrap; padding:6px 0; align-items:center; gap:5px; }
    #${paneId} .st-pg-fold { flex:1 1 120px; text-align:start; overflow-wrap:anywhere; }
    #${paneId} .st-pg-row { display:flex; align-items:center; gap:5px; flex-wrap:wrap; border-top:1px solid var(--pg-line); padding:4px 0; }
    #${paneId} .st-pg-name { flex:1 1 90px; min-width:0; overflow-wrap:anywhere; margin:0; }
    #${paneId} .st-pg-move { display:flex; align-items:center; gap:4px; }
    #${paneId} .st-pg-move select { max-width:130px; }
    #${paneId} .st-pg-flag { margin-right:0; }
    #${paneId} .st-pg-note { margin:6px 0; font-size:.9em; overflow-wrap:anywhere; }
    #${paneId} .st-pg-note[data-error] { color:var(--SmartThemeQuoteColor, currentColor); }
    #${paneId} .st-pg-drag { cursor:grab; }
    #${paneId} .st-pg-drop { outline:1px dashed currentColor; outline-offset:-2px; }
    #${paneId} .st-pg-range-start { background:var(--pg-fill); }
    @media (pointer:coarse) { #${paneId} .st-pg-drag { display:none; } }
    @media (max-width:560px) { #${paneId} .st-pg-move { flex-basis:100%; padding-inline-start:24px; } }
`;

function element(tag, text = '', className = '') {
    const item = document.createElement(tag);
    item.textContent = text;
    item.className = className;
    return item;
}

function button(text, activate, label = '') {
    const control = element('button', text);
    control.type = 'button';
    if (label) control.setAttribute('aria-label', label);
    control.addEventListener('click', activate);
    return control;
}

function nativeAction(id, action) {
    const row = document.querySelector(`#${listId} > .completion_prompt_manager_prompt[data-pm-identifier="${CSS.escape(id)}"]`);
    const target = row?.querySelector(`.prompt-manager-${action}-action`);
    return target && !target.disabled && target.getAttribute('aria-disabled') !== 'true' && !target.classList.contains('disabled') ? target : null;
}

function assign(state, promptId, groupId) {
    if (groupId) state.assignments[promptId] = groupId;
    else delete state.assignments[promptId];
}

function groupOf(state, id) {
    return Object.hasOwn(state.assignments, id) ? state.assignments[id] : '';
}

function reorderGroups(state, order, id, targetId) {
    const from = state.groups.findIndex(group => group.id === id);
    const to = state.groups.findIndex(group => group.id === targetId);
    if (from < 0 || to < 0 || from === to) return null;
    const [group] = state.groups.splice(from, 1);
    state.groups.splice(to, 0, group);
    const pair = new Set([id, targetId]);
    const isMoving = entry => pair.has(groupOf(state, entry.identifier));
    const shifted = state.groups.filter(item => pair.has(item.id))
        .flatMap(item => order.filter(entry => groupOf(state, entry.identifier) === item.id));
    let index = 0;
    const next = order.map(entry => isMoving(entry) ? shifted[index++] : entry);
    return next.some((entry, index) => entry !== order[index]) ? next : null;
}

export function installPresetGroups() {
    const context = getHost();
    const style = element('style', css);
    document.head.append(style);
    let active = true;
    let view = null;
    let stopGate;
    const entry = button('预设分组', open);
    entry.id = entryId;
    entry.className = 'menu_button';

    function mount() {
        const container = document.getElementById('completion_prompt_manager');
        if (container && entry.nextElementSibling !== container) container.before(entry);
        entry.hidden = getHost().mainApi !== 'openai';
    }
    const eventTypes = ['OAI_PRESET_CHANGED_AFTER', 'MAIN_API_CHANGED']
        .map(key => context.eventTypes[key]).filter(Boolean);
    const refresh = () => { mount(); view?.render(); };
    for (const event of eventTypes) context.eventSource.on(event, refresh);
    mount();

    async function open() {
        if (view || !active) return;
        try {
            const manager = await loading;
            if (view || !active) return;
            if (!readPromptPreset(manager)) { notify('请先选择一份对话补全预设。', 'warning'); return; }
            stopGate ??= installPromptGroupGate(manager);
            const drawer = document.getElementById('completion_prompt_manager')?.closest('.drawer-content');
            if (drawer?.classList.contains('closedDrawer')) {
                drawer.parentElement?.querySelector(':scope > .drawer-toggle')?.click();
            }
            view = showPresetGroups(context, manager, () => { view = null; });
        } catch (error) {
            console.error('[千机伞] 打开预设分组失败', error);
            notify('打开预设分组失败，请刷新后重试。', 'warning');
        }
    }

    const loading = loadPromptManager(context);
    void loading.then(manager => { if (active && !stopGate) stopGate = installPromptGroupGate(manager); })
        .catch(error => { if (active) console.warn('[千机伞] 预设分组暂不可用', error); });
    return {
        open,
        destroy() {
            active = false;
            for (const event of eventTypes) context.eventSource.removeListener(event, refresh);
            stopGate?.();
            view?.close();
            entry.remove();
            style.remove();
        },
    };
}

function showPresetGroups(context, manager, onClose) {
    const { Popup, POPUP_TYPE } = context;
    const pane = element('section', '', 'st-pg-pane');
    const subtitle = element('p', '', 'st-pg-subtitle');
    const toolbar = element('div', '', 'st-pg-tools');
    const query = element('input');
    query.type = 'search';
    query.className = 'text_pole';
    query.placeholder = '搜索预设条目';
    query.setAttribute('aria-label', query.placeholder);
    const add = button('新建分组', () => void nameGroup());
    const pickRange = button('范围建组', () => {
        range = range ? null : { preset: readPromptPreset(manager)?.preset, startId: null };
        note.textContent = '';
        note.removeAttribute('data-error');
        render();
    });
    toolbar.append(query, add, pickRange);
    const note = element('p', '', 'st-pg-note');
    note.setAttribute('role', 'status');
    const rangeHint = element('p', '', 'st-pg-note');
    rangeHint.setAttribute('role', 'status');
    const list = element('div');
    pane.append(element('h3', '预设分组'), subtitle, toolbar, note, rangeHint, list);

    let closed = false;
    let busy = false;
    let dragging = null;
    let range = null;
    let visibleOrder = [];
    let renderQueued = false;
    const popup = new Popup(pane, POPUP_TYPE.TEXT, '', {
        okButton: '完成', wide: true, leftAlign: true, allowVerticalScrolling: true,
    });
    popup.dlg.id = paneId;
    const observer = new MutationObserver(records => {
        if (records.some(record => record.target.id === listId || record.target.id === 'completion_prompt_manager')) scheduleRender();
    });
    const promptRoot = document.getElementById('completion_prompt_manager');
    if (promptRoot) observer.observe(promptRoot, { childList: true, subtree: true });
    query.addEventListener('input', render);
    query.addEventListener('keydown', event => { if (event.key === 'Enter') event.stopPropagation(); });

    function scheduleRender() {
        if (closed || renderQueued) return;
        renderQueued = true;
        queueMicrotask(() => { renderQueued = false; render(); });
    }

    async function change(update, expectedPreset) {
        const session = readPromptPreset(manager);
        if (closed || busy || !session || (expectedPreset && session.preset !== expectedPreset)) return;
        const state = readPresetGroupState(session.preset.extensions);
        const order = update(state, session.order);
        busy = true;
        note.textContent = '正在保存…';
        note.removeAttribute('data-error');
        render();
        try {
            if (await savePromptPreset(session, state, order || null) && order) await manager.render(false);
            note.textContent = '';
        } catch (error) {
            console.error('[千机伞] 保存预设分组失败', error);
            note.textContent = '保存失败，请重试。';
            note.dataset.error = '';
        } finally {
            busy = false;
            render();
        }
    }

    async function nameGroup(id, members = []) {
        if (busy || closed) return;
        const session = readPromptPreset(manager);
        if (!session) return;
        const group = readPresetGroupState(session.preset.extensions).groups.find(item => item.id === id);
        const title = group ? '重命名分组' : '新建分组';
        const input = new Popup('分组名称', POPUP_TYPE.INPUT, group?.name ?? '', { label: title, okButton: '保存', cancelButton: '取消', rows: 1 });
        const result = await input.show();
        const name = typeof result === 'string' && result.trim().slice(0, 80);
        if (!name) return;
        await change(state => {
            const current = state.groups.find(item => item.id === id);
            if (current) current.name = name;
            else if (!id) {
                const groupId = globalThis.crypto?.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(36).slice(2);
                state.groups.push({ id: groupId, name, collapsed: false, enabled: true });
                for (const member of members) assign(state, member, groupId);
            }
        }, session.preset);
    }

    function chooseRangeEntry(id) {
        if (!range.startId) {
            range.startId = id;
            render();
            return;
        }
        const start = visibleOrder.indexOf(range.startId);
        const finish = visibleOrder.indexOf(id);
        if (start < 0 || finish < 0) {
            range.startId = null;
            render();
            return;
        }
        const members = visibleOrder.slice(Math.min(start, finish), Math.max(start, finish) + 1);
        range = null;
        render();
        void nameGroup(undefined, members);
    }

    async function deleteGroup(group, preset) {
        const confirm = new Popup(element('p', `删除「${group.name}」后，组内条目会移到未分组。`), POPUP_TYPE.CONFIRM, '', {
            okButton: '删除分组', cancelButton: '取消',
        });
        if (!await confirm.show()) return;
        await change(state => { state.groups = state.groups.filter(item => item.id !== group.id); }, preset);
    }

    function dragHandle(kind, id, preset, name) {
        const handle = element('span', '⠿', 'st-pg-drag');
        handle.draggable = !busy;
        handle.title = `拖动${name}`;
        handle.setAttribute('aria-hidden', 'true');
        handle.addEventListener('dragstart', event => {
            dragging = { kind, id, preset };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', name);
        });
        handle.addEventListener('dragend', () => { dragging = null; });
        return handle;
    }

    function allowDrop(target, kind, id, preset, drop) {
        const accepts = () => !busy && dragging?.kind === kind && dragging.id !== id && dragging.preset === preset;
        target.addEventListener('dragover', event => {
            if (!accepts()) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            target.classList.add('st-pg-drop');
        });
        target.addEventListener('dragleave', () => target.classList.remove('st-pg-drop'));
        target.addEventListener('drop', event => {
            target.classList.remove('st-pg-drop');
            if (!accepts()) return;
            event.preventDefault();
            event.stopPropagation();
            const source = dragging.id;
            dragging = null;
            void change((state, order) => drop(state, order, source), preset);
        });
    }

    function makeRow(entry, groupId, siblings, state, preset, favorite = false) {
        const { identifier: id, enabled } = entry;
        const name = manager.getPromptById(id)?.name || id;
        const row = element('div', '', 'st-pg-row');
        row.dataset.promptId = id;
        if (range && !favorite) {
            const label = range.startId ? '到此条目' : '从此条目';
            row.classList.toggle('st-pg-range-start', range.startId === id);
            row.append(element('span', name, 'st-pg-name'), button(label, () => chooseRangeEntry(id), label + name));
            return row;
        }
        const toggle = element('input', '', 'st-pg-flag');
        toggle.type = 'checkbox';
        toggle.checked = Boolean(enabled);
        toggle.disabled = busy || !nativeAction(id, 'toggle');
        toggle.setAttribute('aria-label', `启用${name}`);
        toggle.addEventListener('change', () => { nativeAction(id, 'toggle')?.click(); scheduleRender(); });
        const edit = button('编辑', async () => {
            const session = readPromptPreset(manager);
            if (session?.preset !== preset) return;
            await popup.completeCancelled();
            if (readPromptPreset(manager)?.preset === preset) nativeAction(id, 'edit')?.click();
        }, `编辑${name}`);
        edit.disabled = busy || !nativeAction(id, 'edit');
        row.append(toggle, element('span', name, 'st-pg-name'));
        if (!favorite) {
            const starred = state.favorites.includes(id);
            const star = button(starred ? '★' : '☆', () => void change(next => {
                next.favorites = starred ? next.favorites.filter(item => item !== id) : [...next.favorites, id];
            }, preset), `${starred ? '取消收藏' : '添加收藏'}${name}`);
            star.setAttribute('aria-pressed', String(starred));
            star.disabled = busy;
            row.append(star);
        }
        row.append(edit);
        if (favorite) return row;

        const move = element('div', '', 'st-pg-move');
        const choices = element('select');
        choices.setAttribute('aria-label', `${name}的分组`);
        choices.append(new Option('未分组', ''), ...state.groups.map(group => new Option(group.name, group.id)));
        choices.value = groupId;
        choices.disabled = busy || !state.groups.length;
        choices.addEventListener('change', () => {
            const value = choices.value;
            void change(next => assign(next, id, value), preset);
        });
        const position = siblings.findIndex(item => item.identifier === id);
        move.append(choices);
        for (const [offset, symbol, label] of [[-1, '↑', '上移'], [1, '↓', '下移']]) {
            const neighbor = siblings[position + offset];
            const arrow = button(symbol, () => void change((_state, order) => reorderPresetEntries(order, id, neighbor.identifier), preset), label + name);
            arrow.disabled = busy || !neighbor;
            move.append(arrow);
        }
        move.append(dragHandle('prompt', id, preset, name));
        row.append(move);
        allowDrop(row, 'prompt', id, preset, (next, order, source) => {
            assign(next, source, groupId);
            return reorderPresetEntries(order, source, id);
        });
        return row;
    }

    function render() {
        if (closed) return;
        const session = readPromptPreset(manager);
        if (range && range.preset !== session?.preset) range = null;
        subtitle.textContent = session?.name ?? '请选择一份对话补全预设';
        add.disabled = busy || !session || Boolean(range);
        query.disabled = Boolean(range);
        pickRange.disabled = busy || !session;
        pickRange.textContent = range ? '取消选取' : '范围建组';
        rangeHint.hidden = !range;
        rangeHint.textContent = range?.startId ? '请选择范围的另一端。' : '请选择范围的起点。';
        list.replaceChildren();
        if (!session) return;
        const { order, preset } = session;
        const state = readPresetGroupState(preset.extensions);
        const search = query.value.trim().toLocaleLowerCase();
        const matches = entry => !search || String(manager.getPromptById(entry.identifier)?.name ?? entry.identifier).toLocaleLowerCase().includes(search);
        const entries = order.filter(entry => typeof entry?.identifier === 'string' && manager.getPromptById(entry.identifier));
        const favorites = entries.filter(entry => state.favorites.includes(entry.identifier) && matches(entry));
        if (favorites.length && !range) {
            const area = element('section', '', 'st-pg-group st-pg-favorites');
            area.setAttribute('aria-label', '收藏');
            const folded = state.favoritesCollapsed && !search;
            const head = element('div', '', 'st-pg-head');
            const toggle = button(`${folded ? '▸' : '▾'} 收藏（${favorites.length}）`, () => void change(next => { next.favoritesCollapsed = !state.favoritesCollapsed; }, preset));
            toggle.className = 'st-pg-fold';
            toggle.setAttribute('aria-expanded', String(!folded));
            toggle.disabled = busy;
            head.append(toggle);
            area.append(head);
            if (!folded) area.append(...favorites.map(entry => makeRow(entry, '', [], state, preset, true)));
            list.append(area);
        }
        visibleOrder = [];
        for (const [index, group] of [...state.groups, { id: '', name: '未分组' }].entries()) {
            const { id, name } = group;
            const rows = entries.filter(entry => groupOf(state, entry.identifier) === id);
            const visible = rows.filter(matches);
            if (search && !visible.length) continue;
            const area = element('section', '', 'st-pg-group');
            area.dataset.groupId = id;
            area.setAttribute('aria-label', name);
            const header = element('div', '', 'st-pg-head');
            const folded = Boolean(group.collapsed && !search && !range);
            const title = id
                ? button(`${folded ? '▸' : '▾'} ${name}（${rows.length}）`, () => void change(next => { next.groups.find(item => item.id === id).collapsed = !group.collapsed; }, preset))
                : element('strong', `${name}（${rows.length}）`);
            title.className = 'st-pg-fold';
            if (id) {
                title.setAttribute('aria-expanded', String(!folded));
                title.disabled = busy || Boolean(range);
            }
            header.append(title);
            if (id && !range) {
                const power = button(group.enabled ? '暂停整组' : '恢复整组', () => void change(next => { next.groups.find(item => item.id === id).enabled = !group.enabled; }, preset));
                const rename = button('重命名', () => void nameGroup(id), `重命名${name}`);
                const remove = button('删除分组', () => void deleteGroup(group, preset), `删除分组${name}`);
                for (const control of [power, rename, remove]) control.disabled = busy;
                header.append(power, rename, remove);
                for (const [offset, symbol, label] of [[-1, '↑', '上移分组'], [1, '↓', '下移分组']]) {
                    const neighbor = state.groups[index + offset];
                    const arrow = button(symbol, () => void change((next, rows) => reorderGroups(next, rows, id, neighbor.id), preset), label + name);
                    arrow.disabled = busy || !neighbor;
                    header.append(arrow);
                }
                header.append(dragHandle('group', id, preset, name));
                allowDrop(header, 'group', id, preset, (next, rows, source) => reorderGroups(next, rows, source, id));
            }
            if (!range) allowDrop(header, 'prompt', id, preset, (next, _order, source) => assign(next, source, id));
            area.append(header);
            if (!folded) {
                if (visible.length) {
                    visibleOrder.push(...visible.map(entry => entry.identifier));
                    area.append(...visible.map(entry => makeRow(entry, id, rows, state, preset)));
                }
                else area.append(element('p', '此分组还没有条目。', 'st-pg-note'));
            }
            list.append(area);
        }
        if (!list.childElementCount) list.append(element('p', '没有找到匹配的条目。', 'st-pg-note'));
    }

    render();
    void popup.show().finally(() => {
        closed = true;
        observer.disconnect();
        onClose();
    });
    return { render, close: () => popup.completeCancelled() };
}
