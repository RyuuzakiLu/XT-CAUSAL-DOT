/* ================================================================
   知序 · 新闻投递（R09：PC / 桌宠 / 私人飞书 / 微信，独立发送状态）

  ▍这是什么
  ① 干什么：把一份简报按渠道分段，生成稳定 deliveryId 的待发记录，逐条投递并维护状态
     （pending/sending/sent/failed/uncertain/canceled/blocked）；换账号后旧待发改 blocked；
     安静时段延后；投递期限外不无限重发。
  ② 技术栈：Node CommonJS；飞书/微信复用现有 gateway 的 enqueue 能力。
  ③ 依赖：store.cjs（news_deliveries + gateway_outbox）、pet-notices（桌宠）、
     settings（quiet 开关、通道转发开关）。
  ④ 给谁看：改投递状态机、分段规则、目标快照的人。

  ▍文件从上到下的结构
  目标指纹        targetFingerprint()：通道账号/绑定身份的稳定指纹（★核心★）
  分段             segmentText()：按平台限制稳定切段，保留日期与链接
  待发生成         planDeliveries()：run+channel+target+part → 稳定 deliveryId
  目标变化         refreshTargets()：换账号/解绑 → 旧待发 blocked
  安静时段         quietWindow()：08:00–22:00 之外延后（spec §8）
  投递执行         deliverPending()：取到期的待发逐条投；sent 只在平台确认后
  状态迁移         markSent/markFailed/markUncertain

  ▍修改铁律
  1. 铁律一：deliveryId = 稳定键（runId+channel+targetFingerprint+part），【不】要每次重试
     换新 ID——换了就没法去重，会重复发（spec §11.2）。
  2. 铁律二：「平台接受发送」只记 sent，【不】等于手机已到达。界面要提示用户到手机确认；
     真实手机验收另记（spec §11.2）。
  3. 铁律三：超时/进程退出且无法判定平台是否接受 → uncertain。没有平台可验证的去重保证时
     【不】盲重试；界面允许先去手机查再显式重试，并说明可能重复（spec §11.2）。
  4. 铁律四：目标快照保存通道账号/绑定身份；换账号或解绑后旧待发改 target_changed/blocked，
     【不】自动发给新账号（spec §11.2）。
  5. 铁律五：PC 简报始终保存。新闻通道开关独立于 forwardReminders——关了普通提醒转发，
     新闻照样按自己的设置投（spec §11.1）。
  6. 铁律六：只向私人单聊投递，【不】向所有飞书群广播，【不】把新闻伪装成群成员创建的任务
     （spec §11.1，飞书群事务能力继续保持原有行为）。
  7. 铁律七：segmentText 分段保留简报日期和链接；分段失败只处理未确认成功的部分。

  ▍特殊机制
  "目标指纹"：desktop 用固定 "desktop"；feishu 用 scope+chatId+memberId 的散列；
  weixin 用登录账号 ownerId 的散列。指纹变了 = 换了账号，旧记录 blocked。
  "投递期限"：计划允许发送时刻后 max(60,catchupGraceMinutes) 分钟；超期停 failed 等用户处理。

  ▍外号表
  "待发"   → news_deliveries 里 state=pending 的行
  "指纹"   → targetFingerprint
  "期限"   → 投递截止（计划时刻 + grace）

  ▍更新记录
  *更新：2026-10-12 · 新建：R09 投递（分段/指纹/状态机/安静时段/期限/目标变化）*

  ================================================================ */
'use strict';
const crypto = require('node:crypto');
const { Temporal } = require('@js-temporal/polyfill');

const CHANNELS = ['desktop', 'feishu', 'weixin'];
const MAX_PART_CHARS = 900;         // 单段上限（保守，飞书/微信都吃得下）

/* ================================================================
   时间与文本工具
   ================================================================ */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}
const sha = value => crypto.createHash('sha256').update(stable(value)).digest('hex').slice(0, 32);

/* 简报日期（投递截止/去重键要用，spec §11.2「保留简报日期」） */
function digestDate(digest) {
  return String(digest.plannedAt || digest.generatedAt || new Date().toISOString()).slice(0, 10);
}

/* ================================================================
   分段
   ================================================================ */
/* segmentText()：契约
   入参：digest（含 items[]、status）、maxChars
   返回：string[]（每段一段投递文本，保留日期与每条的来源链接）
   副作用：无
   谁调用：planDeliveries
   改动影响：铁律七——分段要稳定（同输入同结果），否则重试会产生不同分段造成重复。 */
function segmentText(digest, maxChars = MAX_PART_CHARS) {
  const parts = [];
  const header = `【${digest.name || '每日新闻'} · ${digestDate(digest)}】`;
  const lines = (digest.items || []).map((item, index) => {
    const links = (item.sources || []).map(source => source.url).filter(Boolean).slice(0, 3);
    const summary = String(item.summary || '').replace(/\s+/g, ' ').trim();
    return `${index + 1}. ${item.title}\n${summary}${links.length ? '\n来源：' + links.join(' ') : ''}`;
  });
  if (!lines.length) {
    parts.push(`${header}\n${digest.notice || '本次没有可投递的新闻条目。'}`);
    return parts;
  }
  let buffer = header;
  for (const line of lines) {
    if ((buffer + '\n' + line).length > maxChars && buffer !== header) { parts.push(buffer); buffer = `${digest.name || '每日新闻'}（续）`; }
    buffer += '\n' + line;
  }
  parts.push(buffer);
  return parts;
}

/* ================================================================
   目标指纹与快照
   ================================================================ */
const TARGET_KINDS = ['dm', 'group'];

/* choiceFor()：读订阅的渠道目标选择（存 news_targets；缺省 = dm 私人单聊）。
   ⚠️ 目标选择不进配置契约（契约 additionalProperties:false），按 spec §8 作为运行时字段单存。 */
function choiceFor(store, subscriptionId, channel) {
  if (!subscriptionId) return { kind: 'dm', id: '' };
  const row = store.db.prepare('SELECT target_kind,target_id FROM news_targets WHERE subscription_id=? AND channel=?').get(subscriptionId, channel);
  if (!row) return { kind: 'dm', id: '' };
  return { kind: TARGET_KINDS.includes(row.target_kind) ? row.target_kind : 'dm', id: row.target_id || '' };
}

/* saveTargetChoice()：契约
   入参：store、subscriptionId、channel、{kind:'dm'|'group', id?}
   返回：{kind,id}
   副作用：写 news_targets
   谁调用：UI「推送位置」里选群 / main.cjs IPC
   改动影响：改目标会让 target_fingerprint 变化 → 旧待发改 blocked（spec §11.2），【不】自动改发新目标 */
function saveTargetChoice(store, subscriptionId, channel, input) {
  if (!CHANNELS.includes(channel) || channel === 'desktop') throw new Error('桌面渠道不需要目标选择');
  const kind = input?.kind === 'group' ? 'group' : 'dm';
  const id = kind === 'group' ? String(input?.id || '').trim() : '';
  if (kind === 'group' && !id) throw new Error('选择群推送时请指定一个群');
  if (id.length > 200) throw new Error('群标识过长');
  store.db.prepare('INSERT INTO news_targets VALUES(?,?,?,?,?) ON CONFLICT(subscription_id,channel) DO UPDATE SET target_kind=excluded.target_kind,target_id=excluded.target_id,updated_at=excluded.updated_at')
    .run(subscriptionId, channel, kind, id, new Date().toISOString());
  return { kind, id };
}

/* defaultTargets()：契约
   入参：store、gateways{feishu?,weixin?}、subscriptionId（可选，用于读该订阅的目标选择）
   返回：{ desktop:{fingerprint,target}, feishu:{...}|null, weixin:{...}|null }
   副作用：无
   谁调用：job-runner 每轮投递前算一次，传给 planDeliveries/refreshTargets/deliverPending
   改动影响：铁律四——指纹只反映「当前账号身份 + 目标」。真实绑定来自网关方法；
     group 目标额外把 groupId 混进指纹，换群/换账号都会让旧待发改 blocked。
     ⚠️ group 只发「用户显式指定的那一个群」，【不】向所有群广播（spec §11.1 的受控扩展）。 */
function defaultTargets(store, gateways = {}, subscriptionId = '') {
  const targets = { desktop: { fingerprint: 'desktop', target: { channel: 'desktop' } } };
  for (const channel of ['feishu', 'weixin']) {
    const gateway = gateways[channel];
    const choice = choiceFor(store, subscriptionId, channel);
    // 群推送只有飞书支持（微信用私人会话，见 spec §11.1）
    if (choice.kind === 'group' && channel === 'feishu') {
      const group = gateway?.newsGroupTarget?.(choice.id) || null;
      targets[channel] = group ? { fingerprint: sha({ channel, kind: 'group', ...group }), target: { channel, kind: 'group', ...group } } : null;
      continue;
    }
    const found = gateway?.newsTarget?.() || null;
    targets[channel] = found ? { fingerprint: sha({ channel, kind: 'dm', ...found }), target: { channel, kind: 'dm', ...found } } : null;
  }
  return targets;
}

/* 兼容：无 gateway 时退回「从 gateway_outbox 推最近绑定」的旧路径（测试/无 gateway 场景） */
function targetFingerprint(store, channel) {
  if (channel === 'desktop') return { fingerprint: 'desktop', target: { channel: 'desktop' } };
  if (channel === 'feishu') {
    const row = store.db.prepare("SELECT owner_id,chat_id,scope FROM gateway_outbox WHERE scope LIKE 'feishu:%' ORDER BY created_at DESC LIMIT 1").get();
    if (!row) return null;
    return { fingerprint: sha({ channel, scope: row.scope, chatId: row.chat_id, ownerId: row.owner_id }), target: { channel, kind: 'dm', scope: row.scope, chatId: row.chat_id, ownerId: row.owner_id } };
  }
  if (channel === 'weixin') {
    const row = store.db.prepare("SELECT owner_id,chat_id FROM gateway_outbox WHERE scope='weixin' ORDER BY created_at DESC LIMIT 1").get();
    if (!row) return null;
    return { fingerprint: sha({ channel, ownerId: row.owner_id }), target: { channel, kind: 'dm', ownerId: row.owner_id, chatId: row.chat_id } };
  }
  return null;
}

/* ================================================================
   待发生成
   ================================================================ */
/* planDeliveries()：契约
   入参：store、{ run, digest, subscription, targets }（targets 来自 defaultTargets）
   返回：新增/已存在的 deliveryId 列表
   副作用：写 news_deliveries（deliveryId 唯一，重复调用不新增）
   谁调用：job-runner 生成简报后
   改动影响：铁律一——deliveryId 由 (runId, channel, targetFingerprint, part) 算出，幂等。 */
function planDeliveries(store, { run, digest, subscription, targets }) {
  const created = [];
  const segments = segmentText({ ...digest, name: subscription.name });
  const now = new Date().toISOString();
  for (const channel of subscription.channels) {
    if (!CHANNELS.includes(channel)) continue;
    const target = (targets && targets[channel]) || targetFingerprint(store, channel);
    if (!target) {                                   // 通道未绑定：记录 blocked，界面上单独提示
      const deliveryId = sha({ run: run.id, channel, fingerprint: 'unbound', part: 0 });
      upsertDelivery(store, deliveryId, { run, digestId: digest.id, subscriptionId: run.subscriptionId, channel, targetFingerprint: 'unbound', part: 0, parts: segments.length, state: 'blocked', content: '', error: '通道未绑定，请先在设置里连接' });
      created.push(deliveryId);
      continue;
    }
    const parts = channel === 'desktop' ? [segments[0]] : segments;
    parts.forEach((content, part) => {
      const deliveryId = sha({ run: run.id, channel, fingerprint: target.fingerprint, part });
      upsertDelivery(store, deliveryId, { run, digestId: digest.id, subscriptionId: run.subscriptionId, channel, targetFingerprint: target.fingerprint, part, parts: parts.length, state: 'pending', content, error: '' });
      created.push(deliveryId);
    });
  }
  return created;
}

function upsertDelivery(store, deliveryId, row) {
  const existing = store.db.prepare('SELECT delivery_id FROM news_deliveries WHERE delivery_id=?').get(deliveryId);
  const now = new Date().toISOString();
  if (existing) return;
  store.db.prepare('INSERT INTO news_deliveries(delivery_id,digest_id,run_id,subscription_id,channel,target_fingerprint,part,parts,state,content,attempts,next_at,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(deliveryId, row.digestId, row.run.id, row.subscriptionId, row.channel, row.targetFingerprint, row.part, row.parts, row.state, row.content, 0, 0, row.error || '', now, now);
}

/* ================================================================
   目标变化检测（换账号/解绑 → blocked）
   ================================================================ */
/* refreshTargets()：契约
   入参：store、subscription、targets（可选，来自 defaultTargets）
   返回：{ blocked:[deliveryId], changed:[channel] }
   副作用：把 fingerprint 不匹配的 pending 待发改 blocked
   谁调用：job-runner 在投递前每轮调用
   改动影响：铁律四——这里【不】改 content，也不改 target_fingerprint，只改状态+原因。 */
function refreshTargets(store, subscription, targets) {
  const blocked = [];
  const changed = [];
  for (const channel of subscription.channels) {
    const target = (targets && targets[channel]) || targetFingerprint(store, channel);
    const rows = store.db.prepare("SELECT delivery_id,target_fingerprint FROM news_deliveries WHERE subscription_id=? AND channel=? AND state IN ('pending','sending')").all(subscription.id, channel);
    if (!target) {
      for (const row of rows) { store.db.prepare("UPDATE news_deliveries SET state='blocked',error=?,updated_at=? WHERE delivery_id=?").run('通道当前不可用（未绑定或已断开）', new Date().toISOString(), row.delivery_id); blocked.push(row.delivery_id); }
      continue;
    }
    for (const row of rows) {
      if (row.target_fingerprint !== target.fingerprint) {
        store.db.prepare("UPDATE news_deliveries SET state='blocked',error=?,updated_at=? WHERE delivery_id=?").run('目标账号已变化，旧待发不再发送', new Date().toISOString(), row.delivery_id);
        blocked.push(row.delivery_id);
      }
    }
    if (rows.some(row => row.target_fingerprint !== target.fingerprint)) changed.push(channel);
  }
  return { blocked, changed };
}

/* ================================================================
   安静时段（spec §8）
   ================================================================ */
/* quietWindow()：契约
   入参：subscription、nowIso
   返回：{ delayed:boolean, untilIso:string }
   副作用：无
   谁调用：deliverPending 决定是否推迟手机投递
   改动影响：respectQuietHours 且全局 quiet 开启时，订阅时区当地时刻不在 08:00–22:00 就延后到
     08:00。生成和保存可继续，只有「提示及手机投递」延后（spec §8 原文）。 */
function quietWindow(subscription, settings, nowIso) {
  if (!subscription.respectQuietHours || !settings.quiet) return { delayed: false, untilIso: nowIso };
  const zone = subscription.timeZone || 'UTC';
  const local = Temporal.Instant.from(nowIso).toZonedDateTimeISO(zone);
  const hour = local.hour;
  if (hour >= 8 && hour < 22) return { delayed: false, untilIso: nowIso };
  const next = (hour >= 22 ? local.toPlainDate().add({ days: 1 }) : local.toPlainDate())
    .toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from('08:00') });
  return { delayed: true, untilIso: next.toInstant().toString() };
}

/* ================================================================
   投递执行
   ================================================================ */
/* deliverPending()：契约
   入参：store、{ subscription, settings, senders, now, deadlineIso, signal }
        senders = { feishu(payload)→{ok,error,dropped}, weixin(payload)→{...}, desktop(payload)→{ok} }
   返回：{ attempted, sent, failed, uncertain, blocked, delayedUntil }
   副作用：改 news_deliveries 状态；调用 senders 真投递；desktop 走 notify 回调
   谁调用：job-runner 投递阶段、UI「重试待发送」
   改动影响：铁律二/三——sent 只在 sender 明确 ok 后记；超时→uncertain。
     投递期限外【不】再发（spec §11.2），停 failed 等用户处理。 */
async function deliverPending(store, { subscription, settings, senders, targets, now = Date.now(), deadlineIso, signal }) {
  const nowIso = new Date(now).toISOString();
  const quiet = quietWindow(subscription, settings, nowIso);
  const result = { attempted: 0, sent: 0, failed: 0, uncertain: 0, blocked: 0, delayedUntil: quiet.delayed ? quiet.untilIso : '' };
  // 先按目标快照重判：换账号/解绑的旧待发改 blocked，避免发给新账号（铁律四）
  refreshTargets(store, subscription, targets);
  const rows = store.db.prepare("SELECT * FROM news_deliveries WHERE subscription_id=? AND state IN ('pending','failed') AND next_at<=? ORDER BY channel,part").all(subscription.id, now);
  for (const row of rows) {
    signal?.throwIfAborted?.();
    if (deadlineIso && Temporal.Instant.compare(Temporal.Instant.from(nowIso), Temporal.Instant.from(deadlineIso)) > 0) {
      store.db.prepare("UPDATE news_deliveries SET state='failed',error=?,updated_at=? WHERE delivery_id=?").run('已超过投递期限，等待用户处理', nowIso, row.delivery_id);
      result.failed += 1;
      continue;
    }
    // 手机渠道在安静时段延后（PC 与桌宠不受影响）
    if (quiet.delayed && row.channel !== 'desktop') {
      store.db.prepare('UPDATE news_deliveries SET next_at=?,error=?,updated_at=? WHERE delivery_id=?')
        .run(Date.parse(quiet.untilIso), '安静时段，延后到 08:00 投递', nowIso, row.delivery_id);
      continue;
    }
    const sender = senders[row.channel];
    if (!sender) { store.db.prepare("UPDATE news_deliveries SET state='blocked',error=?,updated_at=? WHERE delivery_id=?").run('没有可用的投递通道', nowIso, row.delivery_id); result.blocked += 1; continue; }
    // 目标快照：dm/group + 目标标识，供发送方决定发私人单聊还是指定群（spec §11.1 受控扩展）
    const resolved = (targets && targets[row.channel]) || targetFingerprint(store, row.channel);
    const target = resolved?.target || { channel: row.channel, kind: 'dm' };
    store.db.prepare("UPDATE news_deliveries SET state='sending',attempts=attempts+1,updated_at=? WHERE delivery_id=?").run(nowIso, row.delivery_id);
    result.attempted += 1;
    try {
      const outcome = await sender({
        content: row.content, part: row.part, parts: row.parts, deliveryId: row.delivery_id, digestId: row.digest_id,
        channel: row.channel, target, targetKind: target.kind || 'dm',
        // ⚠️ 桌面渠道专用：notifyPet 决定要不要弹桌宠气泡。订阅未选桌面渠道时根本不会走到这里，
        // 所以「只推飞书」天然不会弹桌面通知/气泡（spec 下一轮 §2「只推飞书」语义）。
        subscriptionId: subscription.id, subscriptionName: subscription.name || '每日新闻', notifyPet: subscription.notifyPet !== false,
      });
      if (outcome?.ok) { store.db.prepare("UPDATE news_deliveries SET state='sent',error='',updated_at=? WHERE delivery_id=?").run(new Date().toISOString(), row.delivery_id); result.sent += 1; }
      else if (outcome?.uncertain) { store.db.prepare("UPDATE news_deliveries SET state='uncertain',error=?,updated_at=? WHERE delivery_id=?").run(String(outcome.error || '无法确认平台是否已接受，需在手机核实'), new Date().toISOString(), row.delivery_id); result.uncertain += 1; }
      else { scheduleRetry(store, row, outcome?.error || '发送失败', outcome?.retryable !== false); result.failed += 1; }
    } catch (error) {
      // 异常通常意味着「不确定平台是否已接受」→ uncertain（铁律三）
      store.db.prepare("UPDATE news_deliveries SET state='uncertain',error=?,updated_at=? WHERE delivery_id=?").run('发送过程异常，无法确认平台是否已接受：' + String(error.message || error).slice(0, 200), new Date().toISOString(), row.delivery_id);
      result.uncertain += 1;
    }
  }
  return result;
}

/* 明确失败的重试：有限次，普通断网可重试；不确定的不自动重发 */
function scheduleRetry(store, row, error, retryable) {
  const attempts = row.attempts + 1;
  const maxAttempts = 5;
  const nowIso = new Date().toISOString();
  if (!retryable || attempts >= maxAttempts) {
    store.db.prepare("UPDATE news_deliveries SET state='failed',error=?,updated_at=? WHERE delivery_id=?").run(String(error).slice(0, 300), nowIso, row.delivery_id);
    return;
  }
  const delay = Math.min(300, 5 * 2 ** (attempts - 1)) * 1000;
  store.db.prepare("UPDATE news_deliveries SET state='failed',error=?,next_at=?,updated_at=? WHERE delivery_id=?")
    .run(String(error).slice(0, 300), Date.now() + delay, nowIso, row.delivery_id);
}

/* 用户在界面上「显式重试」某条（包括 uncertain）——附「可能重复」说明给 UI */
function retryDelivery(store, deliveryId) {
  const row = store.db.prepare('SELECT * FROM news_deliveries WHERE delivery_id=?').get(deliveryId);
  if (!row) throw new Error('找不到这条待发记录');
  if (!['failed', 'uncertain', 'blocked'].includes(row.state)) throw new Error('这条记录当前不需要重试');
  store.db.prepare("UPDATE news_deliveries SET state='pending',next_at=0,error=?,updated_at=? WHERE delivery_id=?")
    .run('用户显式重试，可能重复发送，请先确认手机是否已收到', new Date().toISOString(), deliveryId);
  return { ok: true, warning: row.state === 'uncertain' ? '这条曾无法确认是否送达，重试可能重复。' : '' };
}

function cancelPending(store, subscriptionId) {
  return store.db.prepare("UPDATE news_deliveries SET state='canceled',updated_at=? WHERE subscription_id=? AND state IN ('pending','sending')")
    .run(new Date().toISOString(), subscriptionId).changes;
}

/* cancelChannel()：契约
   入参：store、subscriptionId、channel
   返回：取消条数
   副作用：把该渠道未发送的待发改 canceled
   谁调用：job-runner.saveSubscription（渠道被移除时）
   改动影响：下一轮 §4「移除渠道立即取消该渠道尚未发出的新闻投递」——只动这一个渠道的
     pending/sending；已 sent 的不撤（已发出的消息不能变成「未发送」）。 */
function cancelChannel(store, subscriptionId, channel) {
  return store.db.prepare("UPDATE news_deliveries SET state='canceled',updated_at=? WHERE subscription_id=? AND channel=? AND state IN ('pending','sending')")
    .run(new Date().toISOString(), subscriptionId, channel).changes;
}

function listDeliveries(store, { subscriptionId, runId, limit = 100 } = {}) {
  const clauses = [], params = [];
  if (subscriptionId) { clauses.push('subscription_id=?'); params.push(subscriptionId); }
  if (runId) { clauses.push('run_id=?'); params.push(runId); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return store.db.prepare(`SELECT * FROM news_deliveries ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit)
    .map(row => ({ deliveryId: row.delivery_id, runId: row.run_id, digestId: row.digest_id, channel: row.channel, part: row.part, parts: row.parts, state: row.state, attempts: row.attempts, nextAt: row.next_at, error: row.error, content: row.content, updatedAt: row.updated_at }));
}

module.exports = {
  CHANNELS, TARGET_KINDS, defaultTargets, targetFingerprint, choiceFor, saveTargetChoice,
  segmentText, planDeliveries, refreshTargets,
  quietWindow, deliverPending, retryDelivery, cancelPending, cancelChannel, listDeliveries, digestDate, MAX_PART_CHARS,
};
