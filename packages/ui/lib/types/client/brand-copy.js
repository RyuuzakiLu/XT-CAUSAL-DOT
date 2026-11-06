/* ================================================================
   ASTRA 等待文案 · 总导游图
   ▍这是什么
   复用原生语言包替换等待/重连提示；只改变显示，不冒充任务进度。
   ▍修改铁律
   1. 轮换由原生运行时钟触发，不再挂全页扫描器或轮询器。
   2. 等待语只能表达思考，不能声称已检索、已保存或已完成。
   ▍更新记录
   *更新：2026-10-26 · DOT专属状态词及连接提示*
   ================================================================ */
export const ASTRA_THINKING = [
    'ASTRA 正在想',
    '稍等，让我想清楚',
    '思路还在路上',
    '这件事，值得认真一点',
    '别急，答案不能靠猜',
];
/* 原生对话每秒刷新耗时；取词时跟随刷新，不另建无法回收的计时器。 */
export function astraThinking(now = Date.now()) {
    return ASTRA_THINKING[Math.floor(now / 6000) % ASTRA_THINKING.length];
}
/* 字典 getter 保留原生计时占位符，让读屏提示稳定、可见文案随时钟轻量轮换。 */
export function createAstraChatCopy(clock = Date.now) {
    return {
        'chat.deepDiving': 'ASTRA 正在思考',
        get 'chat.deepDivingFor'() { return `${astraThinking(clock())} · {duration}`; },
        'chat.loadingHistory': '正在翻开对话记录…',
        'chat.loadError': '对话记录暂时没取到：{message}（{code}）',
    };
}
export const ASTRA_CONNECTION_COPY = {
    'connection.connecting': '正在接回 ASTRA…',
    'connection.connected': 'ASTRA 已连接',
    'connection.error': '暂时没连上 ASTRA，请重试',
    'connection.reconnect': '与 ASTRA 的连接断了，点此重连',
    'connection.restart': '正在重新连接 ASTRA，也可以点此重试',
    'hostRelease.title': 'DOT 已更新',
    'hostRelease.description': 'DOT 服务已更新，准备好后刷新，加载新的界面。',
    'hostRelease.reload': '刷新 DOT',
};
export const ASTRA_WAIT_CSS = `
/* 原生运行状态保留语义和计时，只把鲸尾换成同色八角星。 */
[data-chat-running] [class*="runningIcon"] > * { display:none !important; }
[data-chat-running] [class*="runningIcon"]::before { content:"✦"; color:#d9bc7c; font-size:18px; line-height:1; }
[data-chat-running] [class*="runningText"] { color:#d9bc7c; }
`;
