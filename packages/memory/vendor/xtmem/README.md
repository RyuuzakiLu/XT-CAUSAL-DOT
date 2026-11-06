# vendored XTMEM 引擎（只读副本）

- 来源：XTMEM 公开源码（MIT），`src/hermes-plugin/memory/*.py` + `src/cli/xtmem.py`。
- 取用日期：2026-10-23。
- 用途：dot-memory 插件的**独立引擎**，跑在自己配置的库路径上。
- 未包含：`__pycache__`、测试、前端面板、其它端接头、示例配置。

## 为什么 vendored 而不是运行时指向外部源码树

外部源码树（另一个本地目录）是开发期的参考副本，不是本产品的交付依赖：
换机/换盘/清理临时目录后就不存在了。把引擎随包分发，才能保证"装好就能跑"。

## 修改铁律

【不】直接改这里的引擎代码。上游升级走"重新复制 + 跑 `packages/memory/tests/engine-integration.test.mjs`"。
本产品自己的适配逻辑在 `packages/memory/src/engine.ts` 与 `packages/memory/scripts/xtmem_correct.py`。

## 运行依赖（引擎自身）

Python 3.10+，以及 `jieba`（分词，必须）、`numpy` / `httpx` / `PyYAML` / `fastapi` / `uvicorn`
（引擎部分路径可选导入）。实测本机均已安装。缺 embedding 服务（Ollama）时引擎自动降级到
FTS/BM25，检索结果的 `mode` 会如实反映降级，不伪造语义命中。
