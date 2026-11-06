// Internal acceptance boundary. The service supplies a trusted actor and validates
// the target while holding its work lock. The entire replay command is one put.
import { createHash, randomUUID } from 'node:crypto';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
const name = z.string().min(1);
const targetSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('supplement'), workId: name, sessionId: name, generation: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal('followup'), workId: name, parentRevision: z.number().int().positive(), newWorkId: name }).strict(),
]);
const entrySchema = z.object({
    accountId: name, inputId: name, sessionRef: name, messageId: name, key: name, resolutionId: name,
    text: name, target: targetSchema, state: z.enum(['accepted', 'materialized', 'delivered']), createdAt: name,
    attempts: z.number().int().nonnegative().optional(), lastError: z.string().optional(),
}).strict();
export const inputDomain = defineDomain({
    name: 'dot_work_inputs', version: 1,
    tables: { commands: domainTable(entrySchema) },
});
const writers = new WeakMap();
export function inputIdOf(actor, session, message, key) {
    return createHash('sha256').update(JSON.stringify([actor, session, message, key])).digest('hex');
}
export function acceptInput(domain, actor, source, validateTarget) {
    const task = (writers.get(domain) ?? Promise.resolve()).then(async () => {
        if (![actor, source.sessionRef, source.messageId, source.key, source.resolutionId, source.text].every(v => typeof v === 'string' && v.trim().length > 0)) {
            throw new Error('invalid-input');
        }
        const inputId = inputIdOf(actor, source.sessionRef, source.messageId, source.key);
        const commands = domain.table('commands');
        const previous = commands.get(inputId);
        if (previous) {
            if (previous.text !== source.text || previous.resolutionId !== source.resolutionId)
                throw new Error('input-conflict');
            return previous;
        }
        const checked = validateTarget();
        const pending = [...commands.entries()].map(([, entry]) => entry).filter(e => e.accountId === actor && e.state === 'accepted');
        if (pending.length >= 32 || pending.filter(e => e.target.workId === checked.workId).length >= 8)
            throw new Error('input-backpressure');
        const target = checked.kind === 'followup' ? { ...checked, newWorkId: 'work-' + randomUUID() } : checked;
        const entry = entrySchema.parse({ ...source, accountId: actor, inputId, target, state: 'accepted', createdAt: new Date().toISOString() });
        await commands.put(inputId, entry);
        return entry;
    });
    writers.set(domain, task.then(() => undefined, () => undefined));
    return task;
}
// A single in-flight delivery per command. Other work can make progress concurrently.
const deliveries = new WeakMap();
export function materializeInput(domain, actor, inputId, apply) {
    const commands = domain.table('commands');
    const owned = commands.get(inputId);
    if (!owned || owned.accountId !== actor)
        return Promise.reject(new Error('input-not-found'));
    const active = deliveries.get(domain) ?? new Map();
    deliveries.set(domain, active);
    const inflight = active.get(inputId);
    if (inflight)
        return inflight;
    const task = Promise.resolve().then(async () => {
        const entry = commands.get(inputId);
        if (entry.state === 'delivered' || entry.state === 'materialized')
            return entry;
        const { lastError: _lastError, ...previous } = entry;
        const attempt = { ...previous, attempts: (entry.attempts ?? 0) + 1 };
        await commands.put(inputId, attempt);
        try {
            await apply(attempt);
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : 'delivery-unavailable';
            const known = ['stale-generation', 'stale-resolution', 'target-not-ready', 'input-not-found'];
            await commands.put(inputId, { ...attempt, lastError: known.includes(reason) ? reason : 'delivery-unavailable' });
            throw error;
        }
        const state = entry.target.kind === 'followup' ? 'materialized' : 'delivered';
        const next = { ...attempt, state };
        await commands.put(inputId, next);
        return next;
    }).finally(() => { active.delete(inputId); });
    active.set(inputId, task);
    return task;
}
