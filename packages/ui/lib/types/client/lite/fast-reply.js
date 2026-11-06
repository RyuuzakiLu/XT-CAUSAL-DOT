/** 在原生 Markdown 上遮住尚未读到的字，不替换正文或其节点。 */
export function createFastReply() {
    let card = null;
    let key = '';
    let visible = 1;
    let last = 0;
    let frame = 0;
    let nodes = [];
    let length = 0;
    let mask;
    const clearMask = () => {
        if (mask && CSS.highlights.get('dot-reply-pending') === mask)
            CSS.highlights.delete('dot-reply-pending');
        mask = undefined;
        card?.style.removeProperty('--dot-reply-reveal-height');
        card?.removeAttribute('data-dot-reply-writing');
    };
    const stop = () => {
        if (frame)
            cancelAnimationFrame(frame);
        frame = 0;
        clearMask();
        card = null;
        nodes = [];
    };
    const paint = () => {
        frame = 0;
        if (!card?.isConnected) {
            stop();
            return;
        }
        const now = performance.now();
        // 普通中文约每秒 90 字，遇到整段一次到达时加速追上。
        visible = Math.min(length, visible + Math.min(64, now - last) * Math.max(90, length / 1.1) / 1000);
        last = now;
        if (visible >= length) {
            clearMask();
            return;
        }
        let offset = Math.floor(visible);
        for (const node of nodes) {
            if (offset >= node.length) {
                offset -= node.length;
                continue;
            }
            if (offset && /[\uDC00-\uDFFF]/.test(node.data[offset] ?? ''))
                offset++;
            const suffix = document.createRange();
            suffix.selectNodeContents(card);
            suffix.setStart(node, offset);
            if (!mask) {
                mask = new Highlight();
                CSS.highlights.set('dot-reply-pending', mask);
            }
            mask.clear();
            mask.add(suffix);
            const cursor = suffix.cloneRange();
            cursor.collapse(true);
            const line = cursor.getBoundingClientRect();
            if (line.height) {
                card.style.setProperty('--dot-reply-reveal-height', Math.ceil(line.bottom - card.getBoundingClientRect().top + 12) + 'px');
                card.setAttribute('data-dot-reply-writing', '');
            }
            break;
        }
        frame = requestAnimationFrame(paint);
    };
    return {
        stop,
        update(next, id) {
            if (typeof Highlight === 'undefined' || !globalThis.CSS?.highlights)
                return;
            if (next !== card) {
                stop();
                card = next;
            }
            if (id !== key) {
                key = id;
                visible = 1;
            }
            if (!frame)
                last = performance.now();
            else
                cancelAnimationFrame(frame);
            nodes = [];
            length = 0;
            const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                nodes.push(n);
                length += n.length;
            }
            paint();
        },
    };
}
