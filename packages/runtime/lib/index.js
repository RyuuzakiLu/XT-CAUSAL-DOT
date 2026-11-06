import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import z from "@deepseek-ai/schemastery";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { gunzipSync, strFromU8, unzipSync } from "fflate";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
//#region src/capabilities.ts
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/**
* 从一条模型可见工具 schema 提取目录行。
* 为什么单独成函数：注册表给的 schema 字段很多，目录只关心三样；
* 分散在调用处取值会让以后加字段时两处不同步。
* @param schema - 注册表投影的工具 schema
* @returns 目录行
*/
function toRow(schema) {
	const raw = schema.parameters["required"];
	const required = Array.isArray(raw) ? raw.filter((field) => typeof field === "string") : [];
	return {
		name: schema.name,
		description: schema.description,
		requiredFields: required
	};
}
/** 真实工具注册表的只读投影 + 订阅。 */
var CapabilityDirectory = class {
	tools;
	revision = 0;
	snapshot = {
		tools: [],
		revision: 0,
		scope: "global"
	};
	listeners = /* @__PURE__ */ new Set();
	offs = [];
	disposed = false;
	/**
	* @param ctx - 承载 `tools/change` 事件的上下文（事件由 Service 发出，订阅在 ctx 上）
	* @param tools - 工具注册表（唯一的真相来源）
	*/
	constructor(ctx, tools) {
		this.tools = tools;
		this.offs.push(ctx.on("tools/change", () => {
			this.refresh();
		}));
		this.refresh();
	}
	/** 当前快照；内容不变时返回同一引用，方便 useSyncExternalStore 直接比较。 */
	getSnapshot = () => this.snapshot;
	/** 订阅快照变化；返回取消函数。 */
	subscribe = (listener) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	/**
	* 重新读注册表并发布。
	* 为什么按工具名排序：注册顺序受加载顺序影响，排序后同一组能力得到同一份快照，
	* 界面不会因为无关插件重排而闪。
	*/
	refresh() {
		if (this.disposed) return;
		const rows = this.tools.schemas().map(toRow).sort((left, right) => left.name.localeCompare(right.name));
		this.snapshot = {
			tools: rows,
			revision: ++this.revision,
			scope: "global"
		};
		for (const listener of this.listeners) listener();
	}
	/**
	* 读**某一个会话（agent 作用域）**真正可见的工具。
	*
	* ▍为什么不能只给全局视图
	* ASTRA 的工具大多挂在 agent preset 层，不在全局层。只读全局会同时犯两个错：
	* ① 漏掉模型其实能用的（web/fs/present 等 preset 工具）；
	* ② 把别的会话才有的当成本会话可用。
	* 官方 PTC 运行时也是用 `registry.schemas(exec.agent)` 取调用者视图，这里沿用同一口径。
	* @param scope - agent 作用域（`exec.agent`）；省略则退回全局视图
	* @returns 该作用域的目录快照（不发布、不改 revision——它不是全局事实）
	*/
	snapshotFor(scope) {
		return {
			tools: this.tools.schemas(scope).map(toRow).sort((left, right) => left.name.localeCompare(right.name)),
			revision: this.revision,
			scope: scope === void 0 ? "global" : "agent"
		};
	}
	/** 释放事件监听；资源由创建者关闭。 */
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const off of this.offs.splice(0)) off();
		this.listeners.clear();
	}
};
/**
* 能力目录的 Remote 出口。
* 界面通过 `ctx.remote.dotCapabilities.list()` 读到与模型工具同一份快照；
* 这里不缓存、不合并，现场问目录。
*/
let DotCapabilitiesController = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _list_decorators;
	return class DotCapabilitiesController extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_list_decorators = [Remote("list")];
			__esDecorate(this, null, _list_decorators, {
				kind: "method",
				name: "list",
				static: false,
				private: false,
				access: {
					has: (obj) => "list" in obj,
					get: (obj) => obj.list
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		static inject = ["tools", "typert"];
		/** 目录实例由插件 apply 创建后注入，保证两边读同一个注册表订阅。 */
		directory = __runInitializers(this, _instanceExtraInitializers);
		constructor(ctx) {
			super(ctx, "dotCapabilities", { namespace: "dotCapabilities" });
		}
		/**
		* 绑定目录实例（apply 在创建后立刻调用）。
		* 为什么不用构造参数：Loader 按行实例化行配置里的插件，构造参数只能来自 Config；
		* 而目录依赖的是 apply 里拿到的同一注册表，绑定时序由本包自己掌握。
		* @param directory - 目录服务
		*/
		bind(directory) {
			this.directory = directory;
		}
		/**
		* 进程内读取当前能力目录（给同进程消费者与测试用，不走 wire）。
		* @returns 同一份快照
		*/
		getSnapshot() {
			const directory = this.directory;
			if (directory === void 0) throw new Error("能力目录尚未绑定");
			directory.refresh();
			return directory.getSnapshot();
		}
		/**
		* 读某一会话作用域可见的工具（进程内调用与测试用）。
		* @param scope - agent 作用域；省略退回全局视图
		* @returns 该作用域的目录快照
		*/
		snapshotFor(scope) {
			const directory = this.directory;
			if (directory === void 0) throw new Error("能力目录尚未绑定");
			return directory.snapshotFor(scope);
		}
		/**
		* 读取当前能力目录。
		* @returns 与模型工具同一份快照
		*/
		async list() {
			const directory = this.directory;
			if (directory === void 0) throw new Error("能力目录尚未绑定");
			directory.refresh();
			return directory.getSnapshot();
		}
	};
})();
//#endregion
//#region src/tool.ts
/** 工具名：带 dot_ 前缀，避免与官方工具撞名。 */
const CAPABILITY_TOOL_NAME = "dot_capabilities";
/**
* 注册目录工具。
* @param ctx - Host 上下文（提供 ctx.tools）
* @param directory - 目录服务
* @returns 注册的清理函数（交给 ctx.effect 持有）
*/
function registerCapabilityTool(ctx, directory) {
	return ctx.tools.register(defineTool({
		name: CAPABILITY_TOOL_NAME,
		description: "列出**你此刻真正能调用**的工具（工具名、说明、必填参数）。回答\"你能做什么\"或规划步骤前必须用它，不要凭印象列举；返回的是本会话作用域的视图。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				properties: {
					revision: {
						type: "number",
						required: true
					},
					scope: {
						type: "string",
						required: true
					},
					tools: {
						type: "array",
						required: true,
						items: {
							type: "object",
							properties: {
								name: {
									type: "string",
									required: true
								},
								description: {
									type: "string",
									required: true
								},
								requiredFields: {
									type: "array",
									items: { type: "string" },
									required: true
								}
							},
							additionalProperties: false
						}
					}
				},
				additionalProperties: false
			},
			render: (_args, value) => [{
				type: "text",
				text: value.tools.length === 0 ? "当前没有可用工具。" : [`当前可用能力（快照 ${value.revision}）：`, ...value.tools.map((tool) => `- ${tool.name}：${tool.description}`)].join("\n")
			}]
		},
		async execute(_args, exec) {
			const snapshot = directory.snapshotFor(exec.agent);
			return {
				revision: snapshot.revision,
				scope: snapshot.scope,
				tools: snapshot.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					requiredFields: [...tool.requiredFields]
				}))
			};
		}
	}));
}
//#endregion
//#region src/documents.ts
/** 默认大小上限：20MB。超过就不读——读一半再报错比直接说"太大"更糟。 */
const MAX_BYTES = 20 * 1024 * 1024;
/** 纯文本类扩展名：直接按 UTF-8 读，失败回退 GBK 不可得时如实报告。 */
const TEXTY = /* @__PURE__ */ new Set([
	"txt",
	"md",
	"markdown",
	"json",
	"csv",
	"tsv",
	"log",
	"yaml",
	"yml",
	"xml",
	"html",
	"htm"
]);
/**
* 读一份本地文档。
* @param path - 绝对路径（调用方负责确保在 workspace 内；本函数不做权限判断）
* @returns 读取结果；任何失败都以 `ok: false` 返回而不是抛异常——读文件失败是常见业务情况
*/
async function readDocument(path) {
	const format = extname(path).replace(".", "").toLowerCase();
	try {
		const info = await stat(path);
		if (info.size > 20971520) return {
			ok: false,
			format,
			text: "",
			chars: 0,
			reason: `文件 ${(info.size / 1024 / 1024).toFixed(1)}MB 超过 ${MAX_BYTES / 1024 / 1024}MB 读取上限`
		};
	} catch (error) {
		return {
			ok: false,
			format,
			text: "",
			chars: 0,
			reason: `无法读取文件：${error instanceof Error ? error.message : String(error)}`
		};
	}
	let bytes;
	try {
		bytes = await readFile(path);
	} catch (error) {
		return {
			ok: false,
			format,
			text: "",
			chars: 0,
			reason: `无法读取文件：${error instanceof Error ? error.message : String(error)}`
		};
	}
	return await readDocumentBytes(bytes, format);
}
/**
* 从**已读入的字节**解析文档。
*
* ▍为什么单独开一个入口
* 原生上传的附件不在工作区文件系统里：它由 attachment 服务按内容寻址存到
* `$DSH_HOME/attachments/v1/`，模型手上只有 `attachmentId` 与显示名。
* 如果工具只会 `readFile(path)`，那么"用户上传了 PDF"和"模型能读到 PDF"之间
* 就永远少一段——这正是把"上传成功"误当"已理解"的典型断点。
* 所以解析逻辑只认字节，路径与附件两种来源共用同一套实现。
* @param bytes - 文件字节
* @param format - 小写扩展名（去点）
* @returns 读取结果
*/
async function readDocumentBytes(bytes, format) {
	const lower = format.toLowerCase();
	if (bytes.byteLength > 20971520) return {
		ok: false,
		format: lower,
		text: "",
		chars: 0,
		reason: `内容 ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB 超过 ${MAX_BYTES / 1024 / 1024}MB 读取上限`
	};
	if (TEXTY.has(lower)) {
		const text = Buffer.from(bytes).toString("utf8");
		return {
			ok: true,
			format: lower,
			text,
			chars: text.length
		};
	}
	const buffer = Buffer.from(bytes);
	if (lower === "pdf") return readPdf(buffer);
	if (lower === "docx") return readDocx(buffer);
	if (lower === "xlsx") return readXlsx(buffer);
	if (lower === "doc" || lower === "xls") return {
		ok: false,
		format: lower,
		text: "",
		chars: 0,
		reason: "旧版 .doc/.xls 二进制格式暂不支持读取，请另存为 .docx/.xlsx 或 PDF"
	};
	if ([
		"png",
		"jpg",
		"jpeg",
		"gif",
		"webp"
	].includes(lower)) return {
		ok: false,
		format: lower,
		text: "",
		chars: 0,
		reason: "图片内容需要视觉模型读取（read_image 工具），本工具只处理文档文本"
	};
	return {
		ok: false,
		format: lower,
		text: "",
		chars: 0,
		reason: `暂不支持读取 .${lower} 格式`
	};
}
/**
* 抽 PDF 文本。
* @param bytes - 文件字节
* @returns 结果；无文本层时标记 `scanned`
*/
async function readPdf(bytes) {
	try {
		const doc = await (await import("pdfjs-dist/legacy/build/pdf.mjs")).getDocument({
			data: new Uint8Array(bytes),
			useSystemFonts: true
		}).promise;
		const pages = [];
		for (let index = 1; index <= doc.numPages; index += 1) {
			const text = (await (await doc.getPage(index)).getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" ").replace(/[ \t]+/g, " ").trim();
			if (text.length > 0) pages.push(text);
		}
		await doc.cleanup();
		const text = pages.join("\n\n");
		if (text.length === 0) return {
			ok: false,
			format: "pdf",
			text: "",
			chars: 0,
			scanned: true,
			reason: `这份 PDF 共 ${doc.numPages} 页，没有可抽取的文本层（很可能是扫描件），需要 OCR 才能读取`
		};
		return {
			ok: true,
			format: "pdf",
			text,
			chars: text.length,
			outline: [`共 ${doc.numPages} 页`, `有文本层 ${pages.length} 页`]
		};
	} catch (error) {
		return {
			ok: false,
			format: "pdf",
			text: "",
			chars: 0,
			reason: `PDF 解析失败：${error instanceof Error ? error.message : String(error)}`
		};
	}
}
/**
* 抽 DOCX 段落文本。
* @param bytes - 文件字节
* @returns 结果
*/
function readDocx(bytes) {
	try {
		const documentXml = unzipSync(new Uint8Array(bytes))["word/document.xml"];
		if (documentXml === void 0) return {
			ok: false,
			format: "docx",
			text: "",
			chars: 0,
			reason: "DOCX 里没有 word/document.xml，文件可能损坏或不是 Word 文档"
		};
		const paragraphs = strFromU8(documentXml).split(/<w:p[ >]/).slice(1).map((block) => {
			return [...block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1] ?? "").join("").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
		}).filter((paragraph) => paragraph.trim().length > 0);
		const text = paragraphs.join("\n");
		if (text.length === 0) return {
			ok: false,
			format: "docx",
			text: "",
			chars: 0,
			reason: "这份 DOCX 里没有可读取的文字（可能只有图片或表格对象）"
		};
		return {
			ok: true,
			format: "docx",
			text,
			chars: text.length,
			outline: [`${paragraphs.length} 个非空段落`]
		};
	} catch (error) {
		return {
			ok: false,
			format: "docx",
			text: "",
			chars: 0,
			reason: `DOCX 解析失败：${error instanceof Error ? error.message : String(error)}`
		};
	}
}
/**
* 抽 XLSX 单元格文本（含共享字符串还原）。
* @param bytes - 文件字节
* @returns 结果
*/
function readXlsx(bytes) {
	try {
		const entries = unzipSync(new Uint8Array(bytes));
		const sharedXml = entries["xl/sharedStrings.xml"];
		const shared = [];
		if (sharedXml !== void 0) for (const match of strFromU8(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
			const text = [...(match[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? "").join("");
			shared.push(text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
		}
		const sheets = Object.keys(entries).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort();
		if (sheets.length === 0) return {
			ok: false,
			format: "xlsx",
			text: "",
			chars: 0,
			reason: "XLSX 里没有工作表，文件可能损坏"
		};
		const blocks = [];
		for (const sheet of sheets) {
			const rows = [];
			for (const rowMatch of strFromU8(entries[sheet]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
				const cells = [];
				for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
					const attrs = cellMatch[1] ?? "";
					const body = cellMatch[2] ?? "";
					if (/t="s"/.test(attrs)) {
						const index = Number(/<v>(\d+)<\/v>/.exec(body)?.[1]);
						cells.push(shared[index] ?? "");
					} else cells.push((/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "").replace(/&amp;/g, "&"));
				}
				if (cells.some((cell) => cell.trim().length > 0)) rows.push(cells.join("	"));
			}
			if (rows.length > 0) blocks.push(`[${sheet.replace("xl/worksheets/", "").replace(".xml", "")}]\n${rows.join("\n")}`);
		}
		const text = blocks.join("\n\n");
		if (text.length === 0) return {
			ok: false,
			format: "xlsx",
			text: "",
			chars: 0,
			reason: "这份 XLSX 的工作表里没有可读取的单元格内容"
		};
		return {
			ok: true,
			format: "xlsx",
			text,
			chars: text.length,
			outline: [`${sheets.length} 个工作表`]
		};
	} catch (error) {
		return {
			ok: false,
			format: "xlsx",
			text: "",
			chars: 0,
			reason: `XLSX 解析失败：${error instanceof Error ? error.message : String(error)}`
		};
	}
}
//#endregion
//#region src/documents-tool.ts
/** 工具名：dot_ 前缀避免与官方工具撞名。 */
const READ_DOCUMENT_TOOL = "dot_read_document";
/**
* 判断一个路径是否落在允许的根目录内。
* 为什么用 relative 而不是 startsWith：`/w/workspace-evil` 会误通过 `startsWith('/w/workspace')`。
* @param root - 允许的根目录（绝对路径）
* @param target - 待检查路径（绝对路径）
* @returns 在根内为 true
*/
function insideRoot$1(root, target) {
	const rel = relative(resolve(root), resolve(target));
	return rel.length > 0 ? !rel.startsWith("..") && !isAbsolute(rel) : true;
}
/**
* 注册文档读取工具。
* @param ctx - Host 上下文
* @param workspaceRoot - 允许读取的根目录（通常是配置里的工作区）
* @returns 注册的清理函数
*/
function registerDocumentTool(ctx, workspaceRoot) {
	return ctx.tools.register(defineTool({
		name: READ_DOCUMENT_TOOL,
		description: "读取工作区内一份文档的正文。支持纯文本/Markdown/JSON/CSV、PDF（需有文本层）、DOCX、XLSX。读不出时会说明原因（例如扫描件需要 OCR、旧版 .doc 不支持）。",
		parameters: {
			path: {
				type: "string",
				description: "工作区内的绝对路径"
			},
			attachmentId: {
				type: "string",
				description: "会话里上传附件的 attachmentId（形如 sha256:...，与 path 二选一）"
			},
			bytes: {
				type: "number",
				description: "附件字节数，必须与上传回执一致（附件服务会用它做完整性校验）"
			},
			name: {
				type: "string",
				description: "附件原始文件名，用于判断格式（传 attachmentId 时建议一起给）"
			}
		},
		output: {
			schema: {
				type: "object",
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					format: {
						type: "string",
						required: true
					},
					text: {
						type: "string",
						required: true
					},
					chars: {
						type: "number",
						required: true
					},
					reason: { type: "string" },
					scanned: { type: "boolean" }
				},
				additionalProperties: false
			},
			render: (_args, value) => [{
				type: "text",
				text: value.ok ? `已读取 ${value.format}（${value.chars} 字）：\n\n${value.text}` : `读取失败（${value.format}）：${value.reason ?? "未知原因"}`
			}]
		},
		async execute(args) {
			if (args.attachmentId !== void 0) {
				const attachments = ctx.get("attachments");
				if (attachments === void 0) return {
					ok: false,
					format: "",
					text: "",
					chars: 0,
					reason: "附件服务未挂载，无法读取上传的文件"
				};
				if (args.bytes === void 0) return {
					ok: false,
					format: "",
					text: "",
					chars: 0,
					reason: "读取上传附件需要同时提供 bytes（上传回执里的字节数），否则附件服务无法做完整性校验"
				};
				const format = extname(args.name ?? "").replace(".", "").toLowerCase();
				const ref = {
					attachmentId: AttachmentId(args.attachmentId),
					name: args.name ?? "file",
					bytes: args.bytes
				};
				const controller = new AbortController();
				try {
					const chunks = [];
					let total = 0;
					for await (const chunk of attachments.readFileStream(ref, controller.signal)) {
						total += chunk.byteLength;
						if (total > 20971520) {
							controller.abort();
							return {
								ok: false,
								format,
								text: "",
								chars: 0,
								reason: `附件超过 ${MAX_BYTES / 1024 / 1024}MB 读取上限，已停止读取`
							};
						}
						chunks.push(chunk);
					}
					const joined = new Uint8Array(total);
					let offset = 0;
					for (const chunk of chunks) {
						joined.set(chunk, offset);
						offset += chunk.byteLength;
					}
					const result = await readDocumentBytes(joined, format);
					return {
						ok: result.ok,
						format: result.format,
						text: result.text,
						chars: result.chars,
						...result.reason === void 0 ? {} : { reason: result.reason },
						...result.scanned === void 0 ? {} : { scanned: result.scanned }
					};
				} catch (error) {
					return {
						ok: false,
						format,
						text: "",
						chars: 0,
						reason: `读取附件失败：${error instanceof Error ? error.message : String(error)}`
					};
				}
			}
			if (args.path === void 0) return {
				ok: false,
				format: "",
				text: "",
				chars: 0,
				reason: "请给 path（工作区文件）或 attachmentId（会话上传附件）"
			};
			if (!isAbsolute(args.path)) return {
				ok: false,
				format: "",
				text: "",
				chars: 0,
				reason: "path 必须是绝对路径"
			};
			if (!insideRoot$1(workspaceRoot, args.path)) return {
				ok: false,
				format: "",
				text: "",
				chars: 0,
				reason: `只允许读取工作区内的文件：${workspaceRoot}`
			};
			const result = await readDocument(args.path);
			return {
				ok: result.ok,
				format: result.format,
				text: result.text,
				chars: result.chars,
				...result.reason === void 0 ? {} : { reason: result.reason },
				...result.scanned === void 0 ? {} : { scanned: result.scanned }
			};
		}
	}));
}
//#endregion
//#region src/artifacts.ts
/** 单个成果文件的大小上限（字符）：5MB 纯文本足够长报告，再大应改成分片。 */
const MAX_ARTIFACT_CHARS = 5 * 1024 * 1024;
/**
* 判断相对路径是否安全（不逃出根目录）。
* 为什么用 `relative` 而不是字符串前缀：`/root/artifacts-evil` 会骗过
* `startsWith('/root/artifacts')`；`relative` 会返回 `../artifacts-evil`。
* @param root - 根目录绝对路径
* @param target - 待检查的绝对路径
* @returns 在根内为 true
*/
function insideRoot(root, target) {
	const rel = relative(resolve(root), resolve(target));
	return rel.length > 0 ? !rel.startsWith("..") && !isAbsolute(rel) : true;
}
/**
* 把成果写进成果目录。
* @param root - 成果根目录（绝对路径，来自部署配置）
* @param name - 文件名（可含子目录，但不得逃出根）
* @param text - 正文
* @returns 写入结果
*/
async function writeArtifact(root, name, text) {
	if (name.trim() === "") return {
		ok: false,
		path: "",
		bytes: 0,
		reason: "文件名不能为空"
	};
	if (isAbsolute(name) || name.length > 1 && name[1] === ":" && /[A-Za-z]/.test(name[0] ?? "")) return {
		ok: false,
		path: "",
		bytes: 0,
		reason: "文件名必须是成果目录内的相对路径（不接受绝对路径或盘符）"
	};
	if (text.length > 5242880) return {
		ok: false,
		path: "",
		bytes: 0,
		reason: `正文 ${(text.length / 1024 / 1024).toFixed(1)}M 字符超过 ${MAX_ARTIFACT_CHARS / 1024 / 1024}M 上限`
	};
	const base = resolve(root);
	let target = resolve(join(base, name));
	if (!insideRoot(base, target) || target === base) return {
		ok: false,
		path: "",
		bytes: 0,
		reason: `文件名必须是成果目录内的相对路径：${base}`
	};
	if (existsSync(target)) {
		const dot = target.lastIndexOf(".");
		const stem = dot > 0 ? target.slice(0, dot) : target;
		const ext = dot > 0 ? target.slice(dot) : "";
		let index = 2;
		while (existsSync(`${stem}-${index}${ext}`)) index += 1;
		target = `${stem}-${index}${ext}`;
	}
	try {
		await mkdir(resolve(target, ".."), { recursive: true });
		await writeFile(target, text, "utf8");
		return {
			ok: true,
			path: target,
			bytes: Buffer.byteLength(text, "utf8")
		};
	} catch (error) {
		return {
			ok: false,
			path: "",
			bytes: 0,
			reason: `写入失败：${error instanceof Error ? error.message : String(error)}`
		};
	}
}
/**
* 把 CSV/TSV 文本切成行与单元格。
* 为什么手写而不是拉 CSV 库：本工具只处理**本地生成的规整表格**，需要支持的最小集是
* 引号包裹与逗号转义；引入依赖反而会在"引号里有换行"这类边缘上与库的行为不一致。
* @param text - 表格文本
* @param delimiter - 分隔符
* @returns 行数组（每行是单元格数组）
*/
function parseDelimited(text, delimiter) {
	const rows = [];
	let row = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quoted) {
			if (char === "\"") if (text[index + 1] === "\"") {
				cell += "\"";
				index += 1;
			} else quoted = false;
			else cell += char;
			continue;
		}
		if (char === "\"") {
			quoted = true;
			continue;
		}
		if (char === delimiter) {
			row.push(cell);
			cell = "";
			continue;
		}
		if (char === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			continue;
		}
		if (char === "\r") continue;
		cell += char;
	}
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}
/**
* 读一份表格并做聚合。
* @param text - CSV/TSV 文本（调用方负责取内容；路径来源不同但算法同一份）
* @param options.delimiter - 分隔符，默认按首行猜（有制表符用制表符）
* @param options.hasHeader - 首行是否表头，默认 true
* @param options.groupBy - 按该列名分组计数
* @returns 计算结果
*/
function computeTable(text, options = {}) {
	const rows = parseDelimited(text, options.delimiter ?? (text.includes("	") ? "	" : ","));
	if (rows.length === 0) return {
		ok: false,
		header: [],
		rows: 0,
		columns: [],
		reason: "表格是空的"
	};
	const hasHeader = options.hasHeader ?? true;
	const header = hasHeader ? rows[0].map((value) => value.trim()) : rows[0].map((_, index) => `列${index + 1}`);
	const body = hasHeader ? rows.slice(1) : rows;
	if (header.length === 0) return {
		ok: false,
		header: [],
		rows: 0,
		columns: [],
		reason: "没有可识别的列"
	};
	const columns = header.map((column, columnIndex) => {
		let numbers = 0;
		let skipped = 0;
		let sum = 0;
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const row of body) {
			const raw = (row[columnIndex] ?? "").trim();
			if (raw === "") {
				skipped += 1;
				continue;
			}
			const value = Number(raw.replace(/,/g, ""));
			if (!Number.isFinite(value)) {
				skipped += 1;
				continue;
			}
			numbers += 1;
			sum += value;
			if (value < min) min = value;
			if (value > max) max = value;
		}
		if (numbers === 0) return {
			column,
			numbers,
			skipped
		};
		return {
			column,
			numbers,
			skipped,
			sum,
			mean: sum / numbers,
			min,
			max
		};
	});
	let groups;
	if (options.groupBy !== void 0) {
		const index = header.indexOf(options.groupBy);
		if (index < 0) return {
			ok: false,
			header,
			rows: body.length,
			columns,
			reason: `没有这一列：${options.groupBy}（可选：${header.join("、")}）`
		};
		const counts = /* @__PURE__ */ new Map();
		for (const row of body) {
			const key = (row[index] ?? "").trim();
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		groups = [...counts.entries()].map(([key, count]) => ({
			key,
			count
		})).sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
	}
	return {
		ok: true,
		header,
		rows: body.length,
		columns,
		...groups === void 0 ? {} : { groups }
	};
}
/**
* 读文件并计算表格（便利入口，用于工具）。
* @param path - 文件绝对路径
* @param options - 同 {@link computeTable}
* @returns 计算结果
*/
async function computeTableFile(path, options = {}) {
	try {
		return computeTable(await readFile(path, "utf8"), options);
	} catch (error) {
		return {
			ok: false,
			header: [],
			rows: 0,
			columns: [],
			reason: `读取失败：${error instanceof Error ? error.message : String(error)}`
		};
	}
}
//#endregion
//#region src/artifacts-tool.ts
/** 工具名常量：供测试与能力页引用，避免各处拼字符串。 */
const WRITE_ARTIFACT_TOOL = "dot_write_artifact";
const COMPUTE_TABLE_TOOL = "dot_compute_table";
/**
* 注册成果工具。
* @param ctx - Host 上下文
* @param artifactsRoot - 成果根目录（绝对路径，来自部署配置）
* @returns 注册的清理函数
*/
function registerArtifactTools(ctx, artifactsRoot) {
	const disposeWrite = ctx.tools.register(defineTool({
		name: WRITE_ARTIFACT_TOOL,
		description: `把成果写成文件（只写入本机成果目录，不覆盖已有文件）。适合长报告、清单、表格导出的文本。单文件上限 ${MAX_ARTIFACT_CHARS / 1024 / 1024}M 字符。`,
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "文件名（相对成果目录，可含子目录，例如 report.md）"
			},
			text: {
				type: "string",
				required: true,
				description: "文件正文"
			}
		},
		output: {
			schema: {
				type: "object",
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					path: {
						type: "string",
						required: true
					},
					bytes: {
						type: "number",
						required: true
					},
					reason: { type: "string" }
				},
				additionalProperties: false
			},
			render: (_args, value) => [{
				type: "text",
				text: value.ok ? `已写入 ${value.path}（${value.bytes} 字节）` : `写入失败：${value.reason ?? "未知原因"}`
			}],
			/**
			* 可回放的成果元数据。
			*
			* ▍为什么必须有
			* 工作插件原本只在模型**主动调用 `present`** 时才登记成果；模型忘了 present，
			* 文件就写在了盘上却没人知道它属于哪件工作——"办完了但成果丢了"。
			* 这份 meta 落在 `tool/result` 上，工作插件可以直接读它做文件候选，不依赖模型自觉。
			*
			* ▍为什么是稳定 JSON 而不是自然语言
			* 消费方要按字段判断（`dot`/`kind`），不能解析中文句子。字段名一旦改动，
			* 工作插件那边的登记逻辑就会静默失效，所以这里只增不改。
			* ▍只在成功时给
			* 失败没有路径可登记；给一个空路径只会让上层多一条脏候选。
			* @param _args - 调用参数（未使用）
			* @param value - 工具返回的规范值
			* @returns 成果事件形状的 JSON
			*/
			presentationMeta: (_args, value) => value.ok ? {
				dot: "artifact",
				kind: "file-created",
				path: value.path,
				title: basename(value.path),
				bytes: value.bytes,
				mimeType: value.path.endsWith(".md") ? "text/markdown" : value.path.endsWith(".csv") ? "text/csv" : value.path.endsWith(".json") ? "application/json" : "text/plain"
			} : {
				dot: "artifact",
				kind: "failed"
			}
		},
		async execute(args) {
			const result = await writeArtifact(artifactsRoot, args.name, args.text);
			return {
				ok: result.ok,
				path: result.path,
				bytes: result.bytes,
				...result.reason === void 0 ? {} : { reason: result.reason }
			};
		}
	}));
	const disposeCompute = ctx.tools.register(defineTool({
		name: COMPUTE_TABLE_TOOL,
		description: "读取成果目录内的一份 CSV/TSV，按列统计（数值列给求和/均值/最小值/最大值/计数），可按某列分组计数。只做计算，不改文件。",
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "成果目录内的文件名（例如 sales.csv）"
			},
			groupBy: {
				type: "string",
				description: "按这一列的取值分组计数（用表头名）"
			},
			delimiter: {
				type: "string",
				description: "分隔符，默认按内容猜（有制表符用制表符，否则逗号）"
			},
			hasHeader: {
				type: "boolean",
				description: "首行是否为表头，默认 true"
			}
		},
		output: {
			schema: {
				type: "object",
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					header: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					rows: {
						type: "number",
						required: true
					},
					columns: {
						type: "array",
						required: true,
						items: {
							type: "object",
							properties: {
								column: {
									type: "string",
									required: true
								},
								numbers: {
									type: "number",
									required: true
								},
								skipped: {
									type: "number",
									required: true
								},
								sum: { type: "number" },
								mean: { type: "number" },
								min: { type: "number" },
								max: { type: "number" }
							},
							additionalProperties: false
						}
					},
					groups: {
						type: "array",
						items: {
							type: "object",
							properties: {
								key: {
									type: "string",
									required: true
								},
								count: {
									type: "number",
									required: true
								}
							},
							additionalProperties: false
						}
					},
					reason: { type: "string" }
				},
				additionalProperties: false
			},
			render: (_args, value) => {
				if (!value.ok) return [{
					type: "text",
					text: `计算失败：${value.reason ?? "未知原因"}`
				}];
				const lines = [`共 ${value.rows} 行，${value.header.length} 列（${value.header.join(" / ")}）`];
				for (const column of value.columns) lines.push(column.numbers === 0 ? `- ${column.column}：无可用数值（跳过 ${column.skipped} 个非数值）` : `- ${column.column}：${column.numbers} 个数值，合计 ${column.sum}，均值 ${column.mean?.toFixed(2)}，范围 ${column.min}~${column.max}（跳过 ${column.skipped}）`);
				if (value.groups !== void 0) {
					lines.push("分组计数：");
					for (const group of value.groups) lines.push(`  ${group.key || "(空)"}: ${group.count}`);
				}
				return [{
					type: "text",
					text: lines.join("\n")
				}];
			}
		},
		async execute(args) {
			const result = await computeTableFile(join(artifactsRoot, args.name), {
				...args.groupBy === void 0 ? {} : { groupBy: args.groupBy },
				...args.delimiter === void 0 ? {} : { delimiter: args.delimiter },
				...args.hasHeader === void 0 ? {} : { hasHeader: args.hasHeader }
			});
			return {
				ok: result.ok,
				header: [...result.header],
				rows: result.rows,
				columns: result.columns.map((column) => ({
					column: column.column,
					numbers: column.numbers,
					skipped: column.skipped,
					...column.sum === void 0 ? {} : { sum: column.sum },
					...column.mean === void 0 ? {} : { mean: column.mean },
					...column.min === void 0 ? {} : { min: column.min },
					...column.max === void 0 ? {} : { max: column.max }
				})),
				...result.groups === void 0 ? {} : { groups: result.groups.map((group) => ({
					key: group.key,
					count: group.count
				})) },
				...result.reason === void 0 ? {} : { reason: result.reason }
			};
		}
	}));
	return () => {
		disposeWrite();
		disposeCompute();
	};
}
//#endregion
//#region src/file-extract.ts
/** 各种上限：都是"超了就降级成只给列表/只给开头"，不是报错。 */
const LIMITS = Object.freeze({
	/** 交给模型的单个文件文字上限（字符）。超了截断并注明。 */
	textChars: 4e4,
	/** 压缩包条目数上限。 */
	archiveEntries: 2e3,
	/** 压缩包合计解压大小上限（字节）。 */
	archiveTotalBytes: 64 * 1024 * 1024,
	/** 压缩包单条解压大小上限（字节）。 */
	archiveEntryBytes: 16 * 1024 * 1024,
	/** 压缩比上限：单条解压/压缩超过这个倍数视为炸弹。 */
	archiveRatio: 120,
	/** 压缩包里最多读几份文件的内容（其余只列名字）。 */
	archiveReadFiles: 40,
	/** 文件列表最多列几行。 */
	listLines: 300,
	/** 原文件超过这个大小就不解析，只说明大小（上传上限另在路由层）。 */
	sourceBytes: 50 * 1024 * 1024
});
/** 按扩展名直接当文本读的格式（含代码）。 */
const TEXT_EXT = /* @__PURE__ */ new Set([
	"txt",
	"text",
	"md",
	"markdown",
	"mdx",
	"rst",
	"adoc",
	"org",
	"tex",
	"log",
	"out",
	"json",
	"jsonl",
	"ndjson",
	"json5",
	"geojson",
	"ipynb",
	"csv",
	"tsv",
	"yaml",
	"yml",
	"toml",
	"ini",
	"cfg",
	"conf",
	"env",
	"properties",
	"xml",
	"html",
	"htm",
	"xhtml",
	"svg",
	"srt",
	"vtt",
	"sub",
	"ass",
	"js",
	"mjs",
	"cjs",
	"jsx",
	"ts",
	"mts",
	"cts",
	"tsx",
	"vue",
	"svelte",
	"astro",
	"css",
	"scss",
	"sass",
	"less",
	"styl",
	"py",
	"pyi",
	"rb",
	"go",
	"rs",
	"java",
	"kt",
	"kts",
	"scala",
	"groovy",
	"gradle",
	"swift",
	"m",
	"mm",
	"c",
	"h",
	"cc",
	"cpp",
	"cxx",
	"hpp",
	"hh",
	"cs",
	"fs",
	"vb",
	"php",
	"pl",
	"pm",
	"lua",
	"r",
	"jl",
	"dart",
	"ex",
	"exs",
	"erl",
	"hs",
	"clj",
	"cljs",
	"elm",
	"nim",
	"zig",
	"v",
	"sol",
	"sql",
	"graphql",
	"gql",
	"proto",
	"thrift",
	"sh",
	"bash",
	"zsh",
	"fish",
	"ps1",
	"psm1",
	"bat",
	"cmd",
	"makefile",
	"mk",
	"cmake",
	"dockerfile",
	"nix",
	"tf",
	"hcl",
	"lock",
	"gitignore",
	"editorconfig",
	"diff",
	"patch",
	"bib",
	"ics",
	"vcf"
]);
/** 取小写扩展名；Makefile/Dockerfile 这类无扩展名的按全名。 */
function extOf(name) {
	const lower = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
	if (lower.endsWith(".tar.gz")) return "tar.gz";
	const dot = lower.lastIndexOf(".");
	if (dot <= 0) return lower;
	return lower.slice(dot + 1);
}
/** 嗅探：前 8KB 无 NUL、能按 UTF-8 严格解码，就当文本。 */
function looksLikeText(bytes) {
	const head = bytes.subarray(0, Math.min(bytes.byteLength, 8192));
	if (head.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(head.byteLength < bytes.byteLength ? trimPartialUtf8(head) : head);
		return true;
	} catch {
		return false;
	}
}
/** 截掉末尾被切断的半个 UTF-8 字符，避免嗅探误判。 */
function trimPartialUtf8(bytes) {
	let end = bytes.byteLength;
	for (let i = 1; i <= 3 && end - i >= 0; i++) {
		const byte = bytes[end - i];
		if ((byte & 192) === 128) continue;
		if ((byte & 192) === 192) end -= i;
		break;
	}
	return bytes.subarray(0, end);
}
/** UTF-8 解码（宽松；带 BOM 去掉）。 */
function decodeText(bytes) {
	const text = new TextDecoder("utf-8").decode(bytes);
	return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}
/** XML/HTML → 纯文字（够模型读，不追求排版）。 */
function xmlToText(xml) {
	return xml.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|h[1-6]|li|tr|br|text:p|text:h|a:p)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&amp;/g, "&").replace(/[ \t\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** 只读中央目录列条目，不解压。坏包抛错由调用方接住。 */
function listZip(bytes) {
	const entries = [];
	unzipSync(bytes, { filter(file) {
		entries.push({
			name: file.name,
			size: file.size,
			originalSize: file.originalSize
		});
		return false;
	} });
	return entries;
}
/** 炸弹检查：返回不通过的原因；通过返回 undefined。 */
function zipBombReason(entries) {
	if (entries.length > LIMITS.archiveEntries) return `条目 ${entries.length} 个，超过 ${LIMITS.archiveEntries} 个上限`;
	let total = 0;
	for (const entry of entries) {
		total += entry.originalSize;
		if (entry.originalSize > LIMITS.archiveTotalBytes) return `"${entry.name}" 解压后 ${mb(entry.originalSize)}，超过上限`;
		if (entry.size > 0 && entry.originalSize / entry.size > LIMITS.archiveRatio && entry.originalSize > 1024 * 1024) return `"${entry.name}" 压缩比异常（疑似解压炸弹）`;
	}
	if (total > LIMITS.archiveTotalBytes) return `解压后合计 ${mb(total)}，超过 ${mb(LIMITS.archiveTotalBytes)} 上限`;
}
/** 安全解出 zip 里选中的条目；每条实际字节再核一次。 */
function unzipSelected(bytes, wanted) {
	const out = unzipSync(bytes, { filter: (file) => wanted.has(file.name) && file.originalSize <= LIMITS.archiveEntryBytes });
	for (const [name, data] of Object.entries(out)) if (data.byteLength > LIMITS.archiveEntryBytes) delete out[name];
	return out;
}
const mb = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
/** OOXML/ODF/EPUB 这类"zip 外壳"文档：先过炸弹检查再解。 */
function guardedContainer(bytes) {
	let entries;
	try {
		entries = listZip(bytes);
	} catch {
		return {
			entries: [],
			reason: "文件已损坏，或不是有效的压缩格式"
		};
	}
	const reason = zipBombReason(entries);
	return reason === void 0 ? { entries } : {
		entries,
		reason
	};
}
/** PPTX：按幻灯片顺序抽 <a:t>。 */
function readPptx(bytes) {
	const { entries, reason } = guardedContainer(bytes);
	if (reason !== void 0) return {
		ok: false,
		kind: "PPT 演示文稿",
		text: "",
		notes: [reason]
	};
	const slides = entries.map((e) => e.name).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
	const files = unzipSelected(bytes, new Set(slides));
	return {
		ok: true,
		kind: "PPT 演示文稿",
		text: slides.map((name, index) => {
			const runs = [...(files[name] === void 0 ? "" : strFromU8(files[name])).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => xmlToText(m[1])).filter(Boolean);
			return `【第 ${index + 1} 页】\n${runs.join("\n")}`;
		}).join("\n\n"),
		notes: [`共 ${slides.length} 页`]
	};
}
/** ODT/ODS/ODP：content.xml 去标签。 */
function readOdf(bytes, ext) {
	const kind = ext === "ods" ? "OpenDocument 表格" : ext === "odp" ? "OpenDocument 演示文稿" : "OpenDocument 文档";
	const { reason } = guardedContainer(bytes);
	if (reason !== void 0) return {
		ok: false,
		kind,
		text: "",
		notes: [reason]
	};
	const files = unzipSelected(bytes, /* @__PURE__ */ new Set(["content.xml"]));
	if (files["content.xml"] === void 0) return {
		ok: false,
		kind,
		text: "",
		notes: ["文件里找不到正文（content.xml）"]
	};
	return {
		ok: true,
		kind,
		text: xmlToText(strFromU8(files["content.xml"]).replace(/<\/table:table-cell>/g, "	").replace(/<\/table:table-row>/g, "\n")),
		notes: []
	};
}
/** EPUB：按文件名顺序把 xhtml 去标签。 */
function readEpub(bytes) {
	const { entries, reason } = guardedContainer(bytes);
	if (reason !== void 0) return {
		ok: false,
		kind: "EPUB 电子书",
		text: "",
		notes: [reason]
	};
	const pages = entries.map((e) => e.name).filter((n) => /\.(x?html?)$/i.test(n)).sort();
	const files = unzipSelected(bytes, new Set(pages));
	return {
		ok: true,
		kind: "EPUB 电子书",
		text: pages.map((name) => files[name] === void 0 ? "" : xmlToText(strFromU8(files[name]))).filter(Boolean).join("\n\n"),
		notes: [`共 ${pages.length} 个章节文件`]
	};
}
/** RTF：去控制字（粗读，够看内容）。 */
function readRtf(bytes) {
	return {
		ok: true,
		kind: "RTF 文档",
		text: decodeText(bytes).replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\u(-?\d+)\??/g, (_, code) => String.fromCharCode((Number(code) + 65536) % 65536)).replace(/\\par[d]?/g, "\n").replace(/\{\\\*[^{}]*\}/g, "").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\n{3,}/g, "\n\n").trim(),
		notes: ["RTF 为粗略提取，格式已去掉"]
	};
}
/** tar：512 字节块，ustar 头。 */
function listTar(bytes) {
	const out = [];
	let offset = 0;
	while (offset + 512 <= bytes.byteLength && out.length <= LIMITS.archiveEntries) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const field = (start, len) => strFromU8(header.subarray(start, start + len)).replace(/\0[\s\S]*$/, "");
		const prefix = field(345, 155);
		const name = (prefix ? `${prefix}/` : "") + field(0, 100);
		const size = parseInt(field(124, 12).trim() || "0", 8) || 0;
		const type = field(156, 1);
		if (type === "0" || type === "") out.push({
			name,
			size,
			offset: offset + 512
		});
		else if (type === "5") out.push({
			name: name.endsWith("/") ? name : `${name}/`,
			size: 0,
			offset: offset + 512
		});
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return out;
}
/** gzip 声明的解压大小（ISIZE，mod 2^32）。 */
function gzipDeclaredSize(bytes) {
	if (bytes.byteLength < 18) return 0;
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.byteLength - 4, true);
}
/** 压缩包里的一份文件：读得懂就给内容。 */
async function readInner(name, data) {
	const ext = extOf(name);
	if ([
		"zip",
		"jar",
		"rar",
		"7z",
		"tar",
		"gz",
		"tgz",
		"tar.gz",
		"bz2",
		"xz"
	].includes(ext)) return void 0;
	const result = await extractFileText(data, name, { nested: true });
	return result.ok && result.text.trim().length > 0 ? result : void 0;
}
/** 把"列表 + 内容"拼成一份给模型的文字。 */
async function archiveText(kind, list, read) {
	const notes = [];
	const files = list.filter((e) => !e.name.endsWith("/"));
	const lines = files.slice(0, LIMITS.listLines).map((e) => `- ${e.name}（${mb(e.size)}）`);
	if (files.length > LIMITS.listLines) lines.push(`- ……另有 ${files.length - LIMITS.listLines} 个文件未列出`);
	const candidates = files.filter((e) => e.size > 0 && e.size <= LIMITS.archiveEntryBytes && !/(^|\/)(__MACOSX|\.git|node_modules)\//.test(e.name) && !/(^|\/)\._/.test(e.name));
	const chosen = candidates.slice(0, LIMITS.archiveReadFiles);
	const data = read(new Set(chosen.map((e) => e.name)));
	const bodies = [];
	let skipped = 0;
	for (const entry of chosen) {
		const bytes = data[entry.name];
		if (bytes === void 0) {
			skipped++;
			continue;
		}
		const inner = await readInner(entry.name, bytes);
		if (inner === void 0) {
			skipped++;
			continue;
		}
		bodies.push(`===== ${entry.name} =====\n${inner.text}`);
	}
	if (candidates.length > chosen.length) notes.push(`文件太多，只读了前 ${chosen.length} 个的内容`);
	if (skipped > 0) notes.push(`${skipped} 个文件是二进制或读不出文字，只列了名字`);
	return {
		ok: true,
		kind,
		text: `文件列表（共 ${files.length} 个）：\n${lines.join("\n")}${bodies.length > 0 ? `\n\n文件内容：\n${bodies.join("\n\n")}` : ""}`,
		notes
	};
}
/**
* 把一份文件转成给模型读的文字。
* @param bytes - 文件字节
* @param name - 原文件名（用扩展名判断类型）
* @returns 结果；从不抛异常
*/
async function extractFileText(bytes, name, options = {}) {
	try {
		return await extractInner(bytes, name, options);
	} catch (error) {
		return {
			ok: false,
			kind: "文件",
			text: "",
			notes: [`解析出错：${error instanceof Error ? error.message : String(error)}`]
		};
	}
}
async function extractInner(bytes, name, options) {
	const ext = extOf(name);
	if (bytes.byteLength > LIMITS.sourceBytes) return {
		ok: false,
		kind: "文件",
		text: "",
		notes: [`文件 ${mb(bytes.byteLength)}，超过 ${mb(LIMITS.sourceBytes)} 的解析上限`]
	};
	if (ext === "pdf" || ext === "docx" || ext === "xlsx" || ext === "xlsm") {
		if (ext !== "pdf") {
			const { reason } = guardedContainer(bytes);
			if (reason !== void 0) return {
				ok: false,
				kind: ext === "docx" ? "Word 文档" : "Excel 表格",
				text: "",
				notes: [reason]
			};
		}
		const result = await readDocumentBytes(bytes, ext === "xlsm" ? "xlsx" : ext);
		const kind = ext === "pdf" ? "PDF" : ext === "docx" ? "Word 文档" : "Excel 表格";
		if (!result.ok) return {
			ok: false,
			kind,
			text: "",
			notes: [result.scanned ? "这是扫描版 PDF，没有文字层，需要 OCR 才能读" : result.reason ?? "读不出文字"]
		};
		return {
			ok: true,
			kind,
			text: result.text,
			notes: result.outline === void 0 ? [] : [result.outline.join("；")]
		};
	}
	if (ext === "pptx") return readPptx(bytes);
	if (ext === "odt" || ext === "ods" || ext === "odp") return readOdf(bytes, ext);
	if (ext === "epub") return readEpub(bytes);
	if (ext === "rtf") return readRtf(bytes);
	if (ext === "doc" || ext === "xls" || ext === "ppt") return {
		ok: false,
		kind: "旧版 Office 文件",
		text: "",
		notes: ["旧版 .doc/.xls/.ppt 是老的二进制格式，读不了；另存为 .docx/.xlsx/.pptx 或 PDF 再传"]
	};
	if (ext === "zip" && !options.nested) {
		let entries;
		try {
			entries = listZip(bytes);
		} catch {
			return {
				ok: false,
				kind: "ZIP 压缩包",
				text: "",
				notes: ["压缩包已损坏或加了密码，解不开"]
			};
		}
		const reason = zipBombReason(entries);
		const list = entries.map((e) => ({
			name: e.name,
			size: e.originalSize
		}));
		if (reason !== void 0) {
			const lines = list.slice(0, LIMITS.listLines).map((e) => `- ${e.name}（${mb(e.size)}）`);
			return {
				ok: true,
				kind: "ZIP 压缩包",
				text: `文件列表（共 ${list.length} 个）：\n${lines.join("\n")}`,
				notes: [`没有解压：${reason}`]
			};
		}
		return archiveText("ZIP 压缩包", list, (names) => unzipSelected(bytes, names));
	}
	if ((ext === "tar" || ext === "tgz" || ext === "tar.gz" || ext === "gz") && !options.nested) {
		let tar = bytes;
		if (ext !== "tar") {
			const declared = gzipDeclaredSize(bytes);
			if (declared > LIMITS.archiveTotalBytes || declared / Math.max(1, bytes.byteLength) > LIMITS.archiveRatio && declared > 1024 * 1024) return {
				ok: false,
				kind: "GZ 压缩包",
				text: "",
				notes: ["解压后过大或压缩比异常（疑似解压炸弹），没有解压"]
			};
			tar = gunzipSync(bytes);
			if (tar.byteLength > LIMITS.archiveTotalBytes) return {
				ok: false,
				kind: "GZ 压缩包",
				text: "",
				notes: ["解压后过大，已丢弃"]
			};
			if (ext === "gz") {
				const innerName = name.replace(/\.gz$/i, "");
				if (!/\.tar$/i.test(innerName)) return extractInner(tar, innerName, { nested: true });
			}
		}
		const entries = listTar(tar);
		if (entries.length > LIMITS.archiveEntries) return {
			ok: false,
			kind: "TAR 压缩包",
			text: "",
			notes: [`条目超过 ${LIMITS.archiveEntries} 个上限`]
		};
		return archiveText(ext === "tar" ? "TAR 压缩包" : "TAR.GZ 压缩包", entries, (names) => {
			const out = {};
			for (const entry of entries) if (names.has(entry.name)) out[entry.name] = tar.subarray(entry.offset, entry.offset + entry.size);
			return out;
		});
	}
	if ([
		"rar",
		"7z",
		"bz2",
		"xz"
	].includes(ext)) return {
		ok: false,
		kind: `${ext.toUpperCase()} 压缩包`,
		text: "",
		notes: [`.${ext} 格式这边没有解压工具，读不了；换成 .zip 再传`]
	};
	if ([
		"png",
		"jpg",
		"jpeg",
		"gif",
		"webp",
		"bmp",
		"heic",
		"heif",
		"tif",
		"tiff",
		"ico"
	].includes(ext)) return {
		ok: false,
		kind: "图片文件",
		text: "",
		notes: ["图片要按图片发送，模型才能看图"]
	};
	if ([
		"mp3",
		"wav",
		"m4a",
		"aac",
		"flac",
		"ogg",
		"opus",
		"mp4",
		"mov",
		"avi",
		"mkv",
		"webm"
	].includes(ext)) return {
		ok: false,
		kind: "音视频文件",
		text: "",
		notes: ["音视频读不了内容，只能看到文件名和大小"]
	};
	if (TEXT_EXT.has(ext) || looksLikeText(bytes)) {
		const text = decodeText(bytes);
		const kind = ext === "csv" || ext === "tsv" ? "表格文本" : TEXT_EXT.has(ext) && ![
			"txt",
			"text",
			"md",
			"markdown",
			"log"
		].includes(ext) ? "代码/文本" : "文本";
		if (/\.(html?|xhtml)$/i.test(name)) return {
			ok: true,
			kind: "网页",
			text: xmlToText(text),
			notes: []
		};
		return {
			ok: true,
			kind,
			text,
			notes: []
		};
	}
	return {
		ok: false,
		kind: "二进制文件",
		text: "",
		notes: [`.${ext || "无扩展名"} 是二进制文件，读不出文字`]
	};
}
/** attachmentId（sha256:…）→ 安全文件名。 */
function sidecarName(attachmentId) {
	const id = String(attachmentId ?? "");
	return /^sha256:[0-9a-f]{64}$/.test(id) ? `${id.replace(":", "_")}.json` : void 0;
}
/**
* 上传落盘后调用：抽文字、写旁注。从不抛异常。
* @returns 写好的旁注路径；没写返回 undefined
*/
async function writeFileSidecar(dir, file, attachments) {
	try {
		const fileName = sidecarName(file.attachmentId);
		if (fileName === void 0) return void 0;
		const target = join(dir, fileName);
		if (existsSync(target)) return target;
		const hostPath = attachments?.fileHostPath?.(file);
		if (typeof hostPath !== "string") return void 0;
		const bytes = await readFile(hostPath);
		const name = typeof file.name === "string" ? file.name : "file";
		const result = await extractFileText(bytes, name);
		const truncated = result.text.length > LIMITS.textChars;
		const sidecar = {
			v: 1,
			name,
			bytes: bytes.byteLength,
			kind: result.kind,
			ok: result.ok,
			text: truncated ? result.text.slice(0, LIMITS.textChars) : result.text,
			notes: truncated ? [...result.notes, `内容很长，只给了前 ${LIMITS.textChars} 个字`] : result.notes,
			truncated
		};
		mkdirSync(dir, {
			recursive: true,
			mode: 448
		});
		const temp = `${target}.${process.pid}.tmp`;
		writeFileSync(temp, JSON.stringify(sidecar), { mode: 384 });
		renameSync(temp, target);
		return target;
	} catch {
		return;
	}
}
/**
* 模型请求组装时同步调用：有旁注就返回接在文件说明后面的文字块。
* @returns 文字块；没有旁注返回 undefined（模型照旧只看到路径说明）
*/
function readFileSidecarBlock(dir, ref) {
	try {
		const fileName = sidecarName(ref.attachmentId);
		if (fileName === void 0) return void 0;
		const target = join(dir, fileName);
		if (!existsSync(target)) return void 0;
		const sidecar = JSON.parse(readFileSync(target, "utf8"));
		const notes = sidecar.notes.length > 0 ? `（${sidecar.notes.join("；")}）` : "";
		if (!sidecar.ok) return `[DOT 已尝试读取这个${sidecar.kind}，读不出内容${notes}。如实告诉用户这个文件读不了，不要编造内容。]`;
		return `[DOT 已把这个${sidecar.kind}转成文字，下面就是它的内容${notes}：]\n<file-content name=${JSON.stringify(sidecar.name)}>\n${sidecar.text}\n</file-content>`;
	} catch {
		return;
	}
}
/** 全局钩子符号（补丁里用同名 Symbol.for）。 */
const FILE_EXTRACT_SYMBOL = Symbol.for("dot.cloud.fileExtract");
const FILE_TEXT_SYMBOL = Symbol.for("dot.cloud.fileText");
/**
* 装钩子：上传补丁调 fileExtract，dsh-llm 补丁调 fileText。
* @param dir - 旁注目录（本实例 DSH_HOME/dot-file-text）
* @returns 卸载函数
*/
function installFileTextHooks(dir) {
	const store = globalThis;
	const extract = (file, attachments) => writeFileSidecar(dir, file, attachments);
	const text = (ref) => readFileSidecarBlock(dir, ref);
	store[FILE_EXTRACT_SYMBOL] = extract;
	store[FILE_TEXT_SYMBOL] = text;
	return () => {
		if (store[FILE_EXTRACT_SYMBOL] === extract) delete store[FILE_EXTRACT_SYMBOL];
		if (store[FILE_TEXT_SYMBOL] === text) delete store[FILE_TEXT_SYMBOL];
	};
}
//#endregion
//#region src/file-download.ts
const FILE_DOWNLOAD_PATH = "/api/dotFiles/download";
const PREVIEW_TYPES = {
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	wav: "audio/wav",
	mp4: "video/mp4",
	webm: "video/webm"
};
const TEXT_PREVIEW = /* @__PURE__ */ new Set([
	"txt",
	"md",
	"markdown",
	"log",
	"csv",
	"tsv",
	"json",
	"jsonl",
	"yaml",
	"yml",
	"toml",
	"ini",
	"xml",
	"html",
	"htm",
	"svg",
	"js",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"jsx",
	"py",
	"go",
	"rs",
	"java",
	"kt",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"php",
	"rb",
	"sh",
	"sql",
	"css",
	"scss",
	"vue",
	"swift",
	"lua",
	"r",
	"srt",
	"vtt",
	"conf",
	"cfg",
	"env",
	"diff",
	"patch"
]);
const textResponse = (status, message) => new Response(message, {
	status,
	headers: {
		"content-type": "text/plain; charset=utf-8",
		"cache-control": "no-store"
	}
});
/**
* 处理一次下载请求。
* @param request - 入站请求
* @param attachments - 本实例附件服务
*/
function handleFileDownload(request, attachments) {
	const url = new URL(request.url, "http://dot.local");
	const id = url.searchParams.get("id") ?? "";
	const name = url.searchParams.get("name") ?? "";
	const inline = url.searchParams.get("inline") === "1";
	if (!/^sha256:[0-9a-f]{64}$/.test(id)) return textResponse(400, "文件编号不对");
	if (name === "" || name.length > 255 || /[\\/\0]/.test(name) || name === "." || name === "..") return textResponse(400, "文件名不对");
	let hostPath;
	let size;
	try {
		hostPath = attachments?.fileHostPath?.({
			kind: "file",
			attachmentId: id,
			name,
			bytes: 0
		});
		if (typeof hostPath !== "string") return textResponse(404, "找不到这个文件");
		const stat = statSync(hostPath);
		if (!stat.isFile()) return textResponse(404, "找不到这个文件");
		size = stat.size;
	} catch {
		return textResponse(404, "找不到这个文件");
	}
	const ext = extOf(name);
	const previewType = PREVIEW_TYPES[ext] ?? (TEXT_PREVIEW.has(ext) ? "text/plain; charset=utf-8" : void 0);
	const disposition = inline && previewType !== void 0 ? "inline" : "attachment";
	const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	const body = Readable.toWeb(createReadStream(hostPath));
	return new Response(body, {
		status: 200,
		headers: {
			"content-type": disposition === "inline" ? previewType : "application/octet-stream",
			"content-length": String(size),
			"content-disposition": `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
			"x-content-type-options": "nosniff",
			"content-security-policy": `${disposition === "inline" && previewType === "application/pdf" ? "" : "sandbox; "}default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; object-src 'self'`,
			"cache-control": "private, max-age=300"
		}
	});
}
//#endregion
//#region src/index.ts
/** 配置 schema：只有一个字段，缺省跟随启动目录（并在日志里明示）。 */
const Config = z.object({ documentsRoot: z.string() });
/** Loader 诊断里显示的名字。 */
const name = "dot-runtime";
/** 需要工具注册表与 Typert：没有它们就没有目录、也没有 Remote 出口。 */
const inject = ["tools", "typert"];
/**
* 装配 DOT 的 Host 面。
* @param ctx - Host 侧 Cordis 上下文
*/
function apply(ctx, config) {
	const directory = new CapabilityDirectory(ctx, ctx.tools);
	ctx.effect(() => () => directory.dispose(), "dot-runtime: 能力目录释放");
	new DotCapabilitiesController(ctx).bind(directory);
	ctx.effect(() => registerCapabilityTool(ctx, directory), "dot-runtime: 目录工具");
	const documentsRoot = config.documentsRoot ?? process.cwd();
	if (config.documentsRoot === void 0) ctx.logger("dot-runtime").warn("documentsRoot 未配置，文档读取回退到启动目录 %s；该目录可能包含配置与会话，部署时应显式指定用户资料目录", process.cwd());
	const dshHome = process.env.DSH_HOME;
	if (dshHome !== void 0 && dshHome !== "") ctx.effect(() => installFileTextHooks(join(dshHome, "dot-file-text")), "dot-runtime: 上传文件转文字");
	ctx.inject?.(["connection", "attachments"], (sub) => {
		const scoped = sub;
		scoped.effect(() => scoped.connection.fetch.register({
			path: FILE_DOWNLOAD_PATH,
			methods: ["GET"],
			requestBody: "buffered",
			fetch: (request) => handleFileDownload(request, scoped.attachments)
		}), "dot-runtime: 文件下载与预览");
	});
	if (process.env.DOT_CLOUD_MODE === "1") return;
	ctx.effect(() => registerDocumentTool(ctx, documentsRoot), "dot-runtime: 文档读取工具");
	ctx.effect(() => registerArtifactTools(ctx, join(documentsRoot, "artifacts")), "dot-runtime: 成果与计算工具");
}
//#endregion
export { COMPUTE_TABLE_TOOL, CapabilityDirectory, Config, DotCapabilitiesController, FILE_DOWNLOAD_PATH, FILE_EXTRACT_SYMBOL, LIMITS as FILE_TEXT_LIMITS, FILE_TEXT_SYMBOL, WRITE_ARTIFACT_TOOL, apply, computeTable, computeTableFile, extOf, extractFileText, handleFileDownload, inject, installFileTextHooks, name, readDocument, readDocumentBytes, readFileSidecarBlock, registerArtifactTools, registerDocumentTool, writeArtifact, writeFileSidecar, zipBombReason };
