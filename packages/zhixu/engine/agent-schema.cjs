/* ================================================================
   知序 · 增量数据表结构（Agent 接口 / 工具连接 / 每日新闻）

  ▍这是什么
  ① 干什么：在既有 zhixu.sqlite 上做幂等增量建表，不新建空库、不 Drop 旧表。
     覆盖 R01/R04/R06/R07/R09 的持久化需求（连接、收据、订阅、运行、简报、来源、投递、工具）。
  ② 技术栈：node:sqlite（DatabaseSync）+ `CREATE TABLE IF NOT EXISTS`。
  ③ 依赖：无外部依赖，只吃 store.cjs 传进来的 db 句柄。
  ④ 给谁看：改 agent-service / job-runner / news-delivery 的人。

  ▍文件从上到下的结构
  迁移入口      ensureAgentSchema(db) —— Store 构造时调用（★核心★）
  表定义段      agent_* / news_* / mcp_* 三组
  兼容迁移段    ensureColumn()：老库补列，缺失不报错、加了不重复

  ▍修改铁律
  1. 铁律一：只允许「新增表 / 新增列 / 新增索引」。【不】许改写或删除既有列，
     老版本知序仍要能读同一个库（spec §12「原有备份继续可恢复」）。
  2. 铁律二：新列一律给默认值；老库补列用 ensureColumn()，别直接 ALTER 硬跑。
  3. 铁律三：唯一约束是业务幂等的最后一道闸（runKey、deliveryId、收据），
     删掉唯一约束等于允许重复推送——spec §9.1/§11.2 会直接判失败。
  4. 铁律四：敏感值（MCP headers/env、Agent token）【不】进这些表。token 只存 sha256；
      MCP 密钥走 Credentials（Windows safeStorage），存 metadata。

  ▍外号表
  "收据"     → agent_receipts，按 (client_id, operation_id) 去重，支撑重放
  "运行锁"   → news_runs.lease_owner / lease_expires，防两个执行器认领同一期
  "目标指纹" → news_deliveries.target_fingerprint，换账号后旧待发改 blocked 的依据

  ▍更新记录
  *更新：2026-10-12 · 新建：R01/R04/R06/R07/R09 增量表*
  *更新：2026-10-13 · 下一轮：新增 news_admin_receipts（对话式订阅管理幂等收据）*

  ================================================================ */
'use strict';

/* 表定义：数组里每条是一条完整 SQL（多语句分开写，便于逐个 try 定位） */
const TABLES = [
  /* ---------- Agent 对外连接（R01） ---------- */
  `CREATE TABLE IF NOT EXISTS agent_connections(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    permissions TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    call_count INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS agent_audit(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    operation_id TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL,
    error_code TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agent_audit_recent ON agent_audit(connection_id,at DESC)`,
  /* 收据：clientId + operationId 唯一，重放时返回首次结果（spec §6.4） */
  `CREATE TABLE IF NOT EXISTS agent_receipts(
    client_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    digest TEXT NOT NULL,
    tool TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(client_id,operation_id)
  )`,

  /* ---------- MCP 服务端运行开关（R01） ---------- */
  `CREATE TABLE IF NOT EXISTS agent_settings(
    id INTEGER PRIMARY KEY CHECK(id=1),
    enabled INTEGER NOT NULL DEFAULT 0,
    port INTEGER NOT NULL DEFAULT 43828,
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 120,
    updated_at TEXT NOT NULL
  )`,

  /* ---------- 外部 MCP 连接（R04） ---------- */
  `CREATE TABLE IF NOT EXISTS mcp_servers(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    command TEXT NOT NULL DEFAULT '',
    args TEXT NOT NULL DEFAULT '[]',
    env_keys TEXT NOT NULL DEFAULT '[]',
    header_keys TEXT NOT NULL DEFAULT '[]',
    preset TEXT NOT NULL DEFAULT 'generic',
    enabled INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'disconnected',
    last_error TEXT NOT NULL DEFAULT '',
    detected_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  /* 工具缓存：namespace 化名字 + schema 摘要，用于「所选工具消失/不兼容」检测（spec §7） */
  `CREATE TABLE IF NOT EXISTS mcp_tools(
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    namespaced TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    schema_json TEXT NOT NULL DEFAULT '{}',
    schema_digest TEXT NOT NULL DEFAULT '',
    selected INTEGER NOT NULL DEFAULT 0,
    detected_at TEXT NOT NULL,
    PRIMARY KEY(server_id,name)
  )`,

  /* ---------- 每日新闻订阅（R06） ---------- */
  /* ⚠️ config 里只有契约字段（contracts/news-subscription-v1.schema.json 是 additionalProperties:false，
     不能加字段）。投递目标（发 DM 还是发某个群）属「运行时服务端字段」，按 spec §8 单独存这里。 */
  `CREATE TABLE IF NOT EXISTS news_subscriptions(
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    config TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    next_planned_at TEXT
  )`,
  /* 每个订阅 × 每个手机渠道的目标选择（spec §8「运行时另保存服务端生成的字段」）。
     target_kind: dm=私人单聊（默认）/ group=指定群；target_id=群 chatId（dm 时空）。
     ⚠️ 换账号或改目标时，旧待发投递按 target_fingerprint 变化判为 blocked（spec §11.2）。 */
  `CREATE TABLE IF NOT EXISTS news_targets(
    subscription_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    target_kind TEXT NOT NULL DEFAULT 'dm',
    target_id TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY(subscription_id,channel)
  )`,
  /* 运行锁 + 预算 + 状态机（spec §9.2）：run_key 唯一保证一期只有一次自动运行 */
  `CREATE TABLE IF NOT EXISTS news_runs(
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    run_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL,
    planned_at TEXT NOT NULL,
    planned_local_date TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    config_snapshot TEXT NOT NULL,
    model_snapshot TEXT NOT NULL DEFAULT '{}',
    search_calls INTEGER NOT NULL DEFAULT 0,
    model_calls INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    error TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS news_runs_sub ON news_runs(subscription_id,created_at DESC)`,
  /* 简报：run_id 唯一 —— 重复完成回调不会再生成一份（spec §9.3） */
  `CREATE TABLE IF NOT EXISTS news_digests(
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    subscription_id TEXT NOT NULL,
    planned_at TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    status TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    item_count INTEGER NOT NULL DEFAULT 0,
    excluded TEXT NOT NULL DEFAULT '[]',
    failures TEXT NOT NULL DEFAULT '[]',
    call_counts TEXT NOT NULL DEFAULT '{}',
    ai_state TEXT NOT NULL DEFAULT 'complete',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS news_digests_sub ON news_digests(subscription_id,generated_at DESC)`,
  /* 来源：保留 30 天（清理任务只删这里，不碰简报） */
  `CREATE TABLE IF NOT EXISTS news_sources(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    canonical_url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    published_at TEXT,
    published_basis TEXT NOT NULL DEFAULT '',
    retrieved_at TEXT NOT NULL,
    event_key TEXT NOT NULL DEFAULT '',
    tool TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS news_sources_run ON news_sources(run_id)`,
  /* 投递：deliveryId 唯一 = 同一 run+channel+target+part 稳定去重键（spec §11.2） */
  `CREATE TABLE IF NOT EXISTS news_deliveries(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id TEXT NOT NULL UNIQUE,
    digest_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    target_fingerprint TEXT NOT NULL,
    part INTEGER NOT NULL DEFAULT 0,
    parts INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL,
    content TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS news_deliveries_pending ON news_deliveries(state,next_at)`,
  `CREATE INDEX IF NOT EXISTS news_deliveries_digest ON news_deliveries(digest_id)`,
  /* 对话式订阅管理收据（下一轮 N06）：(会话请求id, 动作指纹) 唯一 —— 手机事件重投、模型重复
     调用同一动作、应用重启都不产生第二条订阅。scope_key 用请求 id（可能为空→'adhoc'）。 */
  `CREATE TABLE IF NOT EXISTS news_admin_receipts(
    scope_key TEXT NOT NULL,
    digest TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(scope_key,digest)
  )`,
];

/* 老库补列：列已存在就跳过。
   ⚠️ SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，必须先 PRAGMA 查一遍。 */
function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/* ensureAgentSchema()：契约
   入参：db（node:sqlite DatabaseSync）
   返回：无
   副作用：建表/建索引/补列；写 agent_settings 单行（id=1）
   谁调用：Store 构造器
   改动影响：这是所有新功能的存储底座，改列名会波及 agent-service/job-runner/news-*，先搜引用 */
function ensureAgentSchema(db) {
  db.exec('PRAGMA foreign_keys=ON');
  for (const sql of TABLES) db.exec(sql);
  // 兼容迁移：后续版本新增列时在此追加 ensureColumn 调用（见铁律二）
  const now = new Date().toISOString();
  if (!db.prepare('SELECT id FROM agent_settings WHERE id=1').get()) {
    db.prepare('INSERT INTO agent_settings VALUES(1,0,43828,120,?)').run(now);
  }
}

module.exports = { ensureAgentSchema, ensureColumn };
