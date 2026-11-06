/* ================================================================
   DOT 平台动作 · 总导游图
   ▍这是什么
   浏览器/Android 共用的语音、通知和返回接头；不承诺设备尚未提供的权限。
   ▍修改铁律
   1. 没有系统回执就不能说通知已显示；App 退出后的远程推送由原生服务负责。
   2. 语音先变可编辑文字，不越过用户直接发送。
   ▍更新记录
   *更新：2026-10-23 · Web Speech、通知点击与原生桥消费*
================================================================ */
export interface AndroidBridge {
  notify(input: { id: string; title: string; body: string; workId?: string }): Promise<{ delivered: boolean }>
  requestNotifications(): Promise<{ granted: boolean }>
  recognize(): Promise<{ text: string }>
  configureConnection(): Promise<void>
}
declare global { interface Window { dotAndroid?: AndroidBridge } }

/* 不支持 Web Speech 时明确失败，留给 Android 原生接头或文字输入。 */
export async function recognizeSpeech(): Promise<string> {
  if (window.dotAndroid) return (await window.dotAndroid.recognize()).text
  type Recognition = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void }
  const browser = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
  if (!Constructor) throw new Error('此设备尚未提供可用的语音转写，请使用文字输入')
  return new Promise((resolve, reject) => {
    const recognition = new Constructor()
    let settled = false
    recognition.lang = 'zh-CN'; recognition.interimResults = false
    const timeout = setTimeout(() => { recognition.stop(); if (!settled) { settled = true; reject(new Error('语音转写超时，文字草稿未改变')) } }, 45000)
    recognition.onresult = event => { if (!settled) { settled = true; clearTimeout(timeout); resolve(Array.from(event.results).map(result => result[0]?.transcript ?? '').join('')) } }
    recognition.onerror = event => { if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`语音输入失败：${event.error}`)) } }
    recognition.onend = () => { clearTimeout(timeout); if (!settled) { settled = true; reject(new Error('未识别到文字，草稿未改变')) } }
    recognition.start()
  })
}

/* 用户点击开启才申请权限，不能首次打开就弹系统门。 */
export async function requestNotifications(): Promise<void> {
  if (window.dotAndroid) { if (!(await window.dotAndroid.requestNotifications()).granted) throw new Error('系统通知权限未授予'); return }
  if (!('Notification' in window)) throw new Error('此浏览器不支持系统通知，星邮匣仍可查看')
  if (await Notification.requestPermission() !== 'granted') throw new Error('系统通知权限未授予')
}

/* 返回值只表示本轮本地系统通知已创建，不冒充远端或锁屏送达。 */
export async function showNotification(event: { id: string; title: string; body: string; workId?: string }, open: () => void): Promise<boolean> {
  if (window.dotAndroid) return (await window.dotAndroid.notify(event)).delivered
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  const notification = new Notification(event.title, { body: event.body, tag: `dot-${event.id}` })
  notification.onclick = () => { window.focus(); open(); notification.close() }
  return true
}
