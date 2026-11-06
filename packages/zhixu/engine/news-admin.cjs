/* ================================================================
   知序 · 对话式每日推送管理（下一轮 N01–N10：用聊天交代订阅）

  ▍这是什么
  ① 干什么：把「用户对话」翻译成的结构化动作（查询/创建/修改/改渠道/暂停恢复/删除）落到
     一期真实订阅服务（job-runner）——不另建只在聊天历史里的假计划。含指代消解（多订阅先
     问候选）、渠道替换/追加/移除三种语义、字段级修改（不动没提的字段）、幂等收据、越权拒绝。
  ② 技术栈：Node CommonJS + 一期 job-runner（订阅 CRUD/计划计算）+ news-delivery（渠道取消）。
  ③ 依赖：store.cjs、job-runner.cjs、news-delivery.cjs、json-schema.cjs（默认值）。
  ④ 给谁看：改对话里怎么管订阅、改渠道语义、改指代消解规则的人。

  ▍文件从上到下的结构
  展示层        describe()：订阅 → 给用户/模型看的结构化读数（含下一次执行）★核心★
  指代消解      resolveTarget()：显式 id → 会话焦点 → 唯一订阅 → 否则返回候选（不修改）
  幂等收据      withReceipt()：按 (会话请求id, 动作指纹) 去重，重投/重复调用不重复建
  越权          assertOwner()：群消息等非本人来源一律拒绝改私人订阅
  动作          adminList / adminCreate / adminUpdate / adminSetEnabled / adminDelete
  渠道语义      applyChannels()：replace（只发到）/ add（也发到）/ remove（不用推了）

  ▍修改铁律
  1. 铁律一：说「都不推了」【不】许存成「没有渠道但仍运行」的隐藏任务——渠道被清空一律
     转成暂停（保留配置便于恢复，spec 下一轮 §2）。
  2. 铁律二：修改【只】提交用户真正改动的字段。【不】把没提到的时间/渠道/启用状态/工具连接/
     执行上限重置成默认值（spec 下一轮 §3）。做法是「读真实配置 → 合并 → 写回」。
  3. 铁律三：渠道加不上就是加不上。选了飞书但没绑定 → 明确报错，【不】悄悄降级成「只推 App」
      （spec 下一轮 §3）。
  4. 铁律四：多订阅且没指明对象 → 先列候选询问，【不】默认改第一条，【不】批量全改（N04）。
  5. 铁律五：只有本人（私人单聊 / 桌面）能改私人订阅。群成员交代（带 taskOrigin）一律拒绝，
     搜索/工具返回内容不构成授权（N09）。
  6. 铁律六：幂等键 = (会话请求 id, 动作指纹)。同一手机事件重投、模型重复工具调用、应用重启
     都不产生第二条订阅（N06）。

  ▍特殊机制
  "会话焦点"：某会话里刚确认/刚创建的订阅 id 存 metadata（newsChatFocus:<sessionId>），
   之后「改成八点」这类省略主语的交代就靠它定位——这就是 spec §3 说的「当前对话中已确认的 ID」。
  "动作指纹"：把规范化后的动作（不含自由文本措辞）散列，用于幂等。

  ▍外号表
  "焦点"   → newsChatFocus 里记的当前订阅
  "收据"   → news_admin_receipts 行，防重复创建
  "候选"   → resolveTarget 返回的多个可改订阅

  ▍更新记录
  *更新：2026-10-13 · 新建：下一轮对话式订阅管理（N01–N10）*

  ================================================================ */
'use strict';
const crypto = require('node:crypto');
const runner = require('./job-runner.cjs');
const delivery = require('./news-delivery.cjs');
const { normalizeSubscription, ContractError } = require('./json-schema.cjs');

const CHANNEL_LABEL = { desktop: 'App', feishu: '飞书', weixin: '微信' };
const CHANNEL_MODES = ['replace', 'add', 'remove'];
/* 创建时可写字段 = 普通可写字段 + 三个必填（搜索连接/工具/时区）+ channels（创建时直接设定
   推送位置）。修改时不接受改搜索连接与工具（spec 下一轮 §3「不得把没提到的工具连接重置」），
   也不走这个列表——修改的渠道改走 applyChannels 的三语义。 */
const CREATE_FIELDS = ['name', 'topics', 'keywords', 'excludeTopics', 'summaryStyle', 'searchServerId',
  'searchToolName', 'sendTime', 'timeZone', 'windowHours', 'newsCount', 'language', 'channels',
  'notifyPet', 'respectQuietHours', 'catchupGraceMinutes'];
const WRITABLE = ['name', 'topics', 'keywords', 'excludeTopics', 'summaryStyle', 'sendTime', 'timeZone',
  'windowHours', 'newsCount', 'language', 'notifyPet', 'respectQuietHours', 'catchupGraceMinutes'];

/* 稳定序列化：同一组动作字段永远得到同一串，用于幂等指纹 */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}
const sha = value => crypto.createHash('sha256').update(stable(value)).digest('hex').slice(0, 32);

const labelChannels = channels => (channels && channels.length ? channels.map(channel => CHANNEL_LABEL[channel] || channel).join('＋') : '（无）');

/* ================================================================
   越权闸门（N09）
   ================================================================ */
/* assertOwner()：契约
   入参：ctx = { source, sessionId, taskOrigin, requestId }
   返回：无（越权直接抛错）
   副作用：无
   谁调用：所有写动作开头
   改动影响：铁律五——群消息（带 taskOrigin）一律拒绝；这是「群成员不能改私人订阅/目标」的
     唯一执行点，【不】能只靠提示词。搜索/工具返回内容根本进不了这里（它们只是资料文本）。 */
function assertOwner(ctx) {
  if (ctx && ctx.taskOrigin) {
    throw new ContractError('FORBIDDEN', '群聊里的交代不能修改私人的每日推送订阅或接收目标；请让本人在私人单聊或 App 里改。');
  }
}

/* ================================================================
   展示层
   ================================================================ */
/* describe()：契约
   入参：store、订阅对象（rowToSubscription 形态）
   返回：结构化读数（id/version/名称/主题/关键词/排除/风格/时间/时区/条数/渠道/启用/下一次执行）
   副作用：无
   谁调用：所有动作的返回值、adminList
   改动影响：回复（无论界面还是对话）都用这个读数，避免「模型文字当保存结果」——读数直接来自
     落库后的真实行。nextPlannedAt 用 job-runner.nextPlanAfter 现算。 */
function describe(store, subscription) {
  const config = subscription.config;
  return {
    id: subscription.id,
    version: subscription.version,
    name: config.name,
    topics: config.topics,
    keywords: config.keywords || [],
    excludeTopics: config.excludeTopics || [],
    summaryStyle: config.summaryStyle || 'standard',
    sendTime: config.sendTime,
    timeZone: config.timeZone,
    windowHours: config.windowHours,
    newsCount: config.newsCount,
    language: config.language,
    channels: config.channels,
    channelLabels: labelChannels(config.channels),
    notifyPet: config.notifyPet,
    respectQuietHours: config.respectQuietHours,
    enabled: config.enabled,
    updatedAt: subscription.updatedAt,
    nextPlannedAt: config.enabled ? safeNextPlan(config) : '',
  };
}

function safeNextPlan(config) {
  try { return runner.nextPlanAfter(config); } catch { return ''; }
}

function findRow(store, id) {
  return store.db.prepare('SELECT * FROM news_subscriptions WHERE id=? AND deleted_at IS NULL').get(id);
}
function loadSubscription(store, id) {
  const row = findRow(store, id);
  return row ? {
    id: row.id, version: row.version, config: JSON.parse(row.config),
    createdAt: row.created_at, updatedAt: row.updated_at, nextPlannedAt: row.next_planned_at || '',
  } : null;
}

function adminList(store) {
  return runner.listSubscriptions(store).map(subscription => describe(store, subscription));
}

/* ================================================================
   会话焦点（指代消解的依据）
   ================================================================ */
function focusKey(sessionId) { return 'newsChatFocus:' + (sessionId || 'desktop'); }
function readFocus(store, sessionId) {
  const row = store.db.prepare('SELECT value FROM metadata WHERE key=?').get(focusKey(sessionId));
  return row?.value || '';
}
function writeFocus(store, sessionId, subscriptionId) {
  store.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(focusKey(sessionId), subscriptionId);
}

/* resolveTarget()：契约
   入参：store、{ subscriptionId?, sessionId? }
   返回：{ subscription } 或 { ambiguous:true, candidates:[...] }
   副作用：命中唯一/焦点时写会话焦点（便于后续省略主语的交代）
   谁调用：adminUpdate / adminSetEnabled / adminDelete
   改动影响：铁律四——顺序是「显式 id → 会话焦点（仍存在）→ 全库唯一 → 返回候选」。
     ⚠️ 多订阅且无焦点时【不】返回第一条，必须让上层把候选抛给用户（N04）。 */
function resolveTarget(store, { subscriptionId, sessionId } = {}) {
  if (subscriptionId) {
    const subscription = loadSubscription(store, subscriptionId);
    if (!subscription) throw new ContractError('NOT_FOUND', '找不到这个订阅（可能已删除），请先查看当前订阅。');
    writeFocus(store, sessionId, subscription.id);
    return { subscription };
  }
  const focus = readFocus(store, sessionId);
  if (focus) {
    const subscription = loadSubscription(store, focus);
    if (subscription) return { subscription };
  }
  const all = runner.listSubscriptions(store);
  if (all.length === 1) { writeFocus(store, sessionId, all[0].id); return { subscription: all[0] }; }
  return { ambiguous: true, candidates: all.map(subscription => describe(store, subscription)) };
}

/* 把「候选」变成给模型/用户看的追问文本（不改任何东西） */
function ambiguityResult(candidates) {
  return {
    ok: false, needsClarification: true, reason: 'AMBIGUOUS_TARGET',
    message: '你有多个每日推送订阅，请说明要改哪一个（回复订阅名称或 ID）。',
    candidates,
  };
}

/* ================================================================
   幂等收据（N06）
   ================================================================ */
/* withReceipt()：契约
   入参：store、{ requestId, digest }、produce()（真正干活的函数）
   返回：首次执行的结果；重复调用返回首次结果（带 replayed 标记）
   副作用：写 news_admin_receipts；(requestId,digest) 唯一
   谁调用：adminCreate/adminUpdate/adminSetEnabled/adminDelete
   改动影响：铁律六——同一手机事件重投（request_id 稳定）或模型在同一轮重复调用同一动作
     （动作指纹相同）都命中同一收据，【不】产生第二条订阅。 */
function withReceipt(store, { requestId, digest }, produce) {
  const scope = String(requestId || 'adhoc');
  const existing = store.db.prepare('SELECT result FROM news_admin_receipts WHERE scope_key=? AND digest=?').get(scope, digest);
  if (existing) return { ...JSON.parse(existing.result), replayed: true };
  const result = produce();
  store.db.prepare('INSERT OR REPLACE INTO news_admin_receipts(scope_key,digest,result,created_at) VALUES(?,?,?,?)')
    .run(scope, digest, JSON.stringify(result), new Date().toISOString());
  return result;
}

/* ================================================================
   渠道语义（N03/N08）
   ================================================================ */
/* applyChannels()：契约
   入参：store、旧渠道数组、{ channels, channelMode }
   返回：{ channels, canceled:[channel] }
   副作用：移除渠道时取消该渠道未发投放（cancelChannel）
   谁调用：adminUpdate
   改动影响：铁律一/三——三种模式：replace=只发到（整体替换）、add=也发到（并集）、
     remove=不用推了（差集）。结果为空 → 抛 NEEDS_PAUSE，让调用方转暂停（不许存空渠道）。
     被移除的渠道要立刻取消未发投放（spec 下一轮 §4）。 */
function applyChannels(store, subscriptionId, current, { channels, channelMode }) {
  if (!Array.isArray(channels) || !channels.length) throw new ContractError('INVALID_ARGUMENT', '请说明推送位置（App／飞书／微信）。');
  const invalid = channels.filter(channel => !delivery.CHANNELS.includes(channel));
  if (invalid.length) throw new ContractError('INVALID_ARGUMENT', '推送位置无效：' + invalid.join('、'));
  const mode = CHANNEL_MODES.includes(channelMode) ? channelMode : 'replace';
  const before = [...current];
  let next;
  if (mode === 'add') next = [...new Set([...before, ...channels])];
  else if (mode === 'remove') next = before.filter(channel => !channels.includes(channel));
  else next = [...new Set(channels)];
  // 铁律一：结果为空 = 用户其实想「都不推了」→ 转暂停（保留配置），【不】存无渠道的隐藏任务。
  if (!next.length) throw new ContractError('NEEDS_PAUSE', '把所有推送位置都去掉相当于暂停；请改用暂停，配置会保留便于恢复。');
  const removed = before.filter(channel => !next.includes(channel));
  for (const channel of removed) delivery.cancelChannel(store, subscriptionId, channel);
  return { channels: next, canceled: removed, mode };
}

/* ================================================================
   动作：创建 / 修改 / 启停 / 删除
   ================================================================ */
/* 把动作参数里「用户真正提供的可写字段」挑出来（没提供的不进 merge，保证不重置旧值） */
function pickProvided(args, fields = WRITABLE) {
  const provided = {};
  for (const key of fields) if (args[key] !== undefined) provided[key] = args[key];
  return provided;
}

/* 校验启用就绪（模型/搜索工具/手机通道），失败要明确报错、不静默降级（铁律三）。
   deps = { modelReady:()=>bool|{ready,reason}, targets:()=>defaultTargets 结果 } */
function assertReadyToEnable(store, config, deps = {}) {
  const reasonOf = value => (value && typeof value === 'object' ? value.reason || '' : '');
  if (deps.modelReady) {
    const ready = deps.modelReady();
    if (ready === false || (ready && ready.ready === false)) {
      throw new ContractError('NOT_READY', reasonOf(ready) || '请先在设置里完成模型配置，再启用每日推送。');
    }
  }
  const server = store.db.prepare('SELECT * FROM mcp_servers WHERE id=? AND enabled=1').get(config.searchServerId);
  if (!server) throw new ContractError('NOT_READY', '所选搜索连接不可用，请到「工具连接」检测后重试。');
  const tool = store.db.prepare('SELECT * FROM mcp_tools WHERE server_id=? AND name=?').get(config.searchServerId, config.searchToolName);
  if (!tool) throw new ContractError('NOT_READY', `所选搜索工具「${config.searchToolName}」已不存在，请重新选择。`);
  const targets = deps.targets ? deps.targets() : {};
  for (const channel of config.channels) {
    if (channel === 'desktop') continue;
    if (!targets[channel]) {
      throw new ContractError('NOT_READY', `你选择了${CHANNEL_LABEL[channel]}推送，但这个通道还没有可用的私人单聊，请先连接并绑定；我不会悄悄改成只推 App。`);
    }
  }
}

function adminCreate(store, args, ctx = {}, deps = {}) {
  assertOwner(ctx);
  let provided = pickProvided(args, CREATE_FIELDS);
  // 没指名搜索连接时，用「用户已明确选定的默认」并把它写进回复（spec 下一轮 §3）；取不到就补问。
  if (!provided.searchServerId || !provided.searchToolName) {
    const fallback = defaultSearchConfig(store);
    if (!fallback) throw new ContractError('NEEDS_SEARCH', '还没有可用的搜索连接。请先到「工具连接」检测并选定一个搜索工具，我再建订阅。');
    provided = { ...fallback, ...provided };
  }
  const enabled = args.enabled === undefined ? true : !!args.enabled;   // 明确交代默认直接启用
  const digest = sha({ action: 'create', provided });
  return withReceipt(store, { requestId: ctx.requestId, digest }, () => {
    const saved = runner.saveSubscription(store, { ...provided });
    if (enabled) {
      const row = findRow(store, saved.id);
      const config = JSON.parse(row.config);
      assertReadyToEnable(store, config, deps);
      const updated = runner.setEnabled(store, saved.id, true);
      writeFocus(store, ctx.sessionId, updated.id);
      return { ok: true, action: 'create', subscription: describe(store, updated) };
    }
    writeFocus(store, ctx.sessionId, saved.id);
    return { ok: true, action: 'create', subscription: describe(store, saved) };
  });
}

function adminUpdate(store, args, ctx = {}, deps = {}) {
  assertOwner(ctx);
  const resolved = resolveTarget(store, { subscriptionId: args.subscriptionId, sessionId: ctx.sessionId });
  if (resolved.ambiguous) return ambiguityResult(resolved.candidates);
  const subscription = resolved.subscription;
  if (args.expectedVersion !== undefined && args.expectedVersion !== subscription.version) {
    throw new ContractError('VERSION_CONFLICT', '这条订阅已被其他操作修改，请刷新后重试。');
  }
  const digest = sha({ action: 'update', id: subscription.id, provided: pickProvided(args), channels: args.channels, channelMode: args.channelMode });
  return withReceipt(store, { requestId: ctx.requestId, digest }, () => {
    // 铁律二：以真实旧配置为底，只覆盖用户真正改动的字段（不重置没提的字段）
    const next = { ...subscription.config };
    for (const [key, value] of Object.entries(pickProvided(args))) next[key] = value;
    // 渠道三语义：可能改 next.channels 并取消被移除渠道的未发投放
    let canceled = [];
    if (args.channels !== undefined) {
      let applied;
      try {
        applied = applyChannels(store, subscription.id, subscription.config.channels, { channels: args.channels, channelMode: args.channelMode });
      } catch (error) {
        // 铁律一：渠道被清空 = 用户其实想「都不推了」→ 转暂停，保留原渠道配置便于恢复，
        // 【不】存成无渠道仍在跑的隐藏任务（spec 下一轮 §2）。
        if (error.code === 'NEEDS_PAUSE') {
          const paused = runner.setEnabled(store, subscription.id, false);
          writeFocus(store, ctx.sessionId, paused.id);
          return { ok: true, action: 'pause', subscription: describe(store, paused), note: '已暂停每日推送，原配置（含各推送位置）保留，随时可以恢复。' };
        }
        throw error;
      }
      next.channels = applied.channels;
      canceled = applied.canceled;
    }
    // 只有用户明确改启用状态时才动它；否则保持原状（不重置没提的字段）
    if (args.enabled !== undefined) next.enabled = !!args.enabled;
    // 复核：契约校验 + 启用就绪（形状错误/通道没绑定在这里统一暴露，不静默改）
    const validated = normalizeSubscription(next, next.timeZone);
    // 结果仍是「启用」时，新加的渠道必须真的可用（铁律三：不悄悄把「App＋飞书」降成「只推 App」）
    if (validated.enabled) assertReadyToEnable(store, validated, deps);
    const result = runner.saveSubscription(store, { id: subscription.id, version: subscription.version, ...validated });
    writeFocus(store, ctx.sessionId, result.id);
    return {
      ok: true, action: 'update', subscription: describe(store, result),
      changed: Object.keys(pickProvided(args)).concat(args.channels !== undefined ? ['channels'] : []),
      canceledChannels: canceled,
    };
  });
}

function adminSetEnabled(store, args, ctx = {}) {
  assertOwner(ctx);
  const resolved = resolveTarget(store, { subscriptionId: args.subscriptionId, sessionId: ctx.sessionId });
  if (resolved.ambiguous) return ambiguityResult(resolved.candidates);
  const want = !!args.enabled;
  const digest = sha({ action: 'setEnabled', id: resolved.subscription.id, enabled: want });
  return withReceipt(store, { requestId: ctx.requestId, digest }, () => {
    const result = runner.setEnabled(store, resolved.subscription.id, want);
    writeFocus(store, ctx.sessionId, result.id);
    return { ok: true, action: want ? 'resume' : 'pause', subscription: describe(store, result) };
  });
}

function adminDelete(store, args, ctx = {}) {
  assertOwner(ctx);
  const resolved = resolveTarget(store, { subscriptionId: args.subscriptionId, sessionId: ctx.sessionId });
  if (resolved.ambiguous) return ambiguityResult(resolved.candidates);
  const digest = sha({ action: 'delete', id: resolved.subscription.id });
  return withReceipt(store, { requestId: ctx.requestId, digest }, () => {
    const snapshot = describe(store, resolved.subscription);
    runner.deleteSubscription(store, resolved.subscription.id);   // 软删 + 取消未提交运行与未发投放
    const row = store.db.prepare('SELECT value FROM metadata WHERE key=?').get(focusKey(ctx.sessionId));
    if (row?.value === resolved.subscription.id) store.db.prepare('DELETE FROM metadata WHERE key=?').run(focusKey(ctx.sessionId));
    return { ok: true, action: 'delete', subscription: snapshot };
  });
}

/* 查询：我现在订阅了什么（真实订阅 + 范围 + 时间 + 渠道 + 状态 + 下一次执行） */
function adminQuery(store, args = {}, ctx = {}) {
  assertOwner(ctx);
  const all = adminList(store);
  if (args.subscriptionId) {
    const subscription = loadSubscription(store, args.subscriptionId);
    if (!subscription) throw new ContractError('NOT_FOUND', '找不到这个订阅。');
    return { ok: true, action: 'query', subscriptions: [describe(store, subscription)] };
  }
  return { ok: true, action: 'query', subscriptions: all, count: all.length };
}

/* defaultSearchConfig()：契约
   入参：store
   返回：{ searchServerId, searchToolName } 或 null
   副作用：无
   谁调用：adminCreate（用户没指名搜索连接时用「已明确选定的默认」）
   改动影响：spec 下一轮 §3「可采用用户已明确选定的默认设置」——取第一个已启用且选定了工具的
     连接。取不到就返回 null，让上层补问，【不】瞎猜（猜错会静默搜不到东西）。 */
function defaultSearchConfig(store) {
  const servers = store.db.prepare('SELECT * FROM mcp_servers WHERE enabled=1 ORDER BY created_at').all();
  for (const server of servers) {
    const tool = store.db.prepare('SELECT name FROM mcp_tools WHERE server_id=? AND selected=1 ORDER BY name LIMIT 1').get(server.id)
      || store.db.prepare("SELECT name FROM mcp_tools WHERE server_id=? AND name LIKE '%search%' ORDER BY name LIMIT 1").get(server.id);
    if (tool) return { searchServerId: server.id, searchToolName: tool.name };
  }
  return null;
}

module.exports = {
  CHANNEL_LABEL, CHANNEL_MODES, WRITABLE, CREATE_FIELDS,
  describe, adminList, adminQuery, adminCreate, adminUpdate, adminSetEnabled, adminDelete,
  resolveTarget, ambiguityResult, applyChannels, assertOwner, assertReadyToEnable, withReceipt,
  readFocus, writeFocus, loadSubscription, defaultSearchConfig,
};
