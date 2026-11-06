/* ================================================================
   知序 · JSON Schema 契约校验层（对外 Agent 工具 + 新闻订阅）

  ▍这是什么
  ① 干什么：把 docs/contracts 下两份权威 schema（已复制进 core/contracts 随包分发）
     编译成校验器，给「对外 MCP 事务工具」和「每日新闻订阅」做参数结构校验。
  ② 技术栈：Node CommonJS + ajv（draft 2020-12）+ ajv-formats（mode:'full'）。
  ③ 依赖：ajv 8.20.0 / ajv-formats 3.0.1（package.json 显式锁定，禁止隐式提升）。
  ④ 给谁看：改 agent-service.cjs / job-runner.cjs 的人，以及验收者。

  ▍文件从上到下的结构
  Ajv 工厂      构造强制开启 format 校验的 2020-12 实例
  工具 schema   把 $defs 内联进每个工具 inputSchema（★核心★）
  工具调用校验  validateToolCall()：结构校验 → 规范化 → 交业务层
  订阅配置校验  normalizeSubscription()：默认值 + 结构校验
  错误类型      ContractError（带 code，供 MCP 错误映射）

  ▍修改铁律
  1. 铁律一：两条契约文件是验收依据，【不】许改 core/contracts 里的内容去迁就实现；
     实现不合契约就改实现。改动契约必须先改 docs/contracts 并同步复制。
  2. 铁律二：useDefaults 恒为 false——spec §6 与 HANDOFF 明确「Schema 的 default 只是
     声明，实现必须实际填默认值」。默认值一律在 normalizeSubscription()/业务层显式填。
  3. 铁律三：format 必须真校验。ajv 默认把 format 当注解，这里强制 mode:'full'，
     再用 Temporal 复核真实日期（见 data.cjs 的 instant()），两层都过才放行。
  4. 铁律四：schema 的 additionalProperties:false 是真的会拦字段，别再加白名单绕过。

  ▍特殊机制
  $defs 内联：agent-tools-v1.schema.json 用 oneOf + 16 个 $defs 描述 12 个工具。
  MCP 客户端拿到的每个 tool.inputSchema 必须自包含，所以 buildToolInputSchemas()
  把共享 $defs 原样挂到每个工具 schema 的 $defs 下（draft 2020-12 同文档内 $ref 可解析）。
  「逻辑调用」契约（oneOf/name+arguments）仍整体编译，用于 validateToolCall()。

  ▍外号表
  "逻辑调用"   → {name, arguments} 对象（契约顶层 oneOf 校验的形态）
  "工具表"     → toolInputSchemas，12 个工具的 inputSchema 映射

  ▍更新记录
  *更新：2026-10-12 · 新建：契约校验层（R02/R06 结构校验入口）*

  ================================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

/* ================================================================
   错误类型 — 带 code 的契约错误
   谁抛：本文件全部校验入口
   谁接：agent-service.cjs 映射成 INVALID_ARGUMENT 业务错误
   ================================================================ */
class ContractError extends Error {
  constructor(code, message) { super(message); this.name = 'ContractError'; this.code = code; }
}

const CONTRACT_DIR = path.join(__dirname, 'contracts');
const readContract = name => JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, name), 'utf8'));

/* 构造一个强制校验 format 的 2020-12 实例。
   ⚠️ mode:'full' 是唯一会让 date-time 真校验的组合开关：
   默认 mode 下 "2026-02-30T00:00:00Z" 会通过，验收用例 A10 会漏。 */
function createAjv() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,          // 契约里 anyOf/oneOf 混用类型联合，strict 会误报
    useDefaults: false,     // 见铁律二
    allowUnionTypes: true,  // $defs.reminderOffset 是 type:["integer","null"]
    validateFormats: true,
  });
  addFormats(ajv, { mode: 'full' });
  return ajv;
}

const agentToolsContract = readContract('agent-tools-v1.schema.json');
const newsSubscriptionContract = readContract('news-subscription-v1.schema.json');

const ajv = createAjv();
const validateCallSchema = ajv.compile(agentToolsContract);
const validateSubscriptionSchema = ajv.compile(newsSubscriptionContract);

/* 工具名 → 参数定义名（契约里叫 zhixu_xxxArguments） */
const TOOL_NAMES = Object.keys(agentToolsContract.$defs)
  .filter(k => /^zhixu_[a-z_]+$/.test(k) && !k.endsWith('Arguments'));

/* 逐条工具的参数结构（含 anyOf 与 additionalProperties） */
function argumentsSchema(toolName) {
  const def = agentToolsContract.$defs[toolName + 'Arguments'];
  if (!def) throw new ContractError('INVALID_ARGUMENT', '工具参数契约缺失：' + toolName);
  return def;
}

/* 把 schema 里的 "#/$defs/xxx" 引用原地展开成内联定义（深拷贝，不动契约原件）。
   ⚠️ 为什么必须展开：ZCode 客户端不解析 $ref——2026-10-13 实测，参数类型写成
   $ref 的工具会被客户端把类型搞丢、拿字符串当整数发回（服务端报
   "limit must be integer"），而类型全内联的 search_documents 独活。
   ⚠️ 防环：契约若将来出现递归 $ref，深度超限直接抛错，别等人等爆栈。 */
function inlineRefs(node, defs, depth) {
  if (depth > 32) throw new ContractError('INVALID_ARGUMENT', '$ref 展开深度超限，契约疑似递归引用');
  if (Array.isArray(node)) return node.map(v => inlineRefs(v, defs, depth + 1));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string') {
    const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(node.$ref);
    if (m && Object.prototype.hasOwnProperty.call(defs, m[1])) {
      return inlineRefs(defs[m[1]], defs, depth + 1);
    }
    return node; // 解析不了的引用原样保留，交给校验层兜底
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = inlineRefs(v, defs, depth + 1);
  return out;
}

/* 给 MCP 客户端用的自包含 inputSchema：把 $ref 全部展开内联。
   ⚠️ 不要只返回 argumentsSchema()——里面的 $ref:"#/$defs/xxx" 会因缺少 $defs 解析失败；
   ⚠️ 也【不】要照旧版把共享 $defs 原样挂进 schema——客户端不认引用，等于白挂。
   ⚠️ 顶层 anyOf 纯 required 分支必须摘掉再下发（2026-10-13 实测）：ZCode 客户端会把
   这些分支当「变体」做合并变换，properties 被剥成空壳、required 却保留，工具在
   客户端里变成「传啥都报缺参」的空壳（update_task/update_event/update_note 三条全中）。
   只摘下发层——服务端 validateToolCall() 编译的是完整契约，条件必填照样严查。 */
function stripTopLevelRequiredAnyOf(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (!Array.isArray(schema.anyOf)) return schema;
  const isPureRequired = branch => branch
    && typeof branch === 'object'
    && !Array.isArray(branch)
    && Object.keys(branch).length === 1
    && Array.isArray(branch.required);
  if (!schema.anyOf.every(isPureRequired)) return schema; // 有非纯 required 分支不敢动，原样保留
  const out = { ...schema };
  delete out.anyOf;
  return out;
}

function buildToolInputSchemas() {
  const shared = agentToolsContract.$defs;
  const out = {};
  for (const name of TOOL_NAMES) {
    out[name] = stripTopLevelRequiredAnyOf(inlineRefs(argumentsSchema(name), shared, 0));
  }
  return out;
}

const formatAjvErrors = () => (validateCallSchema.errors || [])
  .map(e => (e.instancePath || '/') + ' ' + e.message).slice(0, 8).join('；');

/* 时间字段名 —— 这些字段的结构错误要归到 INVALID_TIME，而不是笼统的 INVALID_ARGUMENT。
   ⚠️ 必须和 agent-service.checkInstant() 用同一套判定：含糊/无时区时间在两侧都要判 INVALID_TIME，
   否则验收用例 A10 会拿到一个「有时 INVALID_ARGUMENT、有时 INVALID_TIME」的不稳定错误码。 */
const TIME_FIELDS = new Set(['dueAt', 'remindAt', 'start', 'end', 'from', 'to']);
function isTimeFieldError(error) {
  const field = String(error.instancePath || '').split('/').filter(Boolean).pop();
  return TIME_FIELDS.has(field);
}

function describeCallErrors() {
  const errors = validateCallSchema.errors || [];
  // oneOf 失败时会附带一堆子分支错误；只要有时间字段命中的，就整体归为时间错误
  if (errors.some(isTimeFieldError)) return { code: 'INVALID_TIME', message: '时间必须是带时区偏移量的 ISO 8601 时间' };
  return { code: 'INVALID_ARGUMENT', message: '工具参数不符合契约：' + formatAjvErrors() };
}

/* ================================================================
   工具调用校验入口
   入参：call = {name, arguments}
   返回：{name, arguments}（原样，未做默认值填充——默认值归业务层，见铁律二）
   抛出：ContractError('INVALID_ARGUMENT')
   ================================================================ */
function validateToolCall(call) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) {
    throw new ContractError('INVALID_ARGUMENT', '工具调用必须是对象');
  }
  if (typeof call.name !== 'string' || !TOOL_NAMES.includes(call.name)) {
    throw new ContractError('INVALID_ARGUMENT', '未知工具：' + String(call.name));
  }
  if (call.arguments === undefined || call.arguments === null) call = { ...call, arguments: {} };
  if (!validateCallSchema(call)) {
    const { code, message } = describeCallErrors();
    throw new ContractError(code, message);
  }
  return { name: call.name, arguments: call.arguments };
}

/* ================================================================
   订阅配置校验 + 默认值填充
   入参：用户/UI 提交的原始配置
   返回：填好默认值、且通过结构校验的完整配置
   抛出：ContractError('INVALID_ARGUMENT')
   ⚠️ 此处只做「结构 + 默认值」；IANA 时区存在性、工具存在性、通道绑定归 job-runner。
   ================================================================ */
/* 带默认值的键（缺了就补默认）；⚠️ 必填键（topics/searchServerId/searchToolName/timeZone）
   【不】在这里，缺了必须报错，【不】许悄悄丢掉——早先版本只拷 DEFAULTS 里的键，
   把 topics 等必填字段一起丢了，导致「/ must have required property topics」的假错误。 */
const SUBSCRIPTION_DEFAULTS = Object.freeze({
  name: '每日新闻',
  keywords: [],
  excludeTopics: [],
  summaryStyle: 'standard',
  sendTime: '09:00',
  windowHours: 24,
  newsCount: 5,
  language: 'zh-CN',
  channels: ['desktop'],
  notifyPet: true,
  respectQuietHours: true,
  enabled: false,
  catchupGraceMinutes: 180,
  limits: { maxSearchCalls: 5, maxModelCalls: 2, timeoutSeconds: 180 },
});

/* 允许出现在配置里的全部键 = 带默认值的键 + 必填键（timeZone 特殊，缺省填系统时区） */
const SUBSCRIPTION_KEYS = [...Object.keys(SUBSCRIPTION_DEFAULTS), 'topics', 'searchServerId', 'searchToolName', 'timeZone'];

function normalizeSubscription(input, systemTimeZone) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContractError('INVALID_ARGUMENT', '订阅配置必须是对象');
  }
  const out = {};
  for (const key of SUBSCRIPTION_KEYS) if (input[key] !== undefined) out[key] = input[key];
  for (const key of Object.keys(SUBSCRIPTION_DEFAULTS)) if (out[key] === undefined) out[key] = SUBSCRIPTION_DEFAULTS[key];
  if (out.timeZone === undefined) out.timeZone = systemTimeZone;
  if (out.timeZone === undefined) throw new ContractError('INVALID_ARGUMENT', '缺少时区，且无法读取系统时区');
  out.limits = { ...SUBSCRIPTION_DEFAULTS.limits, ...(input.limits || {}) };
  // topics / searchServerId / searchToolName 是必填项，不提供默认值
  if (!validateSubscriptionSchema(out)) {
    const detail = (validateSubscriptionSchema.errors || [])
      .map(e => (e.instancePath || '/') + ' ' + e.message).slice(0, 8).join('；');
    throw new ContractError('INVALID_ARGUMENT', '订阅配置不符合契约：' + detail);
  }
  // 拷贝一份，避免调用方后续改动污染已校验对象
  return JSON.parse(JSON.stringify(out));
}

module.exports = {
  ContractError, TOOL_NAMES, argumentsSchema, buildToolInputSchemas,
  validateToolCall, normalizeSubscription, SUBSCRIPTION_DEFAULTS,
};
