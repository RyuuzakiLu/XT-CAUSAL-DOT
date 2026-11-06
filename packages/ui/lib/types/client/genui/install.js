import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createRoot } from 'react-dom/client';
import { setGenuiAssetBase } from '@changfenhuang/dsh-genui/embed';
import { GenuiView, parseSpec } from "./GenuiView.js";
import { attachGenuiStyles } from "./styles.js";
import { actionMessage, fingerprint, sourceSession } from "./identity.js";
const BLOCKS = '.md-code-block, .code-block, .code-block-small, pre[data-dot-fence-language]';
const EXCLUDED = '[data-chat-group-part="reasoning"], [data-tool], [data-dot-genui-card], [data-sidebar-chat], [data-panel-conversation]';
function isGenui(block) {
    if (block.dataset.dotFenceLanguage === 'dsh-ui')
        return true;
    const banner = block.querySelector('[data-code-block-banner]') ?? block;
    return [...banner.querySelectorAll('div, span')].some(el => !el.children.length && !el.closest('pre,code') && el.textContent?.trim() === 'dsh-ui');
}
export function installGenuiFences(sendTo, doc = document) {
    const mounts = new Map();
    let scheduled = false, stopped = false;
    const remove = (block, mount) => {
        mount.root.unmount();
        mount.host.remove();
        if (mount.display)
            block.style.setProperty('display', mount.display, mount.priority);
        else
            block.style.removeProperty('display');
        mounts.delete(block);
    };
    const scan = () => {
        scheduled = false;
        if (stopped)
            return;
        for (const [block, mount] of mounts) {
            if (!block.isConnected || block.closest(EXCLUDED) || !block.closest('[data-chat-flow-kind="assistant-step"]') || !isGenui(block))
                remove(block, mount);
        }
        const candidates = new Set(doc.querySelectorAll(BLOCKS));
        for (const content of doc.querySelectorAll('[data-code-block-content]'))
            if (content.parentElement)
                candidates.add(content.parentElement);
        for (const block of candidates) {
            if (block.closest(EXCLUDED) || !block.closest('[data-chat-flow-kind="assistant-step"]') || !isGenui(block))
                continue;
            const code = block.matches('pre') ? block : block.querySelector('pre');
            const raw = code?.textContent ?? '';
            let value;
            try {
                value = JSON.parse(raw);
            }
            catch {
                const old = mounts.get(block);
                if (old)
                    remove(block, old);
                continue;
            }
            const spec = parseSpec(value);
            if (!spec) {
                const old = mounts.get(block);
                if (old)
                    remove(block, old);
                continue;
            }
            const owner = sourceSession(block);
            const row = block.closest('[data-chat-anchor-key]') ?? block.closest('[data-chat-flow-kind="assistant-step"]');
            const anchor = row.getAttribute('data-chat-anchor-key') ?? '';
            const ordinal = [...row.querySelectorAll(BLOCKS)].indexOf(block);
            const stateKey = `dot-genui:${owner?.id ?? 'unowned'}:${anchor}:${ordinal}:${fingerprint(raw)}`;
            const signature = `${stateKey}:${owner?.readOnly}:${raw}`;
            let mount = mounts.get(block);
            if (!mount) {
                const host = doc.createElement('div');
                host.dataset.dotGenuiMount = '';
                mount = { host, root: createRoot(host), signature: '', display: block.style.getPropertyValue('display'), priority: block.style.getPropertyPriority('display') };
                mounts.set(block, mount);
            }
            if (block.nextSibling !== mount.host)
                block.after(mount.host);
            if (block.style.getPropertyValue('display') !== 'none')
                block.style.setProperty('display', 'none', 'important');
            if (mount.signature === signature)
                continue;
            mount.signature = signature;
            const send = owner && !owner.readOnly && anchor ? async (action, payload) => {
                const now = sourceSession(block);
                if (!block.isConnected || !now || now.readOnly || now.id !== owner.id)
                    throw new Error('Card owner changed');
                await sendTo(owner.id)(action, payload);
            } : undefined;
            mount.root.render(_jsx(GenuiView, { spec: spec, stateKey: stateKey, send: send, readOnly: owner?.readOnly ?? false }, stateKey));
        }
    };
    const schedule = () => { if (!scheduled && !stopped) {
        scheduled = true;
        queueMicrotask(scan);
    } };
    const observer = new MutationObserver(records => {
        // Ignore our own React commits; otherwise the observer would schedule itself forever.
        if (records.some(record => {
            const el = record.target instanceof Element ? record.target : record.target.parentElement;
            return !el?.closest('[data-dot-genui-mount]');
        }))
            schedule();
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-conversation-session', 'data-chat-anchor-key', 'data-code-block-content', 'style'] });
    scan();
    return () => { stopped = true; observer.disconnect(); for (const [block, mount] of mounts)
        remove(block, mount); };
}
export function installGenui(ctx) {
    ctx.effect(attachGenuiStyles, 'dot: GenUI 样式');
    setGenuiAssetBase('/plugins/@changfenhuang/dsh-genui/assets/');
    ctx.inject(['sessions'], scope => {
        const sessions = scope.get('sessions');
        const sendTo = (id) => async (action, payload) => {
            const conversation = sessions.scope(id)?.get('conversation');
            if (!conversation)
                throw new Error('Source conversation unavailable');
            await conversation.send(actionMessage(action, payload));
        };
        scope.effect(() => installGenuiFences(sendTo), 'dot: GenUI 内联卡片');
        const slots = scope.get('slots');
        function ToolView({ block, sessionId }) {
            const spec = parseSpec(block.meta);
            if (!spec)
                return _jsxs("span", { children: ["\u4E92\u52A8\u5361\u7247", block.meta === undefined ? '准备中…' : '格式无效，请重新生成。'] });
            return _jsx(GenuiView, { spec: spec, stateKey: `dot-genui:tool:${sessionId}:${block.callId}:${fingerprint(JSON.stringify(spec))}`, send: sendTo(sessionId) });
        }
        slots.inject('tool.call.toolview', () => slots.register({ name: 'tool.call.toolview', key: 'render_ui' }, ToolView));
    });
}
