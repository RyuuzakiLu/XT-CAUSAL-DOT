/** 一次外部投递的结果。 */
export interface TransportResult {
    readonly ok: boolean;
    readonly uncertain?: boolean;
    /** 渠道侧消息 id；拿不到就省略，不编造。 */
    readonly externalId?: string;
    /** ok=false 时的原因（不得含凭据）。 */
    readonly error?: string;
}
/** 外部渠道适配器：只做"送一条"，不负责事件事实。 */
export interface OutboundTransport {
    /** 渠道名（用于记录与状态）。 */
    readonly channel: 'feishu';
    /** 是否具备实际投递能力（缺配置=false，不得假成功）。 */
    available(): boolean;
    /** 不可用时的原因，供 status 显示。 */
    unavailableReason(): string | undefined;
    /**
     * 发送一条通知。
     * @param message - 标题与正文；不含凭据
     * @returns 投递结果
     */
    send(message: {
        readonly title: string;
        readonly body: string;
    }): Promise<TransportResult>;
}
/** 飞书 webhook 适配器配置。 */
export interface FeishuTransportConfig {
    /** webhook 完整地址；由装配侧从自己的配置/凭据位置取来后注入。 */
    readonly webhookUrl?: string;
    /** 注入的 fetch 实现（默认全局 fetch）；测试可替换。 */
    readonly fetch?: typeof fetch;
    /** 单次请求超时，毫秒。 */
    readonly timeoutMs?: number;
}
/**
 * 构造飞书适配器。
 * 未配置 webhook 时 available() 恒 false，send() 明确拒绝——不假装发过。
 * @param config - 配置
 * @returns 适配器实例
 */
export declare function createFeishuTransport(config: FeishuTransportConfig): OutboundTransport;
/** 微信状态：本包不提供实现，如实报告不可用。 */
export declare function wechatUnavailableReason(): string;
