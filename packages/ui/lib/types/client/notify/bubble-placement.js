/* ================================================================
   DOT 精灵气泡定位 · 纯函数
   ▍规则
   ① 气泡跟着精灵当前位置走，放在精灵旁边，不压住精灵本身。
   ② 先试离屏幕边更远的一侧（精灵靠右就放左边），放不下换另一侧；
      两侧都放不下（窄屏 + 精灵居中）就放到精灵上方或下方，哪边空间大放哪边。
   ③ 始终不出界：坐标夹在视口内，高度放不下时给出 maxHeight 让气泡内部滚动。
   ④ tail 是小尖角相对气泡组的位置，指向精灵中心。
   *更新：2026-10-24 · 建立*
================================================================ */
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
export function placeBubbles(sprite, stack, viewport, options = {}) {
    const gap = options.gap ?? 10;
    const margin = options.margin ?? 8;
    const right = sprite.left + sprite.width;
    const bottom = sprite.top + sprite.height;
    const centerX = sprite.left + sprite.width / 2;
    const centerY = sprite.top + sprite.height / 2;
    const space = {
        left: sprite.left - gap - margin,
        right: viewport.width - right - gap - margin,
        above: sprite.top - gap - margin,
        below: viewport.height - bottom - gap - margin,
    };
    const preferred = centerX > viewport.width / 2 ? 'left' : 'right';
    const other = preferred === 'left' ? 'right' : 'left';
    const side = stack.width <= space[preferred] ? preferred
        : stack.width <= space[other] ? other
            : (stack.height <= space.above || space.above >= space.below) ? 'above' : 'below';
    if (side === 'left' || side === 'right') {
        const maxHeight = Math.max(0, viewport.height - margin * 2);
        const height = Math.min(stack.height, maxHeight);
        // 顶边先和精灵顶边对齐（气泡像从精灵头边冒出来），再夹进视口。
        const top = clamp(Math.min(sprite.top, centerY - 22), margin, viewport.height - margin - height);
        const left = side === 'left' ? sprite.left - gap - stack.width : right + gap;
        return { left: clamp(left, margin, viewport.width - margin - stack.width), top, side, maxHeight, tail: clamp(centerY - top, 14, height - 14) };
    }
    const maxHeight = Math.max(0, space[side]);
    const height = Math.min(stack.height, maxHeight);
    const left = clamp(centerX - stack.width / 2, margin, viewport.width - margin - stack.width);
    const top = side === 'above' ? Math.max(margin, sprite.top - gap - height) : bottom + gap;
    return { left, top, side, maxHeight, tail: clamp(centerX - left, 14, stack.width - 14) };
}
/** 判断两个矩形是否重叠（测试和截图核对用）。 */
export function rectsOverlap(a, b) {
    return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}
