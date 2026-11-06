/* ================================================================
   DOT 成果引用

   ▍这是什么
   一件工作产出的"可读结果"的统一引用。文字答复也算成果——很多事没文件。

   ▍为什么要引用而不是内嵌
   成果正文可能很大，也可能需要插件停用后仍能打开。引用让存储与显示分开：
   记录里只留 id 与元信息，正文由成果所有者按需读取；这样"停用界面插件"
   不会连成果一起消失。

   ▍修改铁律
   1. 【不】把正文塞进 WorkSnapshot；快照要轻，否则每次查进度都在搬附件。
   2. 未知 kind 必须能被通用兜底显示（文字或下载），不能因为多了新类型就白屏。
   ================================================================ */
import type { ArtifactId, WorkId } from './ids.ts'

/** 成果种类。`text` 是可直接渲染的文字；`file` 需要按 mime 选择查看或下载。 */
export type ArtifactKind = 'text' | 'file'

/** 成果元信息：足以列表、判断能否打开、以及通用兜底显示。 */
export interface ArtifactRef {
  readonly id: ArtifactId
  /** 产出它的工作；成果可独立于工作存续。 */
  readonly workId: WorkId
  readonly kind: ArtifactKind
  /** 面向人的标题；缺省时界面显示 id，不编造内容。 */
  readonly title: string
  /** ISO-8601 生成时间。 */
  readonly createdAt: string
  /** 文件成果的 MIME；文字成果为 `text/plain` 或 `text/markdown`。 */
  readonly mimeType?: string
  /** 字节数；未知时省略，不填 0 冒充"空文件"。 */
  readonly byteLength?: number
  /** 文字成果的正文长度（字符数），用于列表预览判断，不用于限制读取。 */
  readonly charLength?: number
}

/** 一次性取回的成果内容。文字与字节二选一，都按只读交付。 */
export type ArtifactContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'file'; readonly bytes: Uint8Array; readonly mimeType: string }
