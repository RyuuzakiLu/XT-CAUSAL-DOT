// Read-only replay. Records are scoped before matching, including explicit IDs.
import { createHash } from 'node:crypto';
import { matchScore } from "./work-match.js";
export function resolveShadow(actor, input, facts, canReceive) {
    const visible = actor ? facts.filter(f => f.owner === actor) : [];
    const text = input.text.trim();
    const fresh = /^(另起|另外新建|新建|换个话题)/;
    const mixed = /顺便|同时|另外再|再帮我/;
    const adjustment = /改成|改为|修改|调整|加上|补充|改一下|换成|(?:接着|继续|再)(?:排查|查|修)/;
    const hold = /(?:不要|别|先不|暂不)(?:再)?(?:改|调|加|补|换|查|修)|保留现状|要不要|先.{0,6}(?:建议|讨论)|仅讨论/;
    const scored = visible.map(f => {
        const names = [f.title, f.goal].filter((value) => Boolean(value))
            .flatMap(value => {
            const first = value.split(/[。！？；，,\n]/u, 1)[0].trim();
            return [first, first.replace(/^(?:请)?(?:整理|制作|撰写|生成|编写|翻译|修复|核对|检查)\s*/, '')];
        });
        const exact = names.filter(name => name.length >= 3 && text.includes(name));
        return { f, named: exact.length > 0, score: exact.length ? 20 + Math.max(...exact.map(name => name.length)) : matchScore(f, text) };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.f.id.localeCompare(b.f.id));
    const named = scored.filter(x => x.named);
    const target = input.explicitWorkId ? visible.find(f => f.id === input.explicitWorkId) :
        named.length === 1 ? named[0].f : undefined;
    const decide = (action, f, interactionRef) => {
        const revision = f?.revision;
        const resolutionId = createHash('sha256').update(JSON.stringify([actor, input.sourceSessionRef, input.sourceMessageId, text, input.explicitWorkId, input.interactionRef, action, f?.id, revision, interactionRef])).digest('hex');
        return { action, workId: f?.id, expectedWorkRevision: revision, expectedState: f?.status, interactionRef, resolutionId,
            requiresConfirmation: action === 'clarify' || action === 'retry',
            candidates: action === 'clarify' && !input.explicitWorkId ? (named.length ? named : scored).slice(0, 5).map(({ f }) => ({ workId: f.id, state: f.status, title: f.goal.slice(0, 100) })) : [] };
    };
    if (!actor || !text || !input.sourceSessionRef || !input.sourceMessageId || mixed.test(text) || hold.test(text))
        return decide('clarify');
    if (!input.explicitWorkId && fresh.test(text))
        return decide('new');
    if (!target)
        return decide('clarify');
    const ref = target.blocked?.action?.requestId;
    if (target.status === 'waiting-approval' || target.status === 'waiting-input') {
        if (ref && (!input.interactionRef || input.interactionRef === ref))
            return decide('existing-interaction', target, ref);
        return decide('clarify');
    }
    if (target.status === 'failed' && /重试|重新执行/.test(text))
        return decide('retry', target);
    if (!adjustment.test(text))
        return decide('clarify');
    if (target.status === 'succeeded')
        return decide('followup', target);
    if ((target.status === 'running' || target.status === 'queued') && canReceive(target.id))
        return decide('supplement', target);
    return decide('clarify');
}
