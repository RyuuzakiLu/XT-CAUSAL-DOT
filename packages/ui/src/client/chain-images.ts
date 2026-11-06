/* ================================================================
   前文图片（拼接出来的旧会话用户图片）· 2026-11-01 Hark reloadfix
   ▍为什么有这个
   简洁版只有一个对话界面：闲置换会话（15 分钟）或重开 App 后，之前会话的消息由 session-chain.ts 拼在上方（只读 DOM）。
   以前拼前文只取文字，图片写成〔图片〕——图片其实一直在：会话记录里是附件引用（sha256 attachmentId），
   字节由宿主负责保管。这里按「来源会话 + attachmentId」走原生 RPC session/attachment 取回字节，
   转成 blob URL，交给 DOT 图集（DotImageStack）画，和当前会话里的图片一个样子。
   ▍规则
   1. 只读、只走原生 session/attachment（租户闸按会话归属放行，不另拼下载链接）。
   2. 同一张图（attachmentId）只取一次，URL 缓存到页面关闭；失败不缓存，图集自己有「重试」。
================================================================ */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { DotImageStack, type StackAttachment, type StackLoader } from './gallery/ImageStack.tsx'
import type { ChainImage, MountImages } from './session-chain.ts'

export type AttachmentResult =
  | { ok: true; value: { attachment: { mediaType?: string }; data: string } }
  | { ok: false; error: { code?: string; message?: string } }
export type AttachmentFn = (request: { sessionId: string; attachmentId: string }) => Promise<AttachmentResult>

function base64Bytes(data: string): Uint8Array {
  const bin = atob(data)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/** 按来源会话取图的 loader（带同步 peek，图集首帧就能直接用缓存）。 */
export function createChainImageLoader(attachment: AttachmentFn, sessionId: string, cache: Map<string, Promise<string>> = new Map(), ready: Map<string, string> = new Map()): StackLoader {
  const load = ((att: StackAttachment) => {
    const key = att.attachmentId
    const hit = cache.get(key)
    if (hit) return hit
    const pending = attachment({ sessionId, attachmentId: key }).then(result => {
      if (!result.ok) throw new Error(`${result.error.code ?? 'error'}: ${result.error.message ?? ''}`)
      const type = result.value.attachment?.mediaType || (att as { mediaType?: string }).mediaType || 'image/jpeg'
      const bytes = base64Bytes(result.value.data)
      const url = typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type }))
        : `data:${type};base64,${result.value.data}`
      ready.set(key, url)
      return url
    })
    cache.set(key, pending)
    pending.catch(() => { if (cache.get(key) === pending) cache.delete(key) })
    return pending
  }) as StackLoader
  load.peek = att => ready.get(att.attachmentId)
  return load
}

/** 前文图片挂载器：每条消息一个 React 根，画 DOT 图集。 */
export function createChainImageMounter(attachment: AttachmentFn): MountImages {
  const cache = new Map<string, Promise<string>>()
  const ready = new Map<string, string>()
  const loaders = new Map<string, StackLoader>()
  const loaderFor = (sessionId: string) => {
    let hit = loaders.get(sessionId)
    if (!hit) { hit = createChainImageLoader(attachment, sessionId, cache, ready); loaders.set(sessionId, hit) }
    return hit
  }
  return (host: HTMLElement, images: readonly ChainImage[], sessionId: string) => {
    const root = createRoot(host)
    root.render(createElement(DotImageStack, {
      images: images.map(image => ({ attachment: { ...image } })),
      loadImage: loaderFor(sessionId),
      align: 'end',
    }))
    return () => root.unmount()
  }
}
