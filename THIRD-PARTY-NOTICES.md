# 第三方资源与许可

> **一句话**：这里面只有一类东西——各家大模型的品牌图形，用来在界面上标明"这是哪家的模型"。
> 图形本身是商标，代码许可是宽松的，但商标权不在开源许可里，所以这里把来源和使用范围都写清楚。

## 模型家族图标

**用在哪**：`packages/ui/src/client/model-family-icons.ts`，能力空间的模型卡与详情按识别出的家族显示。
**怎么用的**：只取单色路径（`<path d="...">`），颜色在代码里给；不引用外部文件、不发网络请求。

| 家族 | 取用的图形 | 来源包 | 代码许可 |
|:---|:---|:---|:---|
| DeepSeek | `deepseek.svg` | [Lobe Icons](https://github.com/lobehub/lobe-icons) `@lobehub/icons-static-svg` 1.101.0 | MIT |
| Claude | `claude.svg` | 同上 | MIT |
| GPT | `openai.svg` | 同上 | MIT |
| Gemini | `gemini.svg` | 同上 | MIT |
| GLM | `zhipu.svg` | 同上 | MIT |
| Qwen | `qwen.svg` | 同上 | MIT |
| Kimi | `kimi.svg` | 同上 | MIT |
| Grok | `grok.svg` | 同上 | MIT |
| Mistral | `mistral.svg` | 同上 | MIT |

同一批图形另有 [simple-icons](https://github.com/simple-icons/simple-icons) 16.36.0 收录，该包为 CC0 1.0；本轮取的是 Lobe Icons 版本，因为它的单色版路径是干净的 `currentColor`，不用改写填充。

### 商标说明（重要）

- 上述图形是**各厂商的商标/品牌标识**，各自归其权利人所有。
- 本项目只在"这个模型属于哪一家"的指示意义上使用，**不表示任何厂商与本项目存在合作、赞助或背书关系**。
- 识别是**按模型名称与请求 ID 猜的**（见 `model-identity.ts`），代理商改名、二次包装都可能让识别结果不准；界面上的图标因此只是便利提示，不是身份认证。
- 未识别出家族的模型**不显示**任何品牌图形，改用通用分类图形——宁可不显示，也不张冠李戴。
