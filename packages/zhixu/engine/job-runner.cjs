/* ================================================================
   知序 · 每日新闻订阅与持久化任务执行器（R06/R07）

  ▍这是什么
  ① 干什么：管每日新闻订阅的增删改查/试跑/启停；按订阅时区算出「今天该跑哪一期」；
     持久化落一条 run，用租约防两个执行器抢同一期；领到后冻结配置快照与时间窗，
     按预算调搜索工具、交 news-digest 整理、落简报、plan 投递。重启后只补最近一期。
  ② 技术栈：Node CommonJS + node:sqlite（news_* 表）+ @js-temporal/polyfill（时区/DST）。
  ③ 依赖：store、json-schema（normalizeSubscription）、news-digest、news-delivery、
     mcp-client（通过注入的 session 调搜索工具）、model（news 整理用注入适配器）。
  ④ 给谁看：改调度规则、预算、runKey/租约、停止/恢复的人。

  ▍文件从上到下的结构
  订阅 CRUD       listSubscriptions / saveSubscription / deleteSubscription / setEnabled
  计划计算        plannedInstantFor()：当地 sendTime → 绝对时间（含 DST 语义）★核心★
  runKey 与租约   claimRun() / releaseRun()：唯一 + 租约，轮询/多执行器/重启都不重复
  搜索阶段        searchSources()：适配工具 schema、预算、有限重试
  整理阶段        summarize()：交 news-digest，含模型调用计数
  执行主循环      executeRun()：searching → summarizing → generated → 投递
  轮询            tick()：算计划、补最近一期、跳过过期、处理排队
  生命周期        start() / stop() / stopRun()

  ▍修改铁律
  1. 铁律一：自动 runKey = subscriptionId + plannedLocalDate，数据库唯一约束保证「一期只跑一次」
     （spec §9.1）。轮询多次、重复唤醒、重启都不能创建第二次。
  2. 铁律二：领任务必须用事务/租约（lease_owner + lease_expires），两个执行器不能同时认领
     （spec §9.3）。
  3. 铁律三：只补【最近一期且在宽限内】。过期计划记 skipped 并说明原因；暂停期间形成的计划
     【不】补跑（spec §9.1）。
  4. 铁律四：预算 = 执行总时长 timeoutSeconds（领取后开始算，排队不消耗）+ maxSearchCalls +
     maxModelCalls。每次 dispatch（含重试）都计数；额度不足就停并持久化部分结果（spec §9.2）。
  5. 铁律五：停止后 1 秒内显示停止；不再提交新简报、不排队新投递。已提交结果与已发生的外部
     发送保留并如实展示（spec §9.2）。
  6. 铁律六：重启发现「搜索/整理未完成」可在剩余预算和宽限内恢复并标 interrupted；
     已持久化的简报【不】重新搜索/生成，只恢复未完成投递（spec §9.3）。
  7. 铁律七：常规临时搜索错误最多自动重试 2 次（间隔 5s/30s，受预算与总超时约束）；
     认证/参数/工具不兼容错误【不】自动反复重试（spec §9.2）。
  8. 铁律八：修改订阅不自动重推当日已完成一期；后续执行用新配置；试跑用新配置并标 manual。
  9. 铁律九：每天最多一期；DST 跳过的当地时刻顺延到当日第一个有效时刻，重复时刻取第一次。

  ▍特殊机制
  "冻结快照"：run 落库时把当时订阅配置存进 config_snapshot，后续执行全用它——中途改订阅不影响
  这一期（spec §8「配置版本作为运行输入快照保存」）。
  "静音轨"（借 MV 术语）：maxSearchCalls 用尽后不再 dispatch，直接进整理；模型额度用尽直出摘录。
  "宽限"：catchupGraceMinutes，计划时刻过后仍允许补跑的时间窗；超期 → skipped。

  ▍外号表
  "计划"     → plannedInstantFor 算出的绝对时刻
  "租约"     → lease_owner/lease_expires，防双执行器
  "静音轨"   → 预算耗尽后的降级路径
  "宽限"     → catchupGrace 允许补跑的时间窗

  ▍更新记录
  *更新：2026-10-12 · 新建：R06/R07 订阅 CRUD + 持久化执行器（runKey/租约/预算/重试/恢复）*

  ================================================================ */
'use strict';
const crypto = require('node:crypto');
const { Temporal } = require('@js-temporal/polyfill');
const { normalizeSubscription } = require('./json-schema.cjs');
const digestLib = require('./news-digest.cjs');
const delivery = require('./news-delivery.cjs');

const RUN_STATES = ['queued', 'searching', 'summarizing', 'generated', 'failed', 'canceled', 'skipped'];
const LEASE_MS = 120000;              // 租约有效期：单期执行超过 2 分钟需续租（executeRun 每步续）

const systemTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const nowIso = (now = Date.now()) => new Date(now).toISOString();

/* ================================================================
   订阅 CRUD
   ================================================================ */
function rowToSubscription(row) {
  return {
    id: row.id, version: row.version, config: JSON.parse(row.config),
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at || null,
    nextPlannedAt: row.next_planned_at || '',
  };
}

function listSubscriptions(store, { includeDeleted = false } = {}) {
  const sql = includeDeleted ? 'SELECT * FROM news_subscriptions ORDER BY created_at DESC' : 'SELECT * FROM news_subscriptions WHERE deleted_at IS NULL ORDER BY created_at DESC';
  return store.db.prepare(sql).all().map(rowToSubscription);
}

/* saveSubscription()：契约
   入参：store、{ id?, version?, ...config }
   返回：subscription（含服务端生成 id/version/时间戳）
   副作用：写 news_subscriptions；重算 next_planned_at
   谁调用：UI「保存订阅」、启用/暂停
   改动影响：铁律八——改配置不重推当日；带 version 做乐观锁，避免两界面覆盖。 */
function saveSubscription(store, input, systemZone = systemTimeZone()) {
  const config = normalizeSubscription(input, systemZone);
  const now = nowIso();
  if (input.id) {
    const row = store.db.prepare('SELECT * FROM news_subscriptions WHERE id=? AND deleted_at IS NULL').get(input.id);
    if (!row) throw new Error('订阅不存在或已删除');
    if (input.version !== undefined && input.version !== row.version) throw new Error('这条订阅已被其他操作修改，请刷新后重试');
    const version = row.version + 1;
    store.db.prepare('UPDATE news_subscriptions SET version=?,config=?,updated_at=? WHERE id=?').run(version, JSON.stringify(config), now, input.id);
    return rowToSubscription(store.db.prepare('SELECT * FROM news_subscriptions WHERE id=?').get(input.id));
  }
  const id = crypto.randomUUID();
  store.db.prepare('INSERT INTO news_subscriptions(id,version,config,created_at,updated_at,deleted_at,next_planned_at) VALUES(?,?,?,?,?,NULL,?)')
    .run(id, 1, JSON.stringify(config), now, now, '');
  return rowToSubscription(store.db.prepare('SELECT * FROM news_subscriptions WHERE id=?').get(id));
}

function setEnabled(store, id, enabled, systemZone = systemTimeZone()) {
  const row = store.db.prepare('SELECT * FROM news_subscriptions WHERE id=? AND deleted_at IS NULL').get(id);
  if (!row) throw new Error('订阅不存在或已删除');
  const config = { ...JSON.parse(row.config), enabled: !!enabled };
  store.db.prepare('UPDATE news_subscriptions SET version=version+1,config=?,updated_at=? WHERE id=?').run(JSON.stringify(config), nowIso(), id);
  return rowToSubscription(store.db.prepare('SELECT * FROM news_subscriptions WHERE id=?').get(id));
}

/* deleteSubscription()：契约
   入参：store、id
   返回：{ok}
   副作用：软删（deleted_at）+ 取消未提交运行与未发送投递（spec §8：已有历史保留）
   谁调用：UI「删除订阅」 */
function deleteSubscription(store, id) {
  const row = store.db.prepare('SELECT * FROM news_subscriptions WHERE id=? AND deleted_at IS NULL').get(id);
  if (!row) throw new Error('订阅不存在或已删除');
  store.db.prepare('UPDATE news_subscriptions SET deleted_at=?,updated_at=? WHERE id=?').run(nowIso(), nowIso(), id);
  store.db.prepare("UPDATE news_runs SET status='canceled',updated_at=? WHERE subscription_id=? AND status IN ('queued','searching','summarizing')").run(nowIso(), id);
  delivery.cancelPending(store, id);
  return { ok: true };
}

/* ================================================================
   计划计算（IANA 时区 + DST）
   ================================================================ */
/* plannedInstantFor()：契约
   入参：{ timeZone, sendTime }, localDateStr（YYYY-MM-DD）
   返回：ISO 绝对时刻字符串
   副作用：无
   谁调用：tick / nextPlanAfter
   改动影响：铁律九——DST 跳过的当地时刻顺延到当日第一个有效时刻（Temporal 'compatible' 默认
     会把不存在的时刻往前挪，这里显式用 'later' 语义处理「跳过」；重复时刻取第一次）。 */
function plannedInstantFor(subscription, localDateStr) {
  const { timeZone, sendTime } = subscription;
  const [hour, minute] = sendTime.split(':').map(Number);
  const date = Temporal.PlainDate.from(localDateStr);
  let zoned;
  try {
    zoned = date.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from({ hour, minute }) });
  } catch {
    // 当地时刻不存在（DST 跳过）→ 顺延到当日第一个有效时刻
    const dayStart = date.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from('00:00') });
    const later = dayStart.add({ hours: 1 }).with({ minute: 0, second: 0 });
    zoned = later;
  }
  // Temporal 对「skip」默认 disambiguation='compatible'（往前）。要求顺延到当日第一个有效时刻：
  // 若换算结果早于请求的当地时刻，取其后第一个存在的时刻。
  const requested = date.toPlainDateTime(Temporal.PlainTime.from({ hour, minute }));
  if (Temporal.PlainDateTime.compare(zoned.toPlainDateTime(), requested) < 0 || zoned.hour !== hour) {
    // 往前挪了（跳过的时刻）→ 顺延
    for (let add = 1; add <= 180; add++) {
      const candidate = zoned.add({ minutes: add });
      if (candidate.hour > hour || (candidate.hour === hour && candidate.minute >= minute)) { zoned = candidate; break; }
    }
  }
  return zoned.toInstant().toString();
}

/* 算出「从 fromIso 之后的下一次计划」——今天已过则明天 */
function nextPlanAfter(subscription, fromIso = nowIso()) {
  const zone = subscription.timeZone;
  let local = Temporal.Instant.from(fromIso).toZonedDateTimeISO(zone).toPlainDate();
  for (let i = 0; i < 366; i++) {
    const instant = plannedInstantFor(subscription, local.toString());
    if (Temporal.Instant.compare(Temporal.Instant.from(instant), Temporal.Instant.from(fromIso)) > 0) return instant;
    local = local.add({ days: 1 });
  }
  return '';
}

/* ================================================================
   runKey 与租约
   ================================================================ */
const autoRunKey = (subscriptionId, localDate) => `${subscriptionId}:auto:${localDate}`;
const manualRunKey = (subscriptionId, stamp) => `${subscriptionId}:manual:${stamp}`;

/* claimRun()：契约
   入参：store、runRow 字段
   返回：{ run } 或 { skipped:'已有同一期' }
   副作用：INSERT（run_key 唯一冲突则视为已存在）；leased 行
   谁调用：tick（auto）/ previewRun（manual）
   改动影响：铁律一/二——run_key 唯一是幂等闸，租约是并发闸，两个都要。 */
function claimRun(store, fields) {
  const existing = store.db.prepare('SELECT * FROM news_runs WHERE run_key=?').get(fields.runKey);
  if (existing) return { skipped: true, run: existing };
  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    store.db.prepare('INSERT INTO news_runs(id,subscription_id,run_key,kind,status,planned_at,planned_local_date,time_zone,window_start,window_end,config_snapshot,model_snapshot,search_calls,model_calls,lease_owner,lease_expires,started_at,finished_at,error,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, fields.subscriptionId, fields.runKey, fields.kind, 'queued', fields.plannedAt, fields.plannedLocalDate, fields.timeZone,
        fields.windowStart, fields.windowEnd, JSON.stringify(fields.config), JSON.stringify(fields.modelSnapshot || {}),
        0, 0, null, 0, null, null, '', '', now, now);
  } catch (error) {
    if (/UNIQUE/i.test(error.message)) return { skipped: true, run: store.db.prepare('SELECT * FROM news_runs WHERE run_key=?').get(fields.runKey) };
    throw error;
  }
  return { skipped: false, run: store.db.prepare('SELECT * FROM news_runs WHERE id=?').get(id) };
}

/* 租约领取：只有拿到租约的执行器能推进这一步（原子 UPDATE ... WHERE） */
function acquireLease(store, runId, owner, now = Date.now()) {
  const result = store.db.prepare('UPDATE news_runs SET lease_owner=?,lease_expires=?,updated_at=? WHERE id=? AND (lease_owner IS NULL OR lease_expires<=? OR lease_owner=?)')
    .run(owner, now + LEASE_MS, nowIso(now), runId, now, owner);
  return result.changes > 0;
}
function releaseLease(store, runId, owner) {
  store.db.prepare('UPDATE news_runs SET lease_owner=NULL,lease_expires=0,updated_at=? WHERE id=? AND lease_owner=?').run(nowIso(), runId, owner);
}

function setRunState(store, runId, status, patch = {}) {
  const fields = { status, updated_at: nowIso(), ...patch };
  const keys = Object.keys(fields);
  store.db.prepare(`UPDATE news_runs SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => fields[k]), runId);
}

/* ================================================================
   搜索阶段
   ================================================================ */
const RETRY_DELAYS = [5000, 30000];   // 铁律七：最多自动重试 2 次

/* isRetryableSearchError：认证/参数/工具不兼容不重试；网络/超时/限流可重试 */
function isRetryableSearchError(error) {
  const message = String(error?.message || error);
  if (/认证|unauthor|API key|凭据|密钥/i.test(message)) return false;
  if (/INVALID_ARGUMENT|参数|schema|不存在|not found|不兼容/i.test(message)) return false;
  return true;
}

/* searchSources()：契约
   入参：{ session, toolName, schema, subscription, run, budget, signal, sleep }
   返回：{ sources:[], calls:number, failures:[] }
   副作用：真调外部 MCP 工具（每次 dispatch 计入 calls，含重试）
   谁调用：executeRun 的 searching 阶段
   改动影响：铁律四/七——预算内才 dispatch；可重试错误才重试，且重试也计数。 */
async function searchSources({ session, toolName, schema, subscription, run, maxCalls, signal, sleep = ms => new Promise(r => setTimeout(r, ms).unref?.()), logger = console }) {
  const sources = [];
  const failures = [];
  let calls = 0;
  const windowStart = Temporal.Instant.from(run.window_start ?? run.windowStart);
  const windowEnd = Temporal.Instant.from(run.window_end ?? run.windowEnd);
  // 时间窗跨度换算成供应商常用的相对时间参数（TimeRange 这类），单位天
  const windowDays = Math.max(1, Math.ceil(Number(windowEnd.since(windowStart).total('hours')) / 24));
  const timeRange = `${windowDays}d`;
  // 搜索词 = 主题 + 关键词（排除主题不参与搜索）。预算不够时先保住主题（顺序即优先级）。
  const queries = digestLib.searchQueries(subscription);

  for (const topic of queries) {
    if (calls >= maxCalls) { failures.push({ stage: 'search', reason: `搜索次数达到上限（${maxCalls}），剩余主题未搜索：${topic}` }); break; }
    const args = digestLib.adaptSearchArguments(schema, { query: topic, count: Math.max(subscription.newsCount, 5), timeRange, wantBody: true, wantLink: true });
    let attempt = 0;
    for (;;) {
      signal?.throwIfAborted?.();
      calls += 1;
      const retrievedAt = nowIso();
      try {
        const result = await session.call(toolName, args);
        const text = (result?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
        if (result?.isError) throw new Error('搜索工具返回错误：' + String(text).slice(0, 200));
        // ⚠️ 走 extractSearchItems：兼容「结构化数组」与「豆包/火山式分块文本」两种真实返回形态。
        // 旧写法只认 structuredContent/JSON，遇到豆包那种把结果渲染成分块文本的供应商会一条都取不到。
        for (const item of digestLib.extractSearchItems(result)) {
          sources.push(digestLib.normalizeSource(item, { retrievedAt, timeZone: subscription.timeZone, tool: toolName }));
        }
        break;
      } catch (error) {
        if (attempt < RETRY_DELAYS.length && isRetryableSearchError(error) && calls < maxCalls) {
          const wait = RETRY_DELAYS[attempt];
          failures.push({ stage: 'search', topic, attempt: attempt + 1, reason: `第 ${attempt + 1} 次尝试失败，将重试：${error.message}` });
          logger.info?.(`[news] 搜索「${topic}」失败，${wait / 1000}s 后重试：${error.message}`);
          await sleep(wait);
          attempt += 1;
          continue;
        }
        failures.push({ stage: 'search', topic, reason: String(error.message || error) });
        break;
      }
    }
  }
  return { sources, calls, failures };
}

/* ================================================================
   执行主循环
   ================================================================ */
function runToDigestRun(run) {
  return {
    id: run.id, subscriptionId: run.subscription_id, plannedAt: run.planned_at, timeZone: run.time_zone,
    windowStart: run.window_start, windowEnd: run.window_end,
  };
}

class NewsJobRunner {
  /* 构造：只存依赖，不启动轮询（start() 才开）。
     mcpClient：McpClientManager（需 connect/callTool）；model：需 runNewsSummary；
     notify：PC/桌宠通知回调 ({title,body,digestId,subscriptionId})；
     senders：{ desktop, feishu, weixin } 投递函数映射（main.cjs 注入真实通道） */
  constructor(store, { mcpClient, model, notify, senders, gateways, settings = () => ({ quiet: true, pet: { enabled: true } }), logger = console, clock = () => Date.now() } = {}) {
    this.store = store;
    this.mcpClient = mcpClient;
    this.model = model;
    this.notify = notify || (() => {});
    this.senders = senders || {};
    this.gateways = gateways || {};
    this.settings = settings;
    this.logger = logger;
    this.clock = clock;
    this.owner = 'runner:' + crypto.randomUUID().slice(0, 8);
    this.timer = null;
    this.running = false;
    this.current = null;              // { runId, controller }
    this.stopped = false;
  }

  /* start()：契约
     入参：{ intervalMs? }
     副作用：启动轮询（15s）；先跑一次 tick 处理重启恢复
     谁调用：app 启动
     改动影响：轮询周期是 spec 建议的 15 秒；tick 本身幂等（runKey 唯一） */
  start({ intervalMs = 15000 } = {}) {
    if (this.timer) return;
    this.stopped = false;
    this.recoverOnStart().then(() => this.tick()).catch(error => this.logger.error?.('[news] 启动恢复失败：' + error.message));
    this.timer = setInterval(() => { this.tick().catch(error => this.logger.error?.('[news] tick 失败：' + error.message)); }, intervalMs);
    this.timer.unref?.();
  }

  stopPolling() { clearInterval(this.timer); this.timer = null; }

  async shutdown() {
    this.stopPolling();
    this.stopped = true;
    await this.stopRun({ silent: true });
  }

  /* 重启恢复（铁律六）：把上次中断的 run 标 interrupted 并重排；未完成的投递继续。
     ⚠️ 已持久化简报的 run 不重新搜索/生成，只恢复投递。 */
  async recoverOnStart() {
    const stuck = this.store.db.prepare("SELECT * FROM news_runs WHERE status IN ('queued','searching','summarizing')").all();
    for (const run of stuck) {
      const hasDigest = this.store.db.prepare('SELECT id FROM news_digests WHERE run_id=?').get(run.id);
      if (hasDigest) {
        setRunState(this.store, run.id, 'generated', { notes: '重启恢复：简报已存在，仅续投递' });
      } else {
        setRunState(this.store, run.id, 'failed', { notes: '重启中断，未完成搜索/整理', error: 'PC 退出导致中断' });
      }
      // 把 sending 卡住的投递复位，交由投递阶段重判（不视为已送达）
      this.store.db.prepare("UPDATE news_deliveries SET state='pending',updated_at=? WHERE run_id=? AND state='sending'").run(nowIso(), run.id);
    }
    // 恢复未完成投递
    for (const subscription of listSubscriptions(this.store)) {
      if (!subscription.config.enabled) continue;
      await this.deliverFor(subscription).catch(() => {});
    }
  }

  /* tick()：契约
     入参：无
     副作用：可能创建 run 并执行；更新 next_planned_at
     谁调用：start 的轮询、powerMonitor resume
     改动影响：铁律一/三/九——只对 enabled 订阅、每天最多一期、只补宽限内最近一期 */
  async tick() {
    if (this.stopped) return;
    const now = this.clock();
    for (const subscription of listSubscriptions(this.store)) {
      try { await this.tickSubscription(subscription, now); }
      catch (error) { this.logger.error?.(`[news] 订阅 ${subscription.id} 处理失败：${error.message}`); }
    }
    // 处理待投递（含重启恢复与安静时段到期）
    for (const subscription of listSubscriptions(this.store)) {
      if (subscription.config.enabled) await this.deliverFor(subscription).catch(() => {});
    }
  }

  async tickSubscription(subscription, now) {
    const config = subscription.config;
    if (!config.enabled) return;
    const zone = config.timeZone;
    const localToday = Temporal.Instant.from(nowIso(now)).toZonedDateTimeISO(zone).toPlainDate().toString();
    const planned = plannedInstantFor(config, localToday);
    const grace = config.catchupGraceMinutes * 60000;
    const plannedMs = Number(Temporal.Instant.from(planned).epochMilliseconds);
    const runKey = autoRunKey(subscription.id, localToday);
    const existing = this.store.db.prepare('SELECT * FROM news_runs WHERE run_key=?').get(runKey);

    // next_planned_at 只用于界面显示
    const nextPlan = existing ? nextPlanAfter(config, nowIso(now)) : planned;
    this.store.db.prepare('UPDATE news_subscriptions SET next_planned_at=? WHERE id=?').run(nextPlan, subscription.id);

    if (existing) return;                                  // 今天这期已存在（跑过/正在跑/跳过）
    if (now < plannedMs) return;                           // 未到点
    if (now > plannedMs + grace) {                         // 过期 → 记 skipped + 原因（铁律三）
      claimRun(this.store, this.buildFields(subscription, { plannedAt: planned, plannedLocalDate: localToday, kind: 'auto', runKey, status: 'skipped' }));
      setRunState(this.store, this.store.db.prepare('SELECT id FROM news_runs WHERE run_key=?').get(runKey).id, 'skipped', { notes: '计划时刻已超过补跑宽限，本期跳过' });
      return;
    }
    const claim = claimRun(this.store, this.buildFields(subscription, { plannedAt: planned, plannedLocalDate: localToday, kind: 'auto', runKey }));
    if (claim.skipped) return;
    await this.executeRun(claim.run);
  }

  buildFields(subscription, { plannedAt, plannedLocalDate, kind, runKey, manualWindowStart, manualWindowEnd }) {
    const config = subscription.config;
    const windowEnd = plannedAt;
    const windowStart = manualWindowStart || Temporal.Instant.from(plannedAt).subtract({ hours: config.windowHours }).toString();
    return {
      subscriptionId: subscription.id, runKey, kind, plannedAt, plannedLocalDate,
      timeZone: config.timeZone, windowStart, windowEnd: manualWindowEnd || windowEnd,
      config, modelSnapshot: this.modelSnapshot(),
    };
  }

  modelSnapshot() {
    try {
      const model = this.store.snapshot().settings.model || {};
      return { provider: model.provider, model: model.model, baseURL: model.baseURL };
    } catch { return {}; }
  }

  /* preview()：契约
     入参：subscriptionId、可选 { now }
     返回：runId
     副作用：创建 manual run 并执行（铁律八：独立 runKey，不占当天自动一期）
     谁调用：UI「试跑一次」 */
  async preview(subscriptionId, now = this.clock()) {
    const row = this.store.db.prepare('SELECT * FROM news_subscriptions WHERE id=? AND deleted_at IS NULL').get(subscriptionId);
    if (!row) throw new Error('订阅不存在');
    const subscription = rowToSubscription(row);
    const stamp = new Date(now).toISOString();
    const claim = claimRun(this.store, this.buildFields(subscription, {
      plannedAt: stamp, plannedLocalDate: stamp.slice(0, 10), kind: 'manual',
      runKey: manualRunKey(subscriptionId, stamp.replace(/[:.]/g, '-')),
      manualWindowStart: Temporal.Instant.from(stamp).subtract({ hours: subscription.config.windowHours }).toString(),
    }));
    if (claim.skipped) return claim.run.id;
    await this.executeRun(claim.run, { notifyOnly: true });
    return claim.run.id;
  }

  /* executeRun()：契约
     入参：run 行、可选 { notifyOnly }
     返回：{ status, digestId }
     副作用：搜索/整理/落简报/plan 投递（试跑只推 PC）
     谁调用：tickSubscription / preview
     改动影响：铁律四/五/六收口在这里：预算、停止、恢复。 */
  async executeRun(run, { notifyOnly = false } = {}) {
    const subscription = JSON.parse(run.config_snapshot);
    const startedAt = this.clock();
    const budget = { maxCalls: subscription.limits.maxSearchCalls, timeoutMs: subscription.limits.timeoutSeconds * 1000, startedAt };
    const deadline = startedAt + subscription.limits.timeoutSeconds * 1000;
    const controller = new AbortController();
    this.current = { runId: run.id, controller };
    const remaining = () => Math.max(0, deadline - this.clock());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(subscription.limits.timeoutSeconds * 1000)]);

    if (!acquireLease(this.store, run.id, this.owner)) return { status: 'queued', digestId: '' };
    try {
      setRunState(this.store, run.id, 'searching', { started_at: nowIso(startedAt) });

      // ---- 搜索阶段 ----
      const server = this.store.db.prepare('SELECT * FROM mcp_servers WHERE id=?').get(subscription.searchServerId);
      if (!server) throw Object.assign(new Error('搜索连接不存在或被删除，请到「工具连接」重新配置'), { code: 'SEARCH_CONFIG' });
      if (!server.enabled) throw Object.assign(new Error('搜索连接已停用'), { code: 'SEARCH_CONFIG' });
      const toolRow = this.store.db.prepare('SELECT * FROM mcp_tools WHERE server_id=? AND name=?').get(subscription.searchServerId, subscription.searchToolName);
      if (!toolRow) throw Object.assign(new Error(`所选搜索工具「${subscription.searchToolName}」已不存在，请重新选择`), { code: 'SEARCH_CONFIG' });
      const session = await this.mcpClient.connect(subscription.searchServerId);
      const searched = await searchSources({
        session, toolName: subscription.searchToolName, schema: JSON.parse(toolRow.schema_json || '{}'),
        subscription, run: { ...run, windowStart: run.window_start, windowEnd: run.window_end },
        maxCalls: budget.maxCalls, signal, logger: this.logger,
      });
      setRunState(this.store, run.id, 'summarizing', { search_calls: searched.calls });

      // ---- 整理阶段 ----
      const digest = await digestLib.buildDigest({
        subscription, run: runToDigestRun(run), sources: searched.sources, model: this.model, signal,
      });
      digest.callCounts = { searchCalls: searched.calls, modelCalls: digest.aiState === 'partial' ? 0 : 1, maxSearchCalls: subscription.limits.maxSearchCalls, maxModelCalls: subscription.limits.maxModelCalls };
      digest.failures = [...(digest.failures || []), ...searched.failures];
      digest.sources = searched.sources;
      setRunState(this.store, run.id, 'generated', { model_calls: digest.callCounts.modelCalls, finished_at: nowIso(), notes: digest.notice || '' });

      const digestId = digestLib.saveDigest(this.store, { ...digest, run: runToDigestRun(run) });

      // ---- 投递 ----
      if (notifyOnly) {
        this.notify({ title: subscription.name || '每日新闻', body: this.summaryLine(digest), digestId, subscriptionId: subscription.id, kind: 'preview' });
        return { status: digest.status, digestId };
      }
      delivery.planDeliveries(this.store, { run: runToDigestRun(run), digest: { ...digest, id: digestId }, subscription, targets: this.targets(run.subscription_id) });
      const fresh = this.store.db.prepare('SELECT * FROM news_subscriptions WHERE id=?').get(run.subscription_id);
      if (fresh) await this.deliverFor(rowToSubscription(fresh));
      return { status: digest.status, digestId };
    } catch (error) {
      const canceled = controller.signal.aborted;
      const restored = this.clock();
      setRunState(this.store, run.id, canceled ? 'canceled' : 'failed', {
        error: canceled ? '' : String(error.message || error).slice(0, 500),
        notes: canceled ? '用户停止' : (error.code === 'SEARCH_CONFIG' ? '配置问题，需用户处理' : '执行失败'),
        finished_at: nowIso(restored),
      });
      if (canceled) return { status: 'canceled', digestId: '' };
      if (error.code === 'SEARCH_CONFIG') throw error;
      return { status: 'failed', digestId: '' };
    } finally {
      releaseLease(this.store, run.id, this.owner);
      if (this.current?.runId === run.id) this.current = null;
      void remaining;
    }
  }

  summaryLine(digest) {
    if (digest.status === 'empty') return digest.notice || '本次没有可核实的新闻。';
    return (digest.notice ? digest.notice + ' ' : '') + `共 ${digest.items.length} 条：` + digest.items.slice(0, 3).map(item => item.title).join('；');
  }

  /* 投递当前订阅所有到期待发。试跑不走这里（试跑只推 PC）。 */
  async deliverFor(subscription) {
    const settings = this.settings();
    const grace = Math.max(60, subscription.config.catchupGraceMinutes);
    // ⚠️ planned_at 在 news_runs 上，不在 news_deliveries 上——投递期限基准从 run 取。
    const pending = this.store.db.prepare("SELECT d.run_id AS run_id, r.planned_at AS planned_at FROM news_deliveries d JOIN news_runs r ON r.id=d.run_id WHERE d.subscription_id=? AND d.state IN ('pending','failed') ORDER BY d.created_at LIMIT 1").get(subscription.id);
    let deadlineIso;
    if (pending) {
      const generated = this.store.db.prepare('SELECT generated_at FROM news_digests WHERE run_id=?').get(pending.run_id);
      const base = generated?.generated_at || pending.planned_at;
      deadlineIso = Temporal.Instant.from(base).add({ minutes: grace }).toString();
    }
    // ⚠️ deliverPending 吃的是「配置形态」的订阅（要有 channels/timeZone/respectQuietHours），
    // 不是 rowToSubscription 的外壳；这里把 id 拼回去。
    return delivery.deliverPending(this.store, {
      subscription: { ...subscription.config, id: subscription.id },
      settings, senders: this.senders, targets: this.targets(subscription.id), now: this.clock(), deadlineIso,
    });
  }

  /* targets()：契约
     入参：subscriptionId（可选；带上才会读取该订阅的 dm/group 目标选择）
     返回：defaultTargets 结果（desktop/feishu/weixin 的目标指纹与快照）
     副作用：无
     谁调用：deliverFor / executeRun
     改动影响：惰性计算——gateway 可能尚未连接，每次投递前重算能反映最新绑定与目标选择。 */
  targets(subscriptionId = '') {
    return delivery.defaultTargets(this.store, this.gateways || {}, subscriptionId);
  }

  /* stopRun()：契约
     入参：{ silent? }
     返回：{ stopped:boolean }
     副作用：abort 当前运行；≤1 秒内取消在途网络/模型调用（spec §9.2）
     谁调用：UI「停止当前执行」
     改动影响：铁律五——停止后不再提交新简报、不排队新投递；已提交结果保留。 */
  async stopRun({ silent = false } = {}) {
    const current = this.current;
    if (!current) return { stopped: false };
    current.controller.abort();
    setRunState(this.store, current.runId, 'canceled', { notes: '用户停止', finished_at: nowIso() });
    releaseLease(this.store, current.runId, this.owner);
    this.current = null;
    if (!silent) this.logger.info?.('[news] 运行已停止');
    return { stopped: true };
  }

  /* 运行历史 */
  listRuns(subscriptionId, limit = 50) {
    return this.store.db.prepare('SELECT * FROM news_runs WHERE subscription_id=? ORDER BY created_at DESC LIMIT ?').all(subscriptionId, limit)
      .map(run => ({
        id: run.id, kind: run.kind, status: run.status, plannedAt: run.planned_at, plannedLocalDate: run.planned_local_date,
        windowStart: run.window_start, windowEnd: run.window_end, searchCalls: run.search_calls, modelCalls: run.model_calls,
        error: run.error, notes: run.notes, startedAt: run.started_at || '', finishedAt: run.finished_at || '',
      }));
  }

  getDigest(runId) {
    const row = this.store.db.prepare('SELECT * FROM news_digests WHERE run_id=?').get(runId);
    if (!row) return null;
    return {
      digestId: row.id, runId: row.run_id, subscriptionId: row.subscription_id, plannedAt: row.planned_at,
      generatedAt: row.generated_at, timeZone: row.time_zone, windowStart: row.window_start, windowEnd: row.window_end,
      status: row.status, aiState: row.ai_state, items: JSON.parse(row.items || '[]'), itemCount: row.item_count,
      excluded: JSON.parse(row.excluded || '[]'), failures: JSON.parse(row.failures || '[]'), callCounts: JSON.parse(row.call_counts || '{}'),
    };
  }
}

module.exports = {
  NewsJobRunner, RUN_STATES,
  listSubscriptions, saveSubscription, setEnabled, deleteSubscription,
  plannedInstantFor, nextPlanAfter, autoRunKey, manualRunKey, claimRun, acquireLease, releaseLease, searchSources,
};
