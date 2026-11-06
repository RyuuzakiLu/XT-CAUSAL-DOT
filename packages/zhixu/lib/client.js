/* ================================================================
   DOT · 知序事务客户端 · 总导游图

   ▍这是什么
   ① 干什么：按当前登录账号，把一次工具调用发给云端知序。
   ② 技术栈：纯 ESM + 全局 fetch，无第三方依赖，也不需要构建。
   ③ 依赖：环境变量 DOT_ZHIXU_URL / DOT_ZHIXU_KEY（本账号钥匙）；
      可选 DOT_CLOUD_ACCOUNT（按账号拆进程时的固定账号，见 currentActor）。
   ④ 给谁看：packages/zhixu/lib/index.js，以及排障与测试。

   ▍身份从哪来（顺序固定，改之前先读懂）
   1. 首选 ALS 工牌（Symbol.for('dot.cloud.identity')）——多账号同进程时靠它区分是谁。
   2. ALS 没有账号时，退到进程环境 DOT_CLOUD_ACCOUNT。为什么允许这一步：
      按账号拆进程后，一个进程只服务一个人，工牌不再每请求注入；这时的"进程身份"
      就是可信身份。⚠️ 仍然【不】接受调用参数里的 actor——模型传什么都不算数。
   3. 两者都没有：报错，绝不默认成某个公共账号。

   ▍与云端认证的约定（zhixu-cloud/cloud-server.cjs）
   服务端拿 sha256(DOT_ZHIXU_KEY) 查钥匙簿得到账号；我们同时发 x-dot-actor 作为交叉核对，
   两者不一致服务端回 403 ACTOR_MISMATCH。所以这里取到的账号必须和这把钥匙真正的主人一致，
   否则就是配置装错了，报错是对的——【不】在这里做"猜账号"或重试兜底。

   ▍修改铁律
   1. 【不】让调用方传账号：账号只从 ALS 工牌 / 进程身份取，模型和界面都改不了。
   2. 取不到身份、没配置地址时【不】回落公共库，直接报错。
   3. 服务返回非 2xx 时把知序的错误码带出来，不回空对象冒充成功。
   ================================================================ */

/** 云端多账号身份符号，与 dot-cloud-runtime.mjs 使用的是同一个键。 */
const IDENTITY_KEY = Symbol.for('dot.cloud.identity')

/** 当前请求的账号；ALS 优先，其次进程固定账号；都没有就拒绝。 */
export function currentActor() {
  const carrier = globalThis[IDENTITY_KEY]
  const fromBrand = carrier?.getStore?.()?.actor
  if (typeof fromBrand === 'string' && fromBrand !== '') return fromBrand
  const fixed = process.env.DOT_CLOUD_ACCOUNT
  if (typeof fixed === 'string' && fixed.trim() !== '') return fixed.trim()
  throw new Error('缺少本端身份：知序事务必须绑定到登录账号')
}

/**
 * callZhixu()：契约
 * 入参：toolName（工具名）、args（参数对象）。
 * 返回：知序返回的 data。
 * 副作用：一次本机 HTTP POST；超时 20 秒。
 * 谁调用：packages/zhixu/lib/index.js 的 execute()。
 * 改动影响：改成浏览器可直连等于绕开账号隔离，【不】可改地址来源。
 */
export async function callZhixu(toolName, args) {
  const base = process.env.DOT_ZHIXU_URL
  const key = process.env.DOT_ZHIXU_KEY
  if (!base || !key) throw new Error('知序未配置（DOT_ZHIXU_URL / DOT_ZHIXU_KEY 缺失）')
  /* 先取身份再发请求：没有身份就不浪费一次网络往返，错误也更贴近真实病因。 */
  const actor = currentActor()
  const response = await fetch(`${base}/invoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dot-zhixu-key': key,
      'x-dot-actor': actor,
    },
    body: JSON.stringify({ name: toolName, arguments: args }),
    /* ⚠️ 30 秒不是随便定的：账号第一次访问时服务端要现开 SQLite 建表，慢盘上实测能到 7~20 秒。
       卡在 20 秒会在"新账号首次调用"上误伤，看着像接线坏了。 */
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body?.ok !== true) {
    const code = body?.error?.code ?? `HTTP_${response.status}`
    const message = body?.error?.message ?? '知序没有返回结果'
    /* 403 ACTOR_MISMATCH 是配置装错（发下去的钥匙和这个进程的账号不是同一个人），
       原样带出错误码让部署端一眼认出，不在这里猜账号重试。 */
    throw new Error(`知序 ${toolName} 失败（${code}）：${message}`)
  }
  return body.data
}
