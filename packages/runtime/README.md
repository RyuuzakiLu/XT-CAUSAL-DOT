# @xtcausal/dot-runtime

> 此公开源码副本不包含开发测试。下文测试记录仅为原开发说明，当前构建与配置要求以根目录 README.md 为准。

DOT 的 Host 侧装配插件：**能力目录**、**文档读取**、**成果生成与表格计算**。
不含业务领域（工作/记忆/星邮匣各有主人），也不新增通信协议——全部走 DSH 原生
Cordis 服务、工具注册表与 Typert Remote。

## 提供什么

| 名称 | 类型 | 作用 |
|---|---|---|
| `ctx.dotCapabilities` | Cordis 服务（`DotCapabilitiesController`） | 真实工具注册表的只读投影；`list()` 走 Remote 给浏览器 |
| `dot_capabilities` | 模型工具 | 让模型查**自己此刻能调**的工具，而不是凭印象列举 |
| `dot_read_document` | 模型工具 | 读工作区文件或会话上传附件的正文（PDF/DOCX/XLSX/文本） |
| `dot_write_artifact` | 模型工具 | 把成果写进成果目录（不覆盖已有文件） |
| `dot_compute_table` | 模型工具 | 对成果目录里的 CSV/TSV 做聚合与分组计数 |

## `scope: global` 与 `scope: agent` 的区别（重要）

同一份注册表有两种视角，**不能混用**：

- **global**（`ctx.remote.dotCapabilities.list()`）：进程级**已安装**的工具集合。
  适合界面展示"这台机器上装了哪些能力"。
- **agent**（`dot_capabilities` 工具，内部用 `exec.agent` 作 scope）：**某个会话里模型
  真正能调**的集合。它 = 全局层 + 该 agent 的 preset 层 + 自己注册的，因此
  **全局集合通常是 agent 集合的子集**。

所以：界面文案可以写"已安装能力"，但不能写"当前模型全可调"；模型被问"你能做什么"
时必须走 agent 视图，否则会承诺它其实调不到的工具。快照里的 `scope` 字段就是给
消费者区分用的。

## 配置

| 字段 | 必填 | 说明 |
|---|---|---|
| `documentsRoot` | 建议 | 文档读取与成果写入的根目录（绝对路径）。**缺省回退到 `process.cwd()` 并打 warn**：进程启动目录可能是工程根，那里有 `.dsh/` 配置、会话与凭据，不该被模型按路径读到。部署时应显式指定用户资料目录。成果落在 `<documentsRoot>/artifacts/`。 |

```yaml
- id: dot-runtime
  name: '@xtcausal/dot-runtime'
  config:
    documentsRoot: !!js dshHomePath('data/workspace')
```

## 已知限制

**文档读取**

- 单文件上限 20MB（先 `stat` 再读，超限不分配内存）。
- PDF 只抽**文本层**；扫描件返回 `scanned: true` 且不带正文，并说明需要 OCR——不编造摘要。
- `.doc` / `.xls` 旧二进制格式不支持，明确拒绝并建议另存为 `.docx`/`.xlsx`/PDF。
- 图片不在此工具范围（需要视觉模型，走 `read_image`）。
- 上传附件必须同时提供 `bytes`（上传回执里的字节数）：附件服务读完会校验「长度 + sha256」，
  传错会在末尾抛 `ATTACHMENT_CORRUPT`；工具在入口就先拒绝，避免把"文件损坏"这种误导读给模型。

**成果写入**

- 只接受相对路径；拒绝 `..`、绝对路径、盘符、以及前缀相似的兄弟目录（用 `relative` 判定，不是 `startsWith`）。
- 同名**不覆盖**：自动换 `-2`、`-3` 后缀，原文件保留。
- 单文件上限 5M 字符，超限拒绝而非截断。

**表格计算**

- 只处理 CSV/TSV；Excel 需要先读成表格文本。
- 非数值单元格计入 `skipped`，不会被当成 0；整列无数值时不给 `sum`（而不是给 0 冒充）。
- `groupBy` 的列不存在时返回可选列名。

**能力目录**

- 读的是注册表当前状态，不做历史；插件停用后该工具立即从目录消失。
- 全局视图会包含别的会话才有的工具（这是设计取舍：界面需要"已安装"全景）。

## 启停行为

- 所有注册（服务、工具）都通过 `ctx.effect` 持有，插件停用时自动撤销；重复挂载不会残留。
- 已由 `tests/capabilities.test.mjs` 实测：挂载 → 停用 → 重挂，工具与服务都正确出现/消失/恢复。

## 测试

```sh
cd packages/runtime && node --test tests/*.test.mjs tests/*.e2e.mjs
```

27 项，全部用真实 Cordis、真实工具注册表、真实 attachment 服务、真实文件系统；
其中 `upload-to-tool.e2e.mjs` 用确定性剧本 provider 驱动**真实 agent-loop**，
验证"上传附件 → 模型调用 `dot_read_document` → 工具结果里真出现文档正文"。

剧本 provider 只替代"模型说了什么"，不代理任何链路环节；因此它证明接线正确，
**不**证明模型理解能力。
