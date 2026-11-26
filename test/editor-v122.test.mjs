import assert from 'node:assert/strict';
import test from 'node:test';
import { locateDivider, locateText, replaceSpan } from '../src/text-locate.js';

test('whole-block edits keep original Markdown, while an explicit selection stays within the block', () => {
    const raw = '上段\r\n\r\n**原文** 与 `代码`\r\n继续这段。\r\n\r\n尾段';
    const block = locateText(raw, '原文 与 代码继续这段。', { wholeBlock: true });
    const selection = locateText(raw, '原文');
    assert.equal(block.text, '**原文** 与 `代码`\r\n继续这段。');
    assert.equal(replaceSpan(raw, selection, '$&'), '上段\r\n\r\n**$&** 与 `代码`\r\n继续这段。\r\n\r\n尾段');
});

test('edit the clicked divider or named section without touching duplicates', () => {
    const raw = '【记忆】\n甲\n\n【记忆】\n乙\n\n【结束】\n\n---\n\n<hr class="divider">';
    const section = locateText(raw, '【记忆】', {
        wholeBlock: true,
        beforeText: '【记忆】甲',
        visibleText: '【记忆】甲【记忆】乙【结束】',
    });
    const divider = locateDivider(raw, 1, 2);
    assert.equal(section.text, '【记忆】\n乙');
    assert.equal(divider.text, '<hr class="divider">');
    assert.equal(replaceSpan(raw, divider, '').endsWith('---\n\n'), true);
    assert.equal(locateDivider(raw, 0, 3), null);
});

test('timeline edits preserve the following archive boundary', () => {
    const raw = '【时间线节点摘要】\n记录\n\n<div align="center">【馆藏封存】</div>\n后文';
    const span = locateText(raw, '【时间线节点摘要】', { wholeBlock: true });
    assert.equal(span.text, '【时间线节点摘要】\n记录');
    assert.equal(replaceSpan(raw, span, '新记录'), '新记录\n\n<div align="center">【馆藏封存】</div>\n后文');
});
