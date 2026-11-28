import { readConfig, writeConfig } from './config.js';
import { notify } from './host.js';
import { quickRepliesEnabled, setQuickRepliesEnabled } from './reroll.js';

export function mountToolbox(root, { apply, manageDock, addDock, revealDock }) {
    root.classList.add('toolbox');
    root.innerHTML = `
      <section class="tool-group" aria-labelledby="tools-chat-title">
        <h3 id="tools-chat-title"><i class="fa-regular fa-comment-dots" aria-hidden="true"></i>聊天与生成</h3>
        <div class="tool-sheet">
          <label class="tool-control"><span>生成完成后定位新消息</span><input type="checkbox" data-setting="locateReply"></label>
          <label class="tool-control"><span>发送旁重 roll<small>单击重生成 · 双击重 roll · 长按回填</small></span><input type="checkbox" data-setting="sendReroll" aria-label="发送旁重 roll"></label>
          <label class="tool-control"><span>正文局部编辑</span><input type="checkbox" data-setting="editor"></label>
          <label class="tool-control"><span>折叠区块底部收起</span><input type="checkbox" data-setting="detailsCollapse"></label>
        </div>
      </section>
      <section class="tool-group" aria-labelledby="tools-qr-title">
        <h3 id="tools-qr-title"><i class="fa-solid fa-bolt" aria-hidden="true"></i>QR 快捷按钮</h3>
        <div class="tool-sheet tool-qr">
          <label class="tool-control"><span>重新生成</span><input type="checkbox" data-qr="重新生成" aria-label="在 QR 栏显示重新生成"></label>
          <label class="tool-control"><span>回退输入</span><input type="checkbox" data-qr="回退输入" aria-label="在 QR 栏显示回退输入"></label>
          <label class="tool-control"><span>回顶</span><input type="checkbox" data-qr="回顶" aria-label="在 QR 栏显示回顶"></label>
          <label class="tool-control"><span>回底</span><input type="checkbox" data-qr="回底" aria-label="在 QR 栏显示回底"></label>
          <label class="tool-control"><span>回楼层</span><input type="checkbox" data-qr="回楼层" aria-label="在 QR 栏显示回楼层"></label>
        </div>
      </section>
      <section class="tool-group" aria-labelledby="tools-display-title">
        <h3 id="tools-display-title"><i class="fa-solid fa-layer-group" aria-hidden="true"></i>悬浮球与外观</h3>
        <div class="tool-sheet">
          <label class="tool-control"><span>悬浮球收纳</span><input type="checkbox" data-setting="dock" aria-label="启用悬浮球收纳"></label>
          <div class="tool-actions" data-dock-actions hidden>
            <button type="button" data-reveal>显示收纳球</button>
            <button type="button" data-manage>管理</button>
            <button type="button" data-add>点选添加</button>
          </div>
          <label class="tool-control"><span>记住悬浮球位置</span><input type="checkbox" data-setting="floatingPositions"></label>
          <div class="tool-notice">
            <label for="toolbox-notice">通知外观</label>
            <select id="toolbox-notice" data-toast><option value="off">酒馆原样</option><option value="bar">顶部长细条</option></select>
            <button type="button" data-preview aria-label="示例通知">预览</button>
          </div>
        </div>
      </section>
      <section class="tool-group" aria-labelledby="tools-cards-title">
        <h3 id="tools-cards-title"><i class="fa-regular fa-folder-open" aria-hidden="true"></i>角色与预设</h3>
        <div class="tool-sheet">
          <label class="tool-control"><span>角色卡文件夹</span><input type="checkbox" data-setting="foldersEnabled"></label>
          <label class="tool-control"><span>随卡保存预设开关</span><input type="checkbox" data-setting="presetToggles"></label>
          <label class="tool-control"><span>预设分组</span><input type="checkbox" data-setting="presetGrouping"></label>
          <div data-preset-group-actions hidden>
            <label class="tool-control"><span>手机预设条目整条拖拽</span><input type="checkbox" data-setting="presetMobileWholeRowDrag"></label>
            <label class="tool-control"><span>分组后把编辑按钮收进菜单</span><input type="checkbox" data-setting="presetGroupingEditButtonInMenu"></label>
          </div>
        </div>
      </section>
    `;
    const config = readConfig();
    const dock = root.querySelector('[data-setting="dock"]');
    const dockActions = root.querySelector('[data-dock-actions]');
    const grouping = root.querySelector('[data-setting="presetGrouping"]');
    const groupActions = root.querySelector('[data-preset-group-actions]');
    const syncActions = () => {
        dockActions.hidden = !dock.checked;
        groupActions.hidden = !grouping.checked;
    };
    for (const input of root.querySelectorAll('[data-setting]')) {
        input.checked = config[input.dataset.setting];
        input.addEventListener('change', () => {
            writeConfig({ [input.dataset.setting]: input.checked });
            syncActions();
            apply();
        });
    }
    syncActions();
    const toast = root.querySelector('[data-toast]');
    toast.value = config.toast;
    toast.addEventListener('change', () => { writeConfig({ toast: toast.value }); apply(); });
    root.querySelector('[data-preview]').addEventListener('click', () => notify('这是一条示例通知，原来的点击与关闭操作会保留。', 'success'));
    root.querySelector('[data-manage]').addEventListener('click', manageDock);
    root.querySelector('[data-add]').addEventListener('click', addDock);
    root.querySelector('[data-reveal]').addEventListener('click', revealDock);
    const replies = root.querySelectorAll('[data-qr]');
    const refresh = () => { for (const qr of replies) qr.checked = quickRepliesEnabled(undefined, qr.dataset.qr); };
    refresh();
    for (const qr of replies) qr.addEventListener('change', async () => {
        for (const input of replies) input.disabled = true;
        try {
            await setQuickRepliesEnabled(qr.checked, undefined, qr.dataset.qr);
        } catch (error) {
            console.error('[千机伞] 更改 QR 显示失败', error);
            notify(error.name === 'QuickReplyRenameError' || !globalThis.quickReplyApi ? error.message : '更改 QR 显示失败，请重试。', 'warning');
        } finally { refresh(); for (const input of replies) input.disabled = false; }
    });
    return { refresh };
}
