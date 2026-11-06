export type WorkRow = {
    id: string;
    goal: string;
    status: string;
    stage: string;
    updatedAt: string;
    createdAt?: string;
    progress?: number;
    error?: string;
    artifacts: {
        id: string;
        title: string;
        kind?: 'text' | 'file';
        text?: string;
        url?: string;
    }[];
    /**
     * 「等你处理」的说明与入口（原样来自后端 blocked）。
     * 为什么带 url：钥匙只能由用户本人浏览器交（保密表单 / 第三方授权页），
     * 工作空间要能直接给出那一个可点入口，而不是让用户去聊天里翻链接。
     * ⚠️ 这里【不】允许放任何秘密：后端也只写地址与一句人话。
     */
    blocked?: {
        kind: 'input' | 'approval';
        message: string;
        code: string;
        risk?: string;
        action?: {
            kind: 'open-url';
            label: string;
            url: string;
            requestId?: string;
        };
    };
};
/**
 * 记忆行。
 *
 * ⚠️ 2026-10-26 主线02：补 `kind` / `visibility` / `state` / `supersededBy` / `retireReason`。
 * 没有这几样，界面就只能把"假设"和"正式决定"画成一样、把"已删除归档"当普通条目。
 */
export type MemoryRow = {
    id: string;
    text: string;
    updatedAt?: string;
    source?: string;
    /** 种类（事实/讨论/假设/待办/决定）；未标注时 undefined（不猜）。 */
    kind?: string;
    /** 可见性原样（private / shared / shared-with:...）。 */
    visibility?: string;
    /** 状态：active / superseded / archived。正常列表里应是 active 或 undefined。 */
    state?: string;
    /** 被哪条取代（纠正后旧版本的指针）。 */
    supersededBy?: string;
    /** 退役原因：forget=可恢复；superseded=被纠正（不可当归档恢复）。 */
    retireReason?: string;
};
/** severity：星邮匣原有的轻重（normal / important / urgent），「重要提醒 › 查看全部」据此列出。 */
export type LetterRow = {
    id: string;
    title: string;
    body: string;
    workId?: string;
    read: boolean;
    archived: boolean;
    createdAt: string;
    delivery?: string;
    severity?: string;
    /** 信件类别（work-blocked / work-waiting-approval / reminder / info …）；决定它算不算「要你动手」。 */
    kind?: string;
    /** 由服务端稳定的主动问候事件键识别，供色卡区分主动问候。 */
    proactive?: boolean;
    /** 这一条最近一次有新动态的时间（ms）；精灵角标用它判断「看过没有」。 */
    at?: number;
    /** 知序待办：同一任务的同步信在服务端折成一条，状态取知序任务实时值（见 scripts/dot-cloud-postbox.mjs）。 */
    todo?: LetterTodo;
};
/** 星邮匣里的一条知序待办。status 只跟知序任务走；读没读过只看 LetterRow.read，两者互不影响。 */
export type LetterTodo = {
    taskId: string;
    status: 'pending' | 'in_progress' | 'done' | 'canceled';
    statusLabel: string;
    done: boolean;
    closed: boolean;
    progress: string;
    updates: {
        id: string;
        title: string;
        body: string;
        at: string;
        read: boolean;
    }[];
};
export type CapabilityRow = {
    id: string;
    title: string;
    available: boolean;
    reason?: string;
    enabled?: boolean;
};
export type PlanRow = {
    planId: string;
    scheduleId: string;
    title: string;
    goal: string;
    paused: boolean;
    cancelled: boolean;
    nextAt?: string;
};
export type ProviderRow = {
    id: string;
    name: string;
    active: boolean;
    endpoint?: string;
    error?: string;
    models: {
        id: string;
        name: string;
        selected?: boolean;
        reasoning?: string[];
    }[];
};
export type ReminderSettings = {
    personalReminders?: boolean | undefined;
    preferences: import('@xtcausal/dot-postbox/types').PostboxPreferences;
    rev: number;
};
/** 能独立回来的业务块。记忆单独一块，别让它跟工作挤同一班车。 */
export type DataDomain = 'work' | 'plans' | 'memory' | 'postbox' | 'capabilities';
export type DataSpace = 'study' | 'conversation' | 'work' | 'memory' | 'capabilities' | 'postbox';
export type DataSnapshot = {
    sessions: {
        id: string;
        title: string;
    }[];
    works: WorkRow[];
    plans: PlanRow[];
    memories: MemoryRow[];
    letters: LetterRow[];
    capabilities: CapabilityRow[];
    /** 历史条目（含 archived/superseded）：只在用户打开"历史"时取，不参与正常召回。 */
    memoryHistory?: MemoryRow[];
    /** 历史是否查全；false = 扫描面用完或被 limit 截断，界面必须提示"可能还有更早的"。 */
    memoryHistoryComplete?: boolean;
    /**
     * 历史这一块自己的失败原因（连接没挂上/对端没这个接口/查询报错）。
     * ⚠️ 独立字段，【不】并进全局 `error`：历史是可选功能，它不可用不该让整个壳顶红条，
     * 更不该把精灵状态打成"出了点状况"（2026-10-26 实测踩过）。
     */
    memoryHistoryError?: string | undefined;
    /** 首屏（工作领域）是否在取；【不】再被慢记忆拖住，记忆看 domainLoading.memory。 */
    loading: boolean;
    error: string | null;
    connected: boolean;
    busy: boolean;
    dnd: boolean;
    noticeId: string | null;
    /** 原生连接服务的恢复状态（connection.state）：简洁版顶栏的在线 / 连接中 / 未连接灯用它（lite/link-status.ts）。 */
    link?: 'connected' | 'connecting' | 'disconnected';
    /** 各领域自己的在途标记；场景空态优先读本领域，没接线时回退到 loading。 */
    domainLoading?: Partial<Record<DataDomain, boolean>>;
    reminderSettings?: ReminderSettings;
    memoryStatus?: {
        available: boolean;
        reason?: string | undefined;
        engineVersion?: string | undefined;
        sharedLibrary?: boolean;
    };
    channelStatus?: {
        feishuConfigured: boolean;
        reason?: string;
    };
    providers?: ProviderRow[];
    providerError?: string | null;
};
export type DataPort = {
    load(): Promise<Partial<DataSnapshot>>;
    search(query: string): Promise<MemoryRow[]>;
    command(action: string, value: Record<string, unknown>): Promise<void>;
    /** 只取一块领域；老实现不提供时，模型退回整包 load()。 */
    loadDomain?(domain: DataDomain): Promise<Partial<DataSnapshot>>;
    /** 按工作编号读成果正文；界面真正打开那张卡时才调。 */
    readArtifacts?(workId: string): Promise<{
        id: string;
        text?: string;
        url?: string;
    }[]>;
    /**
     * 读记忆历史（含 archived/superseded）；用户点"历史"时才调，不参与首屏。
     * `options.project` 走引擎侧真实可用的过滤（正本 lookup 没有 --project，
     * 由 DOT 适配器在扫描面内筛，**可能不全**——`complete=false` 要显示出来）。
     */
    readMemoryHistory?(options: {
        query?: string;
        limit?: number;
        project?: string;
    }): Promise<{
        rows: MemoryRow[];
        complete: boolean;
        scanned: number;
    }>;
};
export declare class DotDataModel {
    private readonly port;
    private snapshot;
    private listeners;
    private generation;
    private searchGeneration;
    private disposed;
    private refreshPending;
    private refreshAgain;
    private query;
    private readonly domainFlight;
    private readonly domainAgain;
    private readonly domainGen;
    private readonly loadedDomains;
    private readonly domainErrors;
    private domainSource;
    private space;
    private spaceWired;
    private openWork;
    private readonly artifactLoaded;
    private readonly artifactContent;
    private readonly artifactFlight;
    constructor(port: DataPort);
    getSnapshot: () => DataSnapshot;
    subscribe: (fn: () => void) => (() => void);
    update(value: Partial<DataSnapshot>): void;
    refresh(): Promise<void>;
    refreshCoalesced(): Promise<void>;
    search(query: string): Promise<void>;
    /**
     * 读记忆历史（含已取代/已归档）。
     *
     * ⚠️ 刻意与 `search` 分开：历史里混着 superseded 的旧版本，
     * 若和正常列表共用 `memories` 字段，界面必然把旧版本当"当前记忆"显示——
     * 那正是卡 §3 第 4 条要防的。所以单独放 `memoryHistory`。
     *
     * ⚠️ 2026-10-26 R1：带 `complete` 一起回。正本 lookup 不支持 --project，
     * 项目过滤只能在适配器侧做——只筛一页就说过滤好了会**静默漏条目**。
     * 不完整就必须在界面上说出来，不能让用户把"没查到"当"不存在"。
     *
     * 🔴 2026-10-26 R2：历史查询能力挂在 `domainSource`（remote-adapter 连上后才挂的那个完整
     * port），跟 `readArtifacts` 同一条路。构造时传进来的 `this.port` 只有 load/search/command，
     * 从它身上找永远找不到——老实现因此恒定判定"当前连接不提供记忆历史查询"。
     *
     * ⚠️ 失败只写 `memoryHistoryError`（历史面板自己显示），【不】并进 `domainErrors.memory`、
     * 也不写全局 `error`：历史是可选功能，它不可用不该让记忆页顶红条，更不该把精灵状态
     * 打成"出了点状况"（2026-10-26 实测：一进记忆页精灵就变脸，根因就是这条被当成了全库故障）。
     */
    readHistory(query?: string, project?: string): Promise<void>;
    command(action: string, value?: Record<string, unknown>): Promise<void>;
    private affectedDomain;
    /** remote-adapter 连上后把带 loadDomain/readArtifacts 的 port 挂进来；返回卸载时摘钩子。
        摘钩子要清掉"这块取过了"的记账：重连后是新连接、新事实，
        不清的话 warmSpace 会全命中旧缓存，首屏永远拿重连前的老数据。 */
    attachDomainSource(source: DataPort): () => void;
    getSpace(): DataSpace;
    /** 当前空间要取哪几块。主端还没接 setSpace 时返回全部：老调用方（整包 load）
        行为保持不变，接了以后才收窄到本空间，免得有人半接线时功能被砍掉。 */
    spaceDomains(): readonly DataDomain[];
    /** 该领域是否已经取过一次（决定流事件要不要跟着刷新，免得后台空转）。 */
    hasDomain(domain: DataDomain): boolean;
    /** 切空间：只补齐这个房间要用的领域；同房间重复进入不重复请求。
        重复通知（界面重载/订阅抖动）落在 ensureDomain 的去重上，这里不再额外判断。 */
    setSpace(space: DataSpace): void;
    /** 业务连接刚就绪时补一次首屏取数。只取"当前空间"那几块；
        主端接上 setSpace 之前，space 停留在默认的 study（工作+邮匣），
        记忆页仍可用刷新按钮按需取（那条走整包 load，是老行为）。 */
    warmSpace(): void;
    /** 强制刷新一块领域（流事件/用户刷新用）；同领域在途时合并为一次补读。 */
    refreshDomain(domain: DataDomain): Promise<void>;
    /** 打开临时工作卡才读成果正文。
        ⚠️ 记账单位是【成果 id 成功过】，不是"这张工作打开过"：
          ① 关掉卡再打开要能直接看到已取到的正文（列表刷新只带元信息，会把它冲掉）；
          ② 取失败不算成功，重新打开要能重试；
          ③ 后来新增的成果没缓存，再次打开仍要补取。 */
    setOpenWork(workId: string | null): void;
    private applyArtifactCache;
    private errorText;
    private ensureDomain;
    private loadDomainOnce;
    private setDomainLoading;
    dispose(): void;
}
