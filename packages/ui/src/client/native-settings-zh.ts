/* 「能力配置」面板里宿主直接透出的英文报错 → 中文兜底文案。
   报错文字来自 DSH 宿主包（权限预设、Inspector 查询连接），宿主没有中文版本。
   只换已知的句子，其余英文原样保留，免得把不认识的报错翻错。
   入参：一段文字；返回：替换后的文字，没有可换的返回 null。 */
const RULES: Array<[RegExp, string]> = [
  [/permission catalog has no active Host connection\.?/gi, '权限目录暂不可用：未连接到主机'],
  [/permission presets are not available on this host\.?/gi, '当前主机不提供权限预设'],
  [/the host offers no \/permission command\.?/gi, '当前主机不支持权限命令'],
  [/inspector (client )?query (transport|socket) is not connected\.?/gi, '未连接到主机，暂时读不到配置'],
  [/inspector query connection is closed\.?/gi, '与主机的连接已断开，暂时读不到配置'],
  [/[\w ]*has no active Host connection\.?/gi, '暂不可用：未连接到主机'],
]

export function nativeSettingsZh(text: string): string | null {
  let out = text
  for (const [pattern, zh] of RULES) out = out.replace(pattern, zh)
  return out === text ? null : out
}

/* 在面板里找并替换已知英文报错。只改文字节点的内容，不动元素结构；
   宿主下次重绘换成新文字时，观察器会再换一次。原文放进父元素 title，长按可见，便于排障。 */
export function translateNativeSettings(root: Node): number {
  let changed = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const zh = nativeSettingsZh(node.nodeValue ?? '')
    if (zh === null) continue
    const parent = node.parentElement
    if (parent && !parent.title) parent.title = node.nodeValue ?? ''
    node.nodeValue = zh
    changed++
  }
  return changed
}
