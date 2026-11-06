export declare const ASTRA_THINKING: readonly ["ASTRA 正在想", "稍等，让我想清楚", "思路还在路上", "这件事，值得认真一点", "别急，答案不能靠猜"];
export declare function astraThinking(now?: number): string;
export declare function createAstraChatCopy(clock?: () => number): Record<string, string>;
export declare const ASTRA_CONNECTION_COPY: {
    readonly 'connection.connecting': "正在接回 ASTRA…";
    readonly 'connection.connected': "ASTRA 已连接";
    readonly 'connection.error': "暂时没连上 ASTRA，请重试";
    readonly 'connection.reconnect': "与 ASTRA 的连接断了，点此重连";
    readonly 'connection.restart': "正在重新连接 ASTRA，也可以点此重试";
    readonly 'hostRelease.title': "DOT 已更新";
    readonly 'hostRelease.description': "DOT 服务已更新，准备好后刷新，加载新的界面。";
    readonly 'hostRelease.reload': "刷新 DOT";
};
export declare const ASTRA_WAIT_CSS = "\n/* \u539F\u751F\u8FD0\u884C\u72B6\u6001\u4FDD\u7559\u8BED\u4E49\u548C\u8BA1\u65F6\uFF0C\u53EA\u628A\u9CB8\u5C3E\u6362\u6210\u540C\u8272\u516B\u89D2\u661F\u3002 */\n[data-chat-running] [class*=\"runningIcon\"] > * { display:none !important; }\n[data-chat-running] [class*=\"runningIcon\"]::before { content:\"\u2726\"; color:#d9bc7c; font-size:18px; line-height:1; }\n[data-chat-running] [class*=\"runningText\"] { color:#d9bc7c; }\n";
