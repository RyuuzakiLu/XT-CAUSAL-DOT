/* ================================================================
   闲置换新会话 · 无感接续（历史合并 + 前文拼接） · 总导游图（改代码前必读）
   ▍这是什么
   服务端闲置 15 分钟会把对话换到一个新会话（后端上下文换新，只带最后 6 条接续块）。
   用户要的是“后端换、前端看不出来”：本模块负责前端这一半——
   1. 历史列表：一条换会话链（旧 → 新）只显示成一条，点开的是链上最新的会话，标题用链上最早的那个真标题
      （不显示「接着上次聊」）。
   2. 对话页：当前会话上方拼上链上前面那些会话的原话（只读），往上翻就像一直是同一段对话；
      新消息照常发进当前（最新）会话。
   旧会话一个都不删，只是不在列表里单独出现。
   ▍信号（不按标题猜）
   换会话链来自本实例 GET /dot-session/api/current 的 rollovers（作废的服务端已经不给）。
   前文内容走原生 session/page（只读、不激活旧会话的 Agent，租户闸按归属放行）。
   ▍为什么不会重复
   接续块（dot-carryover）和每回合时间行（dot-turn-time）在新会话里是 context 类注入，原生聊天视图本来就不显示；
   这里拼前文只取 source.kind === 'user' 的真用户消息和 assistant 的正文，所以那 6 条只出现一次（在拼出来的前文里）。
   ▍规则
   1. 只读：拼出来的前文不能点、不能改、不能重发；它不在原生消息状态里。
   2. 前文挂在原生滚动区 [data-conversation-scroll] 的最前面（自己的一个 div，不动原生节点），
      原生重绘把它挤掉就重挂；会话变了（data-conversation-session）就换内容。
   3. 拿不到（接口不通、旧会话读不了）就什么都不显示，不报错打扰用户。
   4. 前文最多拼最近 MAX_ROWS 条，更早的留在服务器上（旧会话都还在）。
   ▍修改铁律
   1. 【不】复制原生消息状态、不另造发送器；【不】删旧会话；【不】按标题判断换会话链。
   2. 样式只用属性选择器 + 本模块自己的类名（含 _userStack/_bubble 子串，好让 dot.module.css 已有的气泡皮肤直接套上）。
   ▍更新记录
   *更新：2026-10-28 · 首版（Hark，hark-seamless-rollover）：历史合并换会话链、对话页拼前文、跟随不再弹提示*
   *更新：2026-11-01 · Hark reloadfix：前文里用户发的图片不再写成〔图片〕——会话记录里存的是附件引用（sha256 attachmentId），
     拼前文时带上引用，交给 mountImages（简洁版 = DOT 图集，按来源会话走原生 session/attachment 取图）。
     只有记录里确实没有附件引用的旧图片块才保留〔图片〕占位。*
================================================================ */
import { readWorkToolMeta } from "./work-cards/work-card.js";
import { historyActions } from "./reply-actions.js";
export const ROLLOVER_TITLE = '接着上次聊';
export const MAX_ROWS = 300;
/** 新会话 → 旧会话（同一个 to 只会有一行；作废的服务端已滤掉）。 */
function predecessorMap(state) {
    const prev = new Map();
    for (const [to, row] of Object.entries(state?.rollovers ?? {}))
        if (row && typeof row.from === 'string' && row.from !== to)
            prev.set(to, row.from);
    return prev;
}
/** 简洁版这次该打开的那一个会话；一个会话都没有时是 undefined（原生输入栏发第一句时会建）。 */
export function pickSingleSession(rows, state) {
    const filled = rows.filter(row => !row.blank).slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const newest = filled[0];
    const current = typeof state?.current === 'string' ? state.current : undefined;
    if (current && (!newest || current === newest.id || chainBefore(current, state).includes(newest.id)))
        return current;
    return newest?.id ?? rows[0]?.id;
}
/** 简洁版里 sessionId 上方要拼的会话：其余有消息的主会话，按最后活动时间从早到晚。 */
export function singleSessionBefore(sessionId, rows) {
    return rows.filter(row => row.id !== sessionId && !row.blank).slice().sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0)).map(row => row.id);
}
/** 几个会话的原话合成一条时间线：有时间的按时间排；没有时间的跟在同会话上一条后面（稳定排序）。 */
export function mergeByTime(parts) {
    const flat = [];
    parts.forEach(rows => {
        let last = flat.length ? flat[flat.length - 1].t : 0;
        for (const row of rows) {
            const t = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : last;
            last = t;
            flat.push({ row, t, i: flat.length });
        }
    });
    return flat.sort((a, b) => a.t - b.t || a.i - b.i).map(item => item.row);
}
/** id 之前的整条链，从最早到最近（不含 id 自己）；防环、限长。 */
export function chainBefore(id, state, limit = 20) {
    if (!id)
        return [];
    const prev = predecessorMap(state);
    const out = [];
    const seen = new Set([id]);
    for (let cur = prev.get(id); cur !== undefined && !seen.has(cur) && out.length < limit; cur = prev.get(cur)) {
        seen.add(cur);
        out.unshift(cur);
    }
    return out;
}
const meaningful = (title) => typeof title === 'string' && title.trim() !== '' && title.trim() !== ROLLOVER_TITLE;
/** 历史列表合并：链上有后继（且后继也在列表里）的旧会话不单列；留下的那条用链上最早的真标题。顺序沿用原生目录。
    另外：作废换会话留下的空会话（标题「接着上次聊」、没有前任、一句话没有）不单列——里面什么都没有，服务端下次换会话会复用它。 */
export function mergeChainRows(rows, state) {
    const ids = new Set(rows.map(row => row.id));
    const prev = predecessorMap(state);
    const hidden = new Set();
    for (const [to, from] of prev)
        if (ids.has(to) && ids.has(from))
            hidden.add(from);
    for (const row of rows)
        if (row.blank === true && row.title === ROLLOVER_TITLE && !prev.has(row.id))
            hidden.add(row.id);
    const titles = new Map(rows.map(row => [row.id, row.title]));
    return rows.filter(row => !hidden.has(row.id)).map(row => {
        const chain = chainBefore(row.id, state).filter(id => ids.has(id));
        const title = [...chain, row.id].map(id => titles.get(id)).find(meaningful);
        return title === undefined || title === row.title ? row : { ...row, title };
    });
}
function eventOf(record) {
    if (!record || typeof record !== 'object')
        return undefined;
    const r = record;
    if (r.type === 'event' && r.event && typeof r.event === 'object')
        return r.event;
    return r;
}
function imageRef(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const a = value;
    if (typeof a.attachmentId !== 'string' || !a.attachmentId)
        return undefined;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
    const out = { attachmentId: a.attachmentId };
    if (typeof a.mediaType === 'string')
        out.mediaType = a.mediaType;
    if (typeof a.name === 'string')
        out.name = a.name;
    const w = num(a.width), h = num(a.height), b = num(a.bytes);
    if (w !== undefined)
        out.width = w;
    if (h !== undefined)
        out.height = h;
    if (b !== undefined)
        out.bytes = b;
    return out;
}
/** 正文 + 图片：有附件引用的图片收进 refs；没有引用（取不回来）的只计数，留给占位。 */
export function textBlocks(content) {
    if (typeof content === 'string')
        return { text: content, images: 0, refs: [] };
    if (!Array.isArray(content))
        return { text: '', images: 0, refs: [] };
    let text = '';
    let images = 0;
    const refs = [];
    for (const block of content) {
        if (!block || typeof block !== 'object')
            continue;
        const b = block;
        if (b.type === 'text' && typeof b.text === 'string')
            text += (text && !text.endsWith('\n') ? '\n' : '') + b.text;
        else if (b.type === 'image') {
            const ref = imageRef(b.attachment);
            if (ref)
                refs.push(ref);
            else
                images += 1;
        }
    }
    return { text, images, refs };
}
/** 一个会话的可见原话：真用户消息 + 助手正文（同一回合里多步的正文并成一条）。不含推理、工具、接续块、时间行。 */
export function visibleRows(sessionId, records) {
    const rows = [];
    const seen = new Set();
    let lastAssistantTurn;
    for (const record of records) {
        const event = eventOf(record);
        if (!event || typeof event.type !== 'string')
            continue;
        const data = (event.data ?? {});
        if (event.type === 'user/message') {
            const source = data.source;
            if (source?.kind !== 'user')
                continue;
            const id = typeof data.id === 'string' ? data.id : `seq-${String(event.seq)}`;
            if (seen.has(id))
                continue;
            seen.add(id);
            const { text, images, refs } = textBlocks(data.content);
            /* 只有取不回来的图片（记录里没有附件引用）才写占位；有引用的交给 renderRow 画成图集。 */
            const body = [text.trim(), images > 0 ? '〔图片〕'.repeat(Math.min(images, 4)) : ''].filter(Boolean).join('\n');
            if (!body && !refs.length)
                continue;
            rows.push({ key: `${sessionId}:${String(event.seq)}`, sessionId, role: 'user', text: body, ...(refs.length ? { images: refs } : {}), ...(typeof event.time === 'number' ? { at: event.time } : {}) });
            lastAssistantTurn = undefined;
            continue;
        }
        if (event.type === 'tool/result') {
            const meta = readWorkToolMeta(data.meta);
            if (!meta || (!meta.works.length && !meta.candidates.length) || data.message?.isError)
                continue;
            const key = sessionId + ':' + String(event.seq);
            if (!seen.has(key)) {
                seen.add(key);
                rows.push({ key, sessionId, role: 'work', text: '', work: meta, ...(typeof event.time === 'number' ? { at: event.time } : {}) });
            }
            lastAssistantTurn = undefined;
            continue;
        }
        if (event.type === 'assistant/message') {
            const message = data.message;
            const { text } = textBlocks(message?.content);
            const body = text.trim();
            if (!body)
                continue;
            const turn = typeof data.turn === 'number' ? data.turn : undefined;
            const last = rows[rows.length - 1];
            if (last && last.role === 'assistant' && turn !== undefined && turn === lastAssistantTurn) {
                rows[rows.length - 1] = { ...last, text: `${last.text}\n\n${body}` };
            }
            else {
                rows.push({ key: `${sessionId}:${String(event.seq)}`, sessionId, role: 'assistant', text: body, ...(typeof event.time === 'number' ? { at: event.time } : {}) });
            }
            lastAssistantTurn = turn;
        }
    }
    return rows;
}
/** 读一个旧会话的可见原话（最近 maxRows 条）。先探出日志末尾（原生要求 throughSeq 不超过末尾），再往回翻页。 */
export async function loadSessionRows(sessionId, page, maxRows = MAX_ROWS) {
    const address = { kind: 'session', sessionId };
    let through;
    const probe = await page({ address, throughSeq: Number.MAX_SAFE_INTEGER, maxMessages: 1 });
    if (probe.ok) {
        const last = eventOf(probe.value.records[probe.value.records.length - 1]);
        through = typeof last?.seq === 'number' ? last.seq : undefined;
    }
    else {
        const m = /past cursor (-?\d+)/.exec(String(probe.error?.message ?? ''));
        through = m ? Number(m[1]) : undefined;
    }
    if (through === undefined || !Number.isSafeInteger(through) || through < 0)
        return [];
    let records = [];
    let before;
    for (let pageNo = 0; pageNo < 10; pageNo += 1) {
        const res = await page({ address, throughSeq: through, maxMessages: 200, ...(before === undefined ? {} : { beforeSeq: before }) });
        if (!res.ok)
            break;
        const got = res.value.records;
        if (!got.length)
            break;
        records = [...got, ...records];
        const first = eventOf(got[0]);
        if (!res.value.hasMore || typeof first?.seq !== 'number' || first.seq <= 0)
            break;
        if (visibleRows(sessionId, records).length >= maxRows)
            break;
        before = first.seq;
    }
    return visibleRows(sessionId, records).slice(-maxRows);
}
/** 前文来源：链来自跟随接口，原话来自 session/page；每个旧会话的原话缓存 5 分钟。 */
export function createChainSource(deps) {
    const now = deps.now ?? (() => Date.now());
    const ttl = deps.ttlMs ?? 5 * 60_000;
    let state = null;
    let loadedAt = 0;
    const cache = new Map();
    const rowsOf = (id) => {
        const hit = cache.get(id);
        if (hit && now() - hit.at < ttl)
            return hit.rows;
        const rows = loadSessionRows(id, deps.page).catch(() => []);
        cache.set(id, { at: now(), rows });
        return rows;
    };
    return {
        state: () => state,
        setState(next) { state = next; loadedAt = now(); },
        async rowsFor(sessionId) {
            if (!state || now() - loadedAt > 60_000) {
                const next = await deps.load().catch(() => null);
                if (next) {
                    state = next;
                    loadedAt = now();
                }
            }
            const chain = deps.before ? deps.before(sessionId, state) : chainBefore(sessionId, state);
            if (!chain.length)
                return [];
            const parts = await Promise.all(chain.map(rowsOf));
            return (deps.before ? mergeByTime(parts) : parts.flat()).slice(-MAX_ROWS);
        },
    };
}
/* ---------------- 页面挂载（纯 DOM，不进原生状态） ---------------- */
const STYLE_ID = 'dot-chain-history-style';
const STYLE = `
[data-conversation-scroll]:has(> [data-dot-chain-history][data-rows]) { justify-content: flex-start !important; }
[data-dot-chain-history] { flex: none; margin-top: auto; box-sizing: border-box; overflow-anchor: none; }
[data-dot-chain-history]:not([data-rows]) { display: none; }
[data-dot-chain-history] .dotChain_column { width: 100%; max-width: var(--dsh-chat-content-width, 748px); margin: 0 auto; display: flex; flex-direction: column; }
[data-dot-chain-history] .dotChain_column > * + * { margin-top: var(--dsh-chat-flow-gap, 6px); }
[data-dot-chain-history] [data-chat-flow-kind] { animation: none !important; }
[data-dot-chain-history] .dotChain_userRow { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
[data-dot-chain-history] .dotChain_images { display: flex; justify-content: flex-end; width: 100%; }
[data-dot-chain-history] .dotChain_images + .dotChain_bubble { margin-top: 6px; }
[data-dot-chain-history] .dotChain_userStack { min-width: 0; max-width: min(calc(var(--dsh-chat-content-width, 748px) * .702), 82%); display: flex; flex-direction: column; align-items: flex-end; }
[data-dot-chain-history] .dotChain_bubble { max-width: 100%; white-space: pre-wrap; word-break: break-word; padding: 10px 16px; font-size: var(--dsh-content-font-size, 14px); line-height: calc(22px + var(--dsh-content-font-delta, 0px)); color: var(--dsw-alias-label-primary); background: var(--dsw-specific-bubble); border-radius: var(--dsw-radius-xl); }
[data-dot-chain-history] .dotChain_md { word-break: break-word; }
[data-dot-chain-history] .dotChain_md p, [data-dot-chain-history] .dotChain_md ul, [data-dot-chain-history] .dotChain_md ol, [data-dot-chain-history] .dotChain_md pre, [data-dot-chain-history] .dotChain_md h4 { margin: 0 0 .6em; }
[data-dot-chain-history] .dotChain_md > :last-child { margin-bottom: 0; }
[data-dot-chain-history] .dotChain_md h4 { font-size: 1em; font-weight: 600; }
[data-dot-chain-history] .dotChain_md pre { white-space: pre-wrap; overflow-x: auto; padding: 8px 10px; border-radius: 8px; background: #0000002e; }
[data-dot-chain-history] .dotChain_md code { font-family: var(--dot-font-mono, ui-monospace, monospace); font-size: .92em; }
[data-dot-chain-history] .dotChain_md a { color: inherit; text-decoration: underline; }
[class*="_conversationReading"]:has([data-dot-chain-history][data-rows]) [class*="_conversationHero"] { display: none !important; }
`;
function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID))
        return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    doc.head.appendChild(style);
}
/** 极简、安全的 Markdown → DOM（只用 textContent，不拼 HTML）：段落、换行、列表、标题、代码块、行内代码、粗体、http(s) 链接。 */
export function renderMarkdown(doc, text) {
    const frag = doc.createDocumentFragment();
    const inline = (parent, s) => {
        const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))/g;
        let at = 0;
        for (let m = re.exec(s); m; m = re.exec(s)) {
            if (m.index > at)
                parent.appendChild(doc.createTextNode(s.slice(at, m.index)));
            if (m[1]) {
                const el = doc.createElement('code');
                el.textContent = m[1].slice(1, -1);
                parent.appendChild(el);
            }
            else if (m[2]) {
                const el = doc.createElement('strong');
                el.textContent = m[2].slice(2, -2);
                parent.appendChild(el);
            }
            else if (m[3] && m[4]) {
                const el = doc.createElement('a');
                el.textContent = m[3].slice(1, m[3].indexOf(']('));
                el.setAttribute('href', m[4]);
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
                parent.appendChild(el);
            }
            at = m.index + m[0].length;
        }
        if (at < s.length)
            parent.appendChild(doc.createTextNode(s.slice(at)));
    };
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let para = [];
    let list = null;
    const flushPara = () => {
        if (!para.length)
            return;
        const p = doc.createElement('p');
        para.forEach((line, i) => { if (i)
            p.appendChild(doc.createElement('br')); inline(p, line); });
        frag.appendChild(p);
        para = [];
    };
    const flushList = () => { if (list) {
        frag.appendChild(list.el);
        list = null;
    } };
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (/^```/.test(line.trim())) {
            flushPara();
            flushList();
            const code = [];
            for (i += 1; i < lines.length && !/^```/.test((lines[i] ?? '').trim()); i += 1)
                code.push(lines[i] ?? '');
            const pre = doc.createElement('pre');
            pre.setAttribute('data-dot-fence-language', line.trim().slice(3).trim().split(/\s+/)[0] ?? '');
            const el = doc.createElement('code');
            el.textContent = code.join('\n');
            pre.appendChild(el);
            frag.appendChild(pre);
            continue;
        }
        if (!line.trim()) {
            flushPara();
            flushList();
            continue;
        }
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) {
            flushPara();
            flushList();
            const h = doc.createElement('h4');
            inline(h, heading[1] ?? '');
            frag.appendChild(h);
            continue;
        }
        const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
        const ordered = /^\s*\d+[.)、]\s+(.*)$/.exec(line);
        if (bullet || ordered) {
            flushPara();
            const isOrdered = Boolean(ordered);
            if (!list || list.ordered !== isOrdered) {
                flushList();
                list = { el: doc.createElement(isOrdered ? 'ol' : 'ul'), ordered: isOrdered };
            }
            const li = doc.createElement('li');
            inline(li, (bullet ?? ordered)?.[1] ?? '');
            list.el.appendChild(li);
            continue;
        }
        flushList();
        para.push(line);
    }
    flushPara();
    flushList();
    return frag;
}
/** 一条前文的 DOM：结构对齐原生（data-chat-flow-kind=user / assistant-step），好让对话空间现有皮肤直接套上。
    用户消息带图片时：有 mountImages 就在气泡上方挂图集（原生也是图在上、字在下）；没有就退回〔图片〕占位。 */
export function renderRow(doc, row, mountImages, mounts) {
    const item = doc.createElement('div');
    item.setAttribute('data-dot-chain-row', '');
    item.setAttribute('data-dot-source-session', row.sessionId);
    item.setAttribute('data-chat-anchor-key', `dot-chain:${row.key}`);
    if (row.role === 'user') {
        item.setAttribute('data-chat-flow-kind', 'user');
        const userRow = doc.createElement('div');
        userRow.className = 'dotChain_userRow';
        const stack = doc.createElement('div');
        stack.className = 'dotChain_userStack';
        let text = row.text;
        if (row.images?.length) {
            if (mountImages) {
                const pics = doc.createElement('div');
                pics.className = 'dotChain_images';
                pics.setAttribute('data-dot-chain-images', String(row.images.length));
                stack.appendChild(pics);
                try {
                    const dispose = mountImages(pics, row.images, row.sessionId);
                    mounts?.set(pics, dispose);
                }
                catch {
                    pics.remove();
                    text = [text, '〔图片〕'.repeat(Math.min(row.images.length, 4))].filter(Boolean).join('\n');
                }
            }
            else
                text = [text, '〔图片〕'.repeat(Math.min(row.images.length, 4))].filter(Boolean).join('\n');
        }
        if (text) {
            const bubble = doc.createElement('div');
            bubble.className = 'dotChain_bubble';
            bubble.textContent = text;
            stack.appendChild(bubble);
        }
        userRow.appendChild(stack);
        item.appendChild(userRow);
    }
    else {
        item.setAttribute('data-chat-flow-kind', 'assistant-step');
        const node = doc.createElement('div');
        node.setAttribute('data-slot', 'conversation.chat.node');
        node.className = 'dotChain_md';
        node.appendChild(renderMarkdown(doc, row.text));
        item.appendChild(node);
    }
    if (doc.documentElement.hasAttribute('data-lite-theme'))
        item.appendChild(historyActions(doc, row.text));
    return item;
}
const SCROLL_SELECTOR = 'section[aria-label="对话空间"] [data-conversation-scroll]';
/** 把前文挂到原生滚动区最前面；会话换了就换内容；原生重绘挤掉了就重挂。 */
export function installChainHistory(deps) {
    const doc = deps.doc ?? document;
    const selector = deps.scrollSelector ?? SCROLL_SELECTOR;
    const win = doc.defaultView;
    ensureStyle(doc);
    let stopped = false;
    let frame = 0;
    let generation = 0;
    const cardMounts = new Map();
    const rendered = new Map();
    const note = (reason, session, rows) => deps.trace?.({ at: Date.now(), ...(session ? { session } : {}), ...(rows !== undefined ? { rows } : {}), reason });
    const align = (scroller, host) => {
        /* 和原生消息列（有就用它）或输入框（新会话还没有消息列时）左右对齐。 */
        const nativeItem = Array.from(scroller.querySelectorAll('[data-chat-flow-kind]')).find(el => !host.contains(el));
        const ref = nativeItem?.parentElement ?? scroller.querySelector('[data-composer-card]');
        if (!ref)
            return;
        const outer = scroller.getBoundingClientRect();
        const inner = ref.getBoundingClientRect();
        if (inner.width <= 0 || outer.width <= 0)
            return;
        const column = host.firstElementChild;
        host.style.paddingLeft = `${Math.max(0, Math.round(inner.left - outer.left))}px`;
        host.style.paddingRight = `${Math.max(0, Math.round(outer.right - inner.right - (scroller.offsetWidth - scroller.clientWidth)))}px`;
        if (column)
            column.style.maxWidth = `${Math.round(inner.width)}px`;
    };
    const paint = (scroller, host, rows) => {
        const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
        const prevTop = scroller.scrollTop;
        const prevHeight = scroller.scrollHeight;
        const hasNative = Array.from(scroller.querySelectorAll('[data-chat-flow-kind]')).some(el => !host.contains(el));
        /* 重画前卸掉这块里旧的 React 挂载（工作卡、图集），免得泄漏。 */
        for (const [node, dispose] of Array.from(cardMounts))
            if (host.contains(node) || !node.isConnected) {
                cardMounts.delete(node);
                try {
                    dispose();
                }
                catch { /* 已卸 */ }
            }
        const column = doc.createElement('div');
        column.className = 'dotChain_column';
        for (const row of rows) {
            if (row.role !== 'work') {
                column.appendChild(renderRow(doc, row, deps.mountImages, cardMounts));
                continue;
            }
            if (!row.work || !deps.mountWork)
                continue;
            const card = doc.createElement('div');
            card.setAttribute('data-dot-chain-work', row.key);
            column.appendChild(card);
            cardMounts.set(card, deps.mountWork(card, row.work));
        }
        host.replaceChildren(column);
        host.setAttribute('data-painted', host.getAttribute('data-session') ?? '');
        if (rows.length)
            host.setAttribute('data-rows', String(rows.length));
        else
            host.removeAttribute('data-rows');
        align(scroller, host);
        const delta = scroller.scrollHeight - prevHeight;
        if (!hasNative || atBottom)
            scroller.scrollTop = scroller.scrollHeight;
        else if (Math.abs(scroller.scrollTop - (prevTop + delta)) > 2)
            scroller.scrollTop = prevTop + delta;
    };
    const sync = () => {
        frame = 0;
        if (stopped)
            return;
        for (const scroller of Array.from(doc.querySelectorAll(selector))) {
            const sid = scroller.closest('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? '';
            let host = scroller.querySelector(':scope > [data-dot-chain-history]');
            if (host && scroller.firstElementChild !== host)
                scroller.insertBefore(host, scroller.firstElementChild);
            if (!sid) {
                if (host) {
                    host.replaceChildren();
                    host.removeAttribute('data-rows');
                    host.removeAttribute('data-session');
                }
                continue;
            }
            if (!host) {
                host = doc.createElement('div');
                host.setAttribute('data-dot-chain-history', '');
                host.setAttribute('aria-label', '之前的对话');
                scroller.insertBefore(host, scroller.firstElementChild);
            }
            if (host.getAttribute('data-session') === sid) {
                const known = rendered.get(sid);
                if (known && host.childElementCount === 0 && known.length)
                    paint(scroller, host, known);
                else if (host.hasAttribute('data-rows'))
                    align(scroller, host);
                continue;
            }
            host.setAttribute('data-session', sid);
            /* 同一会话重拼（链变了）时先留着旧内容，新内容到了再换，避免闪一下。 */
            if (host.getAttribute('data-painted') !== sid) {
                host.replaceChildren();
                host.removeAttribute('data-rows');
                host.removeAttribute('data-painted');
            }
            const known = rendered.get(sid);
            if (known) {
                paint(scroller, host, known);
                continue;
            }
            const mine = generation;
            const target = host;
            void deps.rowsFor(sid).then(rows => {
                if (stopped || mine !== generation)
                    return;
                rendered.set(sid, rows);
                if (!target.isConnected || target.getAttribute('data-session') !== sid) {
                    schedule();
                    return;
                }
                paint(scroller, target, rows);
                note(rows.length ? 'stitched' : 'no-chain', sid, rows.length);
            }, () => note('load-failed', sid));
        }
    };
    const schedule = () => { if (!frame && !stopped)
        frame = win?.requestAnimationFrame ? win.requestAnimationFrame(sync) : setTimeout(sync, 16); };
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(records => {
        /* 只关心：滚动区出现/被换掉、会话编号变化、我们自己的块被挤掉。 */
        for (const r of records) {
            if (r.type === 'attributes') {
                schedule();
                return;
            }
            for (const n of Array.from(r.addedNodes))
                if (n instanceof Element && (n.matches('[data-conversation-scroll], [data-conversation-session]') || n.querySelector('[data-conversation-scroll]'))) {
                    schedule();
                    return;
                }
            for (const n of Array.from(r.removedNodes))
                if (n instanceof Element && (n.matches('[data-dot-chain-history], [data-conversation-scroll]') || n.querySelector('[data-dot-chain-history]'))) {
                    schedule();
                    return;
                }
            if (r.target instanceof Element && r.target.matches('[data-conversation-scroll]')) {
                schedule();
                return;
            }
        }
    }) : undefined;
    observer?.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-conversation-session'] });
    const onResize = () => {
        for (const host of Array.from(doc.querySelectorAll('[data-dot-chain-history][data-rows]'))) {
            const scroller = host.parentElement;
            if (scroller)
                align(scroller, host);
        }
    };
    win?.addEventListener('resize', onResize);
    schedule();
    return {
        /** 换会话链变了：丢掉已拼好的前文，按新链重拼。 */
        refresh() {
            generation += 1;
            rendered.clear();
            for (const host of Array.from(doc.querySelectorAll('[data-dot-chain-history]')))
                host.removeAttribute('data-session');
            schedule();
        },
        stop() {
            stopped = true;
            observer?.disconnect();
            for (const dispose of cardMounts.values())
                dispose();
            cardMounts.clear();
            win?.removeEventListener('resize', onResize);
            if (frame) {
                win?.cancelAnimationFrame?.(frame);
                clearTimeout(frame);
            }
            for (const host of Array.from(doc.querySelectorAll('[data-dot-chain-history]')))
                host.remove();
        },
    };
}
