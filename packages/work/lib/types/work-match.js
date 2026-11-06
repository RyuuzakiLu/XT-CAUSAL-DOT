const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
/** 用户问话里常见、却不指向具体工作的词。 */
const FILLER = /(那个|这个|那件|这件|那项|这项|工作|任务|进度|怎么样了?|如何|做到哪了?|到哪了?|了|的|吗|呢|啊|吧)/g;
function normalize(text) {
    return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}
function bigrams(text) {
    const chars = [...text];
    if (chars.length < 2)
        return chars;
    const grams = [];
    for (let index = 0; index < chars.length - 1; index += 1)
        grams.push(chars[index] + chars[index + 1]);
    return grams;
}
/** match 与一项工作的相关度（0 = 无关）。整词命中权重最高，其次中文双字重叠。 */
export function matchScore(work, match) {
    const haystack = normalize(`${work.goal} ${work.stage}`);
    const tokens = match.split(/[\s,，、;；]+/).map(token => normalize(token.replace(FILLER, ''))).filter(Boolean);
    if (!tokens.length || !haystack)
        return 0;
    let score = 0;
    for (const token of tokens) {
        if (haystack.includes(token)) {
            score += 10 + token.length;
            continue;
        }
        const grams = bigrams(token);
        const hit = grams.filter(gram => haystack.includes(gram)).length;
        if (grams.length && hit)
            score += (hit / grams.length) * 6;
    }
    return score;
}
/**
 * 从最近的工作里挑出用户问的那一项。
 * @param works - 按 updatedAt 新→旧排好的快照
 * @param match - 用户原话里描述这项工作的词；可缺
 */
export function pickWorkForQuery(works, match) {
    if (!works.length)
        return { works: [], candidates: [] };
    const active = works.filter(work => !TERMINAL.has(work.status));
    const wanted = match?.trim() ?? '';
    if (!wanted || !normalize(wanted.replace(FILLER, ''))) {
        if (active.length === 1)
            return { works: [active[0]], candidates: [] };
        if (active.length === 0)
            return { works: [works[0]], candidates: [] };
        return { works: [], candidates: active.slice(0, 5) };
    }
    const scored = works.map((work, order) => ({ work, order, score: matchScore(work, wanted) })).filter(item => item.score > 0);
    if (!scored.length)
        return { works: [], candidates: (active.length ? active : works).slice(0, 5) };
    // 同分时，在跑的优先、再新的优先。
    scored.sort((a, b) => b.score - a.score || Number(TERMINAL.has(a.work.status)) - Number(TERMINAL.has(b.work.status)) || a.order - b.order);
    const [top, second] = scored;
    if (!second || top.score >= second.score * 1.5)
        return { works: [top.work], candidates: [] };
    const close = scored.filter(item => item.score >= top.score / 1.5).slice(0, 5);
    return { works: [], candidates: close.map(item => item.work) };
}
