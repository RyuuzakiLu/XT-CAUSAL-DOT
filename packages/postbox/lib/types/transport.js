/* ================================================================
   星邮匣 · 外部渠道适配器

   ▍这是什么
   把"发给飞书"这件事收成一个小接口，默认实现只在**显式配置了 webhook 地址**时才
   真的发请求；没配就是不可用。微信没有任何实现，状态里如实报不可用。

   ▍为什么不在本包里读密钥
   外部凭据属于服务端资产，由装配侧决定放哪里（现有密屿约定）。本包只接受一个
   已经构造好的发送函数/地址；不在代码里查找、不读 secret 文件、不写日志正文。
   —— 像快递柜：柜子只管把包裹放进去，不负责保管你家钥匙。

   ▍修改铁律
   1. 【不】在没有回执时返回 delivered；HTTP 200 只能在飞书返回 `code:0` 时当作
      "已送达"，其余一律 failed 并带原因。
   2. 【不】把 webhook 地址、token 写进日志、错误消息或事件正文。
   3. 【不】重试无限次；重试由调用方按 operationId 显式发起。
   4. 微信：不实现、不模拟。`available:false` + 原因。
   ================================================================ */
/**
 * 构造飞书适配器。
 * 未配置 webhook 时 available() 恒 false，send() 明确拒绝——不假装发过。
 * @param config - 配置
 * @returns 适配器实例
 */
export function createFeishuTransport(config) {
    const url = typeof config.webhookUrl === 'string' ? config.webhookUrl.trim() : '';
    const doFetch = config.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
    const timeoutMs = config.timeoutMs ?? 10_000;
    return {
        channel: 'feishu',
        available: () => url.length > 0 && doFetch !== undefined,
        unavailableReason: () => url.length === 0
            ? '未配置飞书 webhook 地址'
            : (doFetch === undefined ? '运行时没有可用的 fetch' : undefined),
        async send(message) {
            if (url.length === 0)
                return { ok: false, error: '未配置飞书 webhook 地址' };
            if (doFetch === undefined)
                return { ok: false, error: '运行时没有可用的 fetch' };
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await doFetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    // 飞书自定义机器人文本消息体；不用 markdown 卡片，避免格式差异导致静默失败。
                    body: JSON.stringify({ msg_type: 'text', content: { text: `${message.title}\n${message.body}`.slice(0, 3500) } }),
                    signal: controller.signal,
                });
                if (!response.ok)
                    return { ok: false, uncertain: response.status >= 500 || response.status === 408, error: `HTTP ${response.status}` };
                // ⚠️ 飞书即使在 HTTP 200 时也可能在体内报错（code != 0）；只看状态码 = 假绿。
                const payload = await response.json().catch(() => undefined);
                const code = payload?.code ?? payload?.StatusCode;
                if (typeof code !== 'number')
                    return { ok: false, uncertain: true, error: '渠道未返回确认码' };
                if (code !== 0) {
                    return { ok: false, error: `飞书返回 code=${code} ${payload?.msg ?? payload?.StatusMessage ?? ''}`.trim() };
                }
                return { ok: true };
            }
            catch {
                return { ok: false, uncertain: true, error: controller.signal.aborted ? '请求超时' : '未收到渠道回执' };
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
/** 微信状态：本包不提供实现，如实报告不可用。 */
export function wechatUnavailableReason() {
    return '未接入微信通道（本人当前没有可用且已授权的接入），按设计明确不可用';
}
