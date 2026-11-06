import { createXtmemEngine, MemoryEngineError } from "./engine.js";
import { isCloudMode } from "./deployment-mode.js";
/**
 * 记忆服务。
 */
export class MemoryService {
    engine;
    config;
    cloudMode;
    /** 监听器 → 订阅时绑定的 actor（本地模式恒为 undefined）。 */
    listeners = new Map();
    lastStatus;
    /** 云端状态缓存：按 actor 分桶，防串号。 */
    cloudStatus = new Map();
    /**
     * @param config - 本地：身份/域/库/路径配置；云端：只需 dataUrl（身份走工牌）
     * @param engine - 可替换的引擎（测试可注入替身；生产按模式自建）
     */
    constructor(config, engine) {
        this.config = config;
        this.cloudMode = config.cloud ?? isCloudMode();
        if (this.cloudMode)
            throw new Error('Cloud memory adapter is not included in this source distribution');
        this.engine = engine ?? createXtmemEngine(config);
    }
    /** 是否云端装配（界面/装配方可据此改文案，不参与业务分支判断以外的用途）。 */
    get isCloud() { return this.cloudMode; }
    /**
     * 订阅变更（界面刷新用）；返回取消函数。
     * ⚠️ 云端模式按订阅时的身份绑定：之后即使"工牌"换了人，这条订阅也只听原来那个 actor 的帧。
     */
    subscribe(listener) {
        const boundActor = this.cloudMode ? this.currentActorOrThrow('订阅变更流') : undefined;
        this.listeners.set(listener, boundActor);
        return () => { this.listeners.delete(listener); };
    }
    /**
     * 广播变更。
     * @param frame - 变更帧
     * @param actor - 云端模式下"这次变更属于谁"；本地模式忽略
     */
    emit(frame, actor) {
        for (const [listener, boundActor] of this.listeners) {
            // 云端：只发给绑定同一身份的订阅者（防 A 的写入把 B 的界面刷出新数据）。
            if (this.cloudMode && boundActor !== actor)
                continue;
            // 监听方异常不得影响已完成的写入。
            try {
                listener(frame);
            }
            catch { /* 忽略：界面订阅是尽力而为 */ }
        }
    }
    /**
     * 取当前身份；云端缺身份即拒（memory/rejected）。
     * @param action - 用于错误文案的动作名
     * @returns actor
     * @throws MemoryEngineError('memory/rejected') 云端无身份时
     */
    currentActorOrThrow(action) {
        // ⚠️ 必须用 MemoryEngineError('memory/rejected')：Remote 层按 code 折域码，
        //    抛裸 Error 会被当成 engine-failed，界面就会把"没登录"报成"引擎挂了"。
        throw new MemoryEngineError('memory/rejected', `缺少本端身份，拒绝${action}`);
    }
    /** 默认条数。 */
    get defaultTop() {
        return this.config.defaultTop ?? 5;
    }
    /** 检索。 */
    async search(query, options = {}) {
        const trimmed = query.trim();
        if (trimmed === '')
            return { hits: [], mode: 'empty-query' };
        if (this.cloudMode)
            this.currentActorOrThrow('发起检索');
        return this.engine.search(trimmed, options);
    }
    /** 保存（引擎 operationId 幂等；成功后广播）。 */
    async store(input) {
        const text = input.text.trim();
        if (text === '')
            return { action: 'rejected', reason: 'text 不能为空' };
        // ⚠️ 云端必须在调用**之前**抓住身份：引擎内部会再读一次工牌，但广播要按"发起人"算，
        //    否则一次并发换人会让帧发错人。
        const actor = this.cloudMode ? this.currentActorOrThrow('写入记忆') : undefined;
        const result = await this.engine.store({
            text,
            operationId: input.operationId,
            ...(input.project === undefined ? {} : { project: input.project }),
            importance: input.importance ?? this.config.defaultImportance ?? 0.5,
            ...(input.tags === undefined ? {} : { tags: input.tags }),
        });
        if (result.action !== 'rejected' && result.id !== undefined) {
            this.emit({ type: 'changed', action: 'store', ids: [result.id] }, actor);
        }
        return result;
    }
    /** 纠正（引擎：新条目 + 旧条目退役）。 */
    async correct(input) {
        const text = input.text.trim();
        if (text === '')
            throw new Error('text 不能为空');
        const actor = this.cloudMode ? this.currentActorOrThrow('纠正记忆') : undefined;
        /*
         * ⚠️ 2026-10-27 合入本地共库纠正预检：纠正前先验目标条目是不是本域的。
         * ▍为什么必须有这道预检
         * 共库开启后，dot_memory_search 会带回**别域共享条目**的 id；模型拿着它调 correct 时，
         * 引擎的顺序是"先 store 新条（落在本域，会成功）→ 再 supersede 旧条（越域，被拒）"
         * ——结果是一次**半成功**：别人那条原封不动，本域却多出一条没人要的复制条目。
         * 引擎的 cmd_supersede 有同域硬闸（old.namespace != actor 即拒），但它管不住前一半。
         * 这里在读侧就把越域纠正拦下（get 走引擎可见性闸，读不到的不用拦——引擎自己会报找不到）。
         * ▍为什么不顺手套在 forget/restore 上
         * 引擎 cmd_forget / cmd_restore 在**任何副作用之前**就做同域校验（零副作用拒绝），
         * 引擎侧已经是干净的；只有 correct 的副作用顺序会先写后拒。
         * ▍与云端动态身份的关系
         * this.namespace 在云模式下是动态 getter（按"工牌"现算），本地是配置值；
         * 两个模式共用同一条闸，不需要为云端加分支。
         */
        const target = await this.engine.get(input.id);
        if (target !== undefined && target.namespace !== undefined && target.namespace !== ''
            && target.namespace !== this.namespace) {
            throw new MemoryEngineError('memory/rejected', `${input.id} 属于域 ${target.namespace}，不是本域（${this.namespace}）记忆；别人的条目只能引用，不能纠正`);
        }
        const result = await this.engine.correct({
            id: input.id,
            text,
            operationId: input.operationId,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
        });
        this.emit({ type: 'changed', action: 'correct', ids: [result.id, result.supersededId] }, actor);
        return result;
    }
    /** 删除（未确认只预览；确认才真删）。 */
    async forget(input) {
        const actor = this.cloudMode ? this.currentActorOrThrow('删除记忆') : undefined;
        const result = await this.engine.forget(input);
        if (input.confirmed && result.removed > 0) {
            this.emit({ type: 'changed', action: 'forget', ids: [input.id] }, actor);
        }
        return result;
    }
    /** 单条读取。 */
    async get(id) {
        if (this.cloudMode)
            this.currentActorOrThrow('读取记忆');
        return this.engine.get(id);
    }
    /** 列表。 */
    async list(options = {}) {
        if (this.cloudMode)
            this.currentActorOrThrow('列出记忆');
        return this.engine.list(options);
    }
    /**
     * 状态（本地：一次短缓存；云端：按 actor 分桶缓存）。
     * @param fresh - true 强制重新探测
     * @returns 状态
     */
    async status(fresh = false) {
        if (this.cloudMode) {
            // 云端：无身份也要如实报不可用（不抛），界面才知道"我没登录"而不是"引擎挂了"。
            const actor = '';
            if (!fresh && actor !== '') {
                const cached = this.cloudStatus.get(actor);
                if (cached !== undefined)
                    return cached;
            }
            const engineStatus = await this.engine.status();
            const configured = this.config.namespace;
            const namespace = engineStatus.namespace !== ''
                ? engineStatus.namespace
                : (actor !== '' ? actor : configured);
            const value = {
                available: engineStatus.available,
                actor,
                namespace,
                ...(engineStatus.reason === undefined ? {} : { reason: engineStatus.reason }),
                ...(engineStatus.engineVersion === undefined ? {} : { engineVersion: engineStatus.engineVersion }),
            };
            if (actor !== '')
                this.cloudStatus.set(actor, value);
            return value;
        }
        if (!fresh && this.lastStatus !== undefined)
            return this.lastStatus;
        const engineStatus = await this.engine.status();
        const actor = this.config.actor;
        this.lastStatus = {
            available: engineStatus.available,
            actor,
            // ⚠️ 用引擎回报的**有效域**，不用配置原值：二者可能不同（配置写成别的名字时会收敛到
            //    actor）。界面显示"配置值"而实际读写另一个域 = 用户以为记在这里、其实在那里。
            namespace: engineStatus.namespace,
            ...(engineStatus.reason === undefined ? {} : { reason: engineStatus.reason }),
            ...(engineStatus.engineVersion === undefined ? {} : { engineVersion: engineStatus.engineVersion }),
        };
        return this.lastStatus;
    }
    /** 本端身份（只读展示用）。云端按当前工牌现读。 */
    get actor() {
        if (this.cloudMode)
            return '';
        return this.config.actor;
    }
    /**
     * 默认域（只读展示用）。
     * ⚠️ 返回**有效域**：缓存过 status 就用引擎回报值，否则按与引擎相同的收敛规则现算，
     *   保证"界面显示什么域 = 实际读写什么域"，绝不出现两个值。
     */
    get namespace() {
        if (this.cloudMode) {
            const actor = undefined;
            if (actor === undefined)
                return '';
            // 先看该 actor 自己的缓存桶（不串号），没有就按"域=身份"的约定现算。
            const cached = this.cloudStatus.get(actor);
            return cached !== undefined && cached.namespace !== '' ? cached.namespace : actor;
        }
        const configured = this.config.namespace;
        const actor = this.config.actor;
        const effective = configured === actor || configured === 'knowledge' ? configured : actor;
        return this.lastStatus?.namespace ?? effective;
    }
}
