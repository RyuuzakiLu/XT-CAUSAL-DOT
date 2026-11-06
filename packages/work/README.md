# @xtcausal/dot-work · 个人 DOT 的工作领域

> 此公开源码副本不包含开发测试。下文测试记录仅为原开发说明，当前构建与配置要求以根目录 README.md 为准。

**这是啥**：一件"用户交代的事"从登记到拿成果的完整生命周期——稳定 `workId`、九态状态机、真实后台执行、成果引用、计划暂停/恢复、重启恢复。它是工作事实的**唯一所有者**：界面点击、模型工具、星邮匣通知都读同一份记录。

**为什么单独成包**：聊天与后台办事必须分开。如果工作状态散在会话日志里，就既查不到"上次那件事做到哪了"，也没法在 App 关掉后继续跑。

**不做会怎样**：只剩一个换皮聊天页——交代完必须盯着，关掉就断，做完了也找不回成果。

## 提供什么

| 面向 | 名字 | 说明 |
|---|---|---|
| Cordis 服务 | `ctx.dotWork` | 业务事实入口，界面与工具共用 |
| Remote 命名空间 | `dotWork` | 跨端调用（`ctx.remote.dotWork.*`） |
| 同进程事件 | `dot-work/changed` | 载荷为 `WorkSnapshot`；跨端订阅走 `follow` 流 |
| 模型工具 | `work_create` / `work_query` / `work_supplement` / `work_cancel` | 与界面同一份规则 |
| 持久域 | `dot_work`（v1） | 表：`works` / `artifacts` / `plans` / `operations` |

### Remote 方法

```ts
list({ statuses?, limit?, cursor? })          → { works: WorkSnapshot[], revision, nextCursor? }
get({ workId })                                → { work, operationId, retryOf?, cancellable, retryable, sessionId? }
create({ goal, operationId, title? })          → { work, created }
supplement({ workId, text, operationId? })     → { accepted: true, work }
cancel({ workId })                             → { workId, status, stoppedNewActions, externalActions }
retry({ workId, operationId })                 → { work, created, retryOf }
follow({ workId? }, signal)                    → 流：snapshot | changed
artifacts({ workId })                          → { artifacts: ArtifactRef[] }
artifact({ artifactId })                       → { kind:'text',text,mimeType } | { kind:'file',base64,mimeType,byteLength }
listPlans({ sessionId? })                      → { plans: WorkPlanView[] }
createPlan({ title, goal, timing, sessionId?, operationId }) → { plan, created }
updatePlan({ scheduleId, title?, goal?, timing?, operationId }) → { plan }
pausePlan({ scheduleId, operationId })         → { plan, changed }
resumePlan({ scheduleId, operationId })        → { plan, changed }
cancelPlan({ scheduleId, operationId })        → { scheduleId, deleted, worksRetained: true }
```

失败码（原生 `RemoteError`，界面按 `code` 分支）：`work/not-found`、`work/not-actionable`、`work/bad-request`、`work/session-failed`、`work/plan-not-found`、`work/plan-unavailable`。

## 消费的服务 / 依赖

必需：`sessionController`（建会话与投递 prompt）、`sessions`（读 header cwd）、`storageDomain`（持久域）、`agents`（重启后判断会话是否还活着）、`tools`（注册模型工具）。

**可选**（不写进 `inject`，用 `ctx.reflect.get(name, false)` 取，拿不到就跳过）：

- `schedule` — 缺它时只有计划方法报 `work/plan-unavailable`，交代工作不受影响。
- `dotPostbox` — 工作进入 `succeeded` / `failed` / `interrupted` / `waiting-approval` / `waiting-input` 时发布事件；星邮匣晚就位会监听 `internal/service` 补扫（`dedupeKey` 幂等）。

## 配置项

| 字段 | 默认 | 用途 |
|---|---|---|
| `workRoot` | 省略=不指定（由部署决定） | 后台工作与计划会话的文件根（个人工作区）。**生产部署应设为 `dshHomePath('data/workspace')`**；不设会让会话落在进程当前目录（工程根）。 |
| `agentPreset` | 省略=宿主默认 | 后台会话的 agent 身份。DOT 部署应设 `astra`，否则后台会退回 coding 身份。 |
| `maxActiveRuns` | 2 | 同时**执行中**的工作数上限（等人工不计入）。 |
| `maxRunMinutes` | 60 | 单件工作墙钟上限，超时主动中止并记 failed。 |
| `maxToolSteps` | 100 | 单件工作工具调用次数上限。 |
| `artifactDir` | `<workRoot>/dot-artifacts` | 成果文件落盘目录。 |

## 执行怎么发生（不是假计时器）

1. `create` 落一条 `queued` 记录，写 `operations` 幂等索引。
2. 有空闲后台额度（`maxActiveRuns`，默认 2）就启动 `DotWorkRunner`：用 `sessionController.create()` 建**独立会话**，`prompt()` 投递目标。
3. 观察该会话的 `session/event`（**串行队列**处理，避免密集事件与 `turn/end` 抢写）：
   - `turn/start` → `running`
   - `tool/call` → 更新阶段；`ask_user_question` → `waiting-input`；累计外部动作痕迹
   - `approval/asked` → `waiting-approval`；`approval/decided` → 回 `running`
   - `tool/result` → 解除阻塞并回 `running`（否则后续 `succeeded` 会撞非法迁移）
   - `assistant/message` → 记最终文本（作为文字成果候选）
   - `turn/end` → 唯一结局判定点：`completed`→`succeeded`、`error`→`failed`、`aborted`→`interrupted`（被用户取消时改判 `cancelled`）、`blocked`→`waiting-input`、未知→`unknown`
4. 收尾：文字成果与 `present` 声明的文件成果**都**登记（`artifactIntentsOf` 一次决策，两条都不漏）。

## 启停与恢复

- **停用本插件**：不再启动新执行；在途 Runner 的观察者释放。已落盘的工作记录与成果全部保留。
- **不删数据**：任何取消/失败/重试都不删记录；重试产生**新** `workId` 并带 `retryOf`。
- **重启恢复**：域打开后逐条核对在途记录——
  - 会话还活着 → 重新挂观察者，等它自己的 `turn/end` 给结局（不重发目标，避免干两遍）
  - 会话已不在 → 记 `interrupted`，说明"是否完成未知，需确认后再重试"
  - 已终态 → 原样保留

## 计划（F08）

时间规则**完全复用**原生 `schedule`（一次性 / 固定间隔 / 每日 / 每周 / cron），不新增第二种方言。原生没有"暂停"，所以：

- **暂停** = 删原生任务 + 本插件记 `paused: true`（记录、标题、目标、历史工作全保留）
- **恢复** = 按镜像的时间规则重建原生任务（原生 id 会变，这是原生没有暂停的必然代价）
- **取消** = 删原生任务 + 镜像置 `paused: true`（`worksRetained: true`）

## 实测过的真实链路（集成测试）

`tests/service.integration.test.ts` 用**真实** Cordis Context + 真实 `storage-domain`（json 后端落 F 盘隔离目录）+ 真实 `dsh-session` 会话对象跑通 8 条链路；唯一替身是"谁产生会话事件"（现实里是模型，测试里是剧本），接口签名与原生一致：

| 链路 | 断言要点 |
|---|---|
| 交代 → 成功 | 真建会话、真投目标；`turn/end` completed → `succeeded`；最终答复登记为文字成果且正文可读 |
| 失败 → 重试 | error → `failed` + 真实原因；重试新建 workId 并 `retryOf` 指回，**原记录不被改写** |
| 等输入 → 补充 | `ask_user_question` → `waiting-input` + 阻塞码；补充后回 `running` 并最终完成（不撞非法迁移） |
| 取消 | 真的调原生 `cancel`；`externalActions` 如实报 `observed-may-have-happened` |
| 重启（会话仍在） | 全新 Context + 同库目录 → 重新观察，不判 `interrupted`；原会话的结局能被接住 |
| 重启（会话已没） | 记 `interrupted` 并说明"是否完成未知" |
| 并发上限 | 前两件 running、第三件 queued 带原因；列表查询不被后台阻塞；腾出额度后第三件自动补位 |
| 幂等 | 同一 operationId 重复交代 → 同一 workId，只建一个会话 |
| 成果读取 | `artifacts` 列引用 → `artifact` 按引用读正文（这两个就是 UI 的真实消费路径；正文不进快照） |
| 等人工不占额度 | 一件卡在 `waiting-input` 时，后两件仍能占满 2 个额度跑起来 |
| 计划真实触发 | 原生 `at` 到点投递 → 认出 `schedule_id_json` → 建出**恰好 1 件** DOT 工作 → 回写 `lastWorkId` |
| 取消 vs 暂停 | 暂停可恢复；取消是墓碑（`cancelled: true`），恢复被 `work/not-actionable` 拒绝 |
| 真实 agent-loop | `AgentLoop` + 真实 tools/system-prompt/session，只换本地 scripted provider；抓最终请求实证 system prompt 存在、工具集进请求、监听回收无泄漏 |
| **文件成果不靠模型自觉** | `dot_write_artifact` 在 `tool/result.meta` 报 `{dot:'artifact',kind:'file-created',path,title,bytes,mimeType}`（失败报 `kind:'failed'`，不登记）；runner 直接吸收，模型忘 `present` 也有文件；同路径去重 |
| **后台落在个人工作区** | `workRoot` + `agentPreset` 透传进原生 `create({cwd, agentPreset})`；后台工作与计划会话用同一份配置，不落进程当前目录（工程根） |
| **真实工具 e2e** | 真实 agent-loop 里调 **runtime 的** `dot_write_artifact` → meta → 工作卡 1 份文件成果 → 按引用读出磁盘正文 |
| **ASTRA 身份实证** | 从 `packages/bundle/cordis.patch.yml` 读 `preset-astra` 的 persona 原文，装官方 `dsh-persona`（**在 agent scope 内**，与 preset 同路由），断言最终请求确实含该身份、且不含 `coding agent`；后台会话同一条组装路径 |

跑法：`pnpm -C packages/work test`（52 条，约 50 秒，无网络无模型）。

## 已知限制

- **Typert 产物由装配侧生成**：`lib/typert.host.*` 与 `lib/typert.remote-client.*` 由工作区根的生成脚本统一产出，`@Remote` 一变就必须重跑（见下节）。产物缺失时 Loader 会因找不到 `./typert` 而启动失败。
- **尚未验证**：DOT 组合里经真实 Loader 加载、Android 真机、真实付费模型回合（集成测试用本地 scripted provider，不花钱）、星邮匣实际投递。
- **ASTRA 身份的验证边界**：本包已验证"组合层配置的 persona 原文 → 官方 persona 插件 → 最终请求"这条链；但**整单的 preset 装配**（`@deepseek-ai/dsh-agent-preset` 加载 patch、ASTRA 成为默认身份）仍归主端验收。
- **zod 双版本**：`storage.ts` 里四张表的 schema 传参用了 `as never`，因为工作区此刻同时链接了 zod 4.4.3（`storage-domain` 依赖）与 4.6.7。运行时行为一致，但类型上互不兼容；统一 zod 版本后应删掉这层转换。
- **计划暂停会换 scheduleId，但 planId 不变**：界面所有动作都用稳定 `planId`；`scheduleId` 只用于和原生对账，恢复后需重新读取。
- **单机单进程**：`dot-work/changed` 是进程内事件；跨端订阅靠 `follow` 流。

## 怎么跑

```sh
pnpm -C packages/work typecheck   # 类型检查
pnpm -C packages/work test        # 47 条（纯规则 + 真实集成 + 真实 agent-loop）
pnpm -C packages/work build       # tsdown 出 lib/index.js + tsc 出 lib/types
node scripts/gen-typert.mjs       # 生成 Typert 产物（改了 @Remote 才需要）
```

## Typert 产物

`lib/typert.host.*` 与 `lib/typert.remote-client.*` 由工作区根的生成脚本统一产出；
**改过任何 `@Remote` 后必须重跑**（`node scripts/gen-typert.mjs`）。当前产物含 15 个端点
（list/get/create/supplement/cancel/retry/follow/artifacts/artifact + 6 个计划方法）。

> 历史错题（2026-10-23）：树外工作区里官方生成器一度认不出 `@Remote`，因为它要求装饰器声明
> 落在本工作区 `packages/` 下、包名正好是 `@deepseek-ai/dsh-typert-protocol` 的注册包。
> 根 owner 用协议源码影子解决了。这不是本包的限制，只是当时踩过的坑。
