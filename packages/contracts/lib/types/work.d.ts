import type { ArtifactRef } from './artifact.ts';
import type { WorkId, WorkStatus } from './ids.ts';
/**
 * 「等你处理」时用户可以点的一个入口。
 * 为什么放在阻塞说明里而不是另开一个字段：入口和阻塞是同一件事的两面，
 * 分开放就会出现"状态说等你处理、卡片上却没有任何可点的东西"。
 * ⚠️ 这里的 url 只允许是给**用户本人浏览器**打开的地址（专用表单页 / 第三方授权页）；
 * 它本身不是通行证——能不能打开由登录会话与请求归属决定。
 */
export interface WorkBlockedAction {
    /** open-url：用户点开一个地址去填 / 去授权。 */
    readonly kind: 'open-url';
    /** 按钮上那几个字。 */
    readonly label: string;
    /** 给用户本人浏览器打开的地址。 */
    readonly url: string;
    /** 服务端记录的请求编号（界面与续办按它对齐；不是秘密）。 */
    readonly requestId?: string;
}
/** 工作的一步。步骤是"做过什么"的骨架，不是模型的思考流水。 */
export interface WorkStep {
    /** 步骤在本工作内的稳定序号，从 1 开始，只增不改。 */
    readonly index: number;
    /** 面向人的步骤名，例如"读取资料"/"生成表格"。 */
    readonly label: string;
    readonly status: 'pending' | 'running' | 'done' | 'failed';
    /** ISO-8601；开始时写入，不预填。 */
    readonly startedAt?: string;
    readonly finishedAt?: string;
    /** 失败原因；只在 status 为 failed 时出现。 */
    readonly error?: string;
}
/** 需要人介入时的说明：等什么、为什么等。 */
export interface WorkBlocked {
    readonly kind: 'input' | 'approval';
    /** 给人看的一句话：需要补充什么，或需要确认什么。 */
    readonly message: string;
    /** 稳定码，界面据此选择交互形态，不比较中文。 */
    readonly code: string;
    /** 要求确认时的风险说明；补充输入时省略。 */
    readonly risk?: string;
    /** 需要用户点开某个入口时给（见 {@link WorkBlockedAction}）。 */
    readonly action?: WorkBlockedAction;
}
/** 一件工作的当前事实。 */
export interface WorkSnapshot {
    readonly id: WorkId;
    /** 用户交代的目标原话（或压缩后的短标题），界面直接显示，不改写。 */
    readonly goal: string;
    readonly status: WorkStatus;
    /** 当前阶段的人类可读描述，例如"正在核对第二份资料"。 */
    readonly stage: string;
    /** 可计算时才给 0–1；算不出就省略——省略不是 0%。 */
    readonly progress?: number;
    /** 本快照的递增版本号；消费端比较它判断新旧，不比时间戳。 */
    readonly revision: number;
    /** ISO-8601 创建/最后更新时间，由工作插件写入。 */
    readonly createdAt: string;
    readonly updatedAt: string;
    /** 关联的 DSH 会话 ID（原生会话标识，仅作为字符串引用，不复制会话内容）。 */
    readonly sessionId?: string;
    /** 登记来源：前台对话、定时职责、外部事件等；稳定码，不比较中文。 */
    readonly origin: string;
    readonly steps: readonly WorkStep[];
    /** 已产出的成果引用；正文另行读取。 */
    readonly artifacts: readonly ArtifactRef[];
    /** 需要人介入时的说明；无需介入时省略。 */
    readonly blocked?: WorkBlocked;
    /** 失败原因；只在 status 为 failed 时出现，且必须来自真实错误。 */
    readonly error?: string;
    /** 排队原因（例如后台额度已满）；只在 queued 时可能出现。 */
    readonly queuedReason?: string;
    /**
     * 最近一次"等你交钥匙"的续办投递痕迹（R2）。
     * 为什么进快照：界面要能告诉用户"上次那句'继续'没送进原会话，可以重试"，
     * 否则工作看着在跑（或什么都不说），用户不知道要不要再点一次。
     * ⚠️ 只放投递结局与错误摘要，【不】放任何秘密或凭据。
     */
    readonly credentialResume?: {
        readonly requestId: string;
        readonly attempt: 'sending' | 'sent' | 'undelivered' | 'unknown';
        readonly at: string;
        readonly error?: string;
    };
}
/** 工作列表项：足以画列表，不必展开步骤。 */
export interface WorkSummary {
    readonly id: WorkId;
    readonly goal: string;
    readonly status: WorkStatus;
    readonly stage: string;
    readonly updatedAt: string;
    readonly artifactCount: number;
}
/**
 * 把快照压成列表项。
 * 为什么放在契约里：工作空间、临时卡、精灵提示都要同一份投影，
 * 各写一遍就会出现"列表说完成了卡片说执行中"。
 * @param snapshot - 完整快照
 * @returns 列表项
 */
export declare function summarizeWork(snapshot: WorkSnapshot): WorkSummary;
