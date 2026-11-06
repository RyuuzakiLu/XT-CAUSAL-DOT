/** Build-collected upstream CSS; attached only while our plugin is active. */
const sheets = new Map<string, string>()
export function registerGenuiStyle(id: string, css: string): void { sheets.set(id, css) }
export function attachGenuiStyles(): () => void {
  const tags: HTMLStyleElement[] = []
  for (const [id, css] of sheets) {
    const tag = document.createElement('style'); tag.dataset.dotGenuiStyle = id; tag.textContent = css
    document.head.appendChild(tag); tags.push(tag)
  }
  return () => tags.forEach(tag => tag.remove())
}
