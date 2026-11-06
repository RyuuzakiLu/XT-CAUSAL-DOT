/* ================================================================
   人物图分块入口（client.art.js）· 总导游图
   ▍这是什么
   两张精灵图（坐姿/待机）的分块入口。取回后登记进 art-store，
   壳、环形菜单、设置、星邮匣共用同一份，不再各自内嵌。
   ▍修改铁律
   1. 【不】把首页书房背景、头像和停靠精灵放进来：它们首屏就要，留在壳里。
      只放"进菜单/换姿势才看得到"的那两张，否则首屏会先看到占位再闪成真图。
   2. 图源必须是 home-assets/<键>.ts 的原样导出，不重新编码。
   ================================================================ */
import { astra_sprite_seated_v2 } from '../home-assets/astra_sprite_seated_v2.ts'
import { astra_chibi_idle } from '../home-assets/astra_chibi_idle.ts'
import { mergeArtSources } from '../chunks/art-store.ts'

/* 停靠精灵在壳里（书房第一眼就要），这里只补菜单坐姿与待机两张。 */
export const sources = { seated: astra_sprite_seated_v2, sprite: astra_chibi_idle }

/* 登记在块求值时完成：块本身就是"取到即用"，没有更晚的合适时机。 */
mergeArtSources(sources)
