// 手机三击pc双击编辑 v1.22 (绾绾 / Sommer): compare rendered text while retaining raw offsets.
let entityDecoder;

function decodeEntity(token) {
    entityDecoder ??= globalThis.document?.createElement('textarea');
    if (!entityDecoder) return token;
    entityDecoder.innerHTML = token;
    return entityDecoder.value;
}

function projection(source, rendered = false) {
    const positions = [];
    const ends = [];
    let text = '';
    const tokens = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|&(?:#x[\da-f]+|#\d+|[a-z][a-z\d]+);|\\[\\`*_{}\[\]()#+\-.!>~|]/gi;
    let cursor = 0;
    const append = (value, start, end) => {
        for (let offset = 0; offset < value.length; offset++) {
            const character = value[offset];
            if (/[\s\u200B`*~_]/.test(character)) continue;
            text += character;
            positions.push(end === undefined ? start + offset : start);
            ends.push(end ?? start + offset + 1);
        }
    };
    if (!rendered) {
        for (const match of source.matchAll(tokens)) {
            append(source.slice(cursor, match.index), cursor);
            const token = match[0];
            cursor = match.index + token.length;
            if (token.startsWith('&')) append(decodeEntity(token), match.index, cursor);
            if (token.startsWith('\\')) append(token.slice(1), match.index, cursor);
        }
    }
    append(source.slice(cursor), cursor);
    return { text, positions, ends };
}

function occurrences(source, needle) {
    const found = [];
    if (!needle) return found;
    let index = source.indexOf(needle);
    while (index !== -1) {
        found.push(index);
        index = source.indexOf(needle, index + 1);
    }
    return found;
}

function renderedOccurrence(raw, source, matches, needle, ordinal, visibleCount, renderText) {
    if (!matches.length || ordinal < 0 || typeof renderText !== 'function') return -1;
    // Trace candidates through the host's renderer once. Markers
    // inside hidden sections disappear with them; raw offsets stay authoritative.
    const token = '\uE000' + Math.random().toString(36).slice(2);
    const boundaries = matches.flatMap((index, id) => [
        { offset: source.positions[index], marker: `${token}:${id}:s\uE001` },
        { offset: source.ends[index + needle.length - 1], marker: `${token}:${id}:e\uE001` },
    ]).sort((a, b) => a.offset - b.offset);
    const parts = [];
    let cursor = 0;
    for (const boundary of boundaries) {
        parts.push(raw.slice(cursor, boundary.offset), boundary.marker);
        cursor = boundary.offset;
    }
    parts.push(raw.slice(cursor));
    const rendered = projection(renderText(parts.join('')), true).text;
    const traced = matches.map(() => ({ s: [], e: [] }));
    let clean = '';
    cursor = 0;
    for (const marker of rendered.matchAll(new RegExp(`${token}:(\\d+):([se])\uE001`, 'g'))) {
        clean += rendered.slice(cursor, marker.index);
        traced[Number(marker[1])][marker[2]].push(clean.length);
        cursor = marker.index + marker[0].length;
    }
    clean += rendered.slice(cursor);
    const renderedMatches = occurrences(clean, needle);
    if (renderedMatches.length !== visibleCount) return -1;
    const offset = renderedMatches[ordinal];
    const candidates = matches.filter((index, id) => {
        const { s, e } = traced[id];
        return s.length === 1 && e.length === 1 && s[0] === offset && e[0] === offset + needle.length;
    });
    return candidates.length === 1 ? candidates[0] : -1;
}

export function locateText(raw, text, { visibleText, beforeText, renderText, wholeBlock = false } = {}) {
    const selected = text.trim();
    if (!selected) return null;
    const source = projection(raw);
    const needle = projection(selected, true).text;
    const matches = occurrences(source.text, needle);
    let index = matches.length === 1 ? matches[0] : -1;
    // Use the clicked DOM occurrence. When hidden source changes the count,
    // ask the host which raw candidate actually survives its rendering rules.
    if (typeof visibleText === 'string') {
        const visibleMatches = occurrences(projection(visibleText, true).text, needle);
        const ordinal = typeof beforeText === 'string' ? visibleMatches.indexOf(projection(beforeText, true).text.length) : -1;
        if (visibleMatches.length !== matches.length) {
            index = renderedOccurrence(raw, source, matches, needle, ordinal, visibleMatches.length, renderText);
        } else if (typeof beforeText === 'string') {
            index = ordinal < 0 ? -1 : matches[ordinal];
        }
    } else if (matches.length > 1 && typeof beforeText === 'string') {
        const offset = projection(beforeText, true).text.length;
        if (matches.includes(offset)) index = offset;
    }
    if (index < 0) return null;
    const start = source.positions[index];
    const end = source.ends[index + needle.length - 1];
    if (wholeBlock) return expandRawBlock(raw, start, end, needle, selected);
    const direct = occurrences(raw, selected);
    if (direct.length === 1 && matches.length === 1) return { start: direct[0], end: direct[0] + selected.length, text: selected };
    return spanAt(raw, start, end);
}

function spanAt(raw, start, end) {
    return { start, end, text: raw.slice(start, end) };
}

function expandRawBlock(raw, start, end, needle, selected) {
    const timeline = '【时间线节点摘要】';
    const heading = selected.includes(timeline) ? timeline
        : selected.startsWith('【') && selected.endsWith('】') && selected.length < 30 ? selected : null;
    const headingStart = heading ? raw.indexOf(heading, start) : -1;
    if (headingStart >= start && headingStart < end) {
        const rest = raw.slice(headingStart + heading.length);
        const separator = heading === timeline
            ? /\r?\n\r?\n<div align="center">【馆藏封存】<\/div>/
            : /\r?\n\r?\n【/;
        const next = rest.search(separator);
        return spanAt(raw, headingStart, next < 0 ? raw.length : headingStart + heading.length + next);
    }

    const lineStart = raw.lastIndexOf('\n', start - 1) + 1;
    const lineBreak = raw.indexOf('\n', end);
    const lineEnd = lineBreak < 0 ? raw.length : lineBreak;
    let paragraphStart = 0;
    let paragraphEnd = raw.length;
    for (const match of raw.matchAll(/\r?\n[ \t]*\r?\n/g)) {
        const next = match.index + match[0].length;
        if (next <= start) paragraphStart = next;
        if (match.index >= end) { paragraphEnd = match.index; break; }
    }
    for (const [from, to] of [[lineStart, lineEnd], [paragraphStart, paragraphEnd]]) {
        const block = raw.slice(from, to);
        const trimmed = block.trim();
        if (projection(trimmed).text === needle) {
            const offset = from + block.indexOf(trimmed);
            return spanAt(raw, offset, offset + trimmed.length);
        }
    }

    // Keep paired inline Markdown markers in the edit field with the fragment.
    const opening = raw.slice(0, start).match(/[`*~_]+$/)?.[0];
    if (opening && raw.startsWith(opening, end) && raw[start - opening.length - 1] !== '\\') {
        return spanAt(raw, start - opening.length, end + opening.length);
    }
    return spanAt(raw, start, end);
}

export function locateDivider(raw, dividerIndex, dividerCount) {
    const dividers = Array.from(raw.matchAll(/^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*\r?$|<hr\b[^>]*>/gim));
    const divider = dividers.length === dividerCount ? dividers[dividerIndex] : null;
    return divider ? spanAt(raw, divider.index, divider.index + divider[0].trimEnd().length) : null;
}

export function replaceSpan(raw, span, replacement) {
    return raw.slice(0, span.start) + replacement + raw.slice(span.end);
}
