/* ================================================================
   星邮匣 · 持久域声明

   ▍这是什么
   用官方 `defineDomain` 声明本包拥有的三张表 + 一个全局槽，交给
   `ctx.storageDomain.open()` 打开。表名/域名叫什么、落到哪块磁盘由 storage 后端
   配置决定（不是本包决定的），本包只声明"我要存什么形状"。

   ▍为什么用一个域而不是四个
   事件、投递、台账、偏好属于同一个业务；拆成多个域会让"事件写了、投递没写"
   变成可能。同一域里写入走同一条队列，顺序可读。
   —— 像一个抽屉里的三格：拿错格是可能的，但抽屉一开一关是原子的。

   ▍修改铁律
   1. 【不】改 domain 名或版本号来"顺手升级"：版本不一致时 open 会直接拒绝，
      已有用户数据读不出来。要改形状就升 version 并写迁移。
   2. 【不】给事件表加 `invalidRecords: 'backup-and-skip'`——事件是权威数据，
      坏一条应当让打开失败，而不是静默丢一条。
   ================================================================ */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { DEFAULT_GLOBAL, deliverySchema, eventSchema, globalSchema, operationSchema, } from "./types.js";
/** 星邮匣域：名固定 `dot_postbox`（UNIT_NAME_RE 要求小写字母开头、仅小写/数字/下划线）。 */
export const POSTBOX_DOMAIN = defineDomain({
    name: 'dot_postbox',
    version: 1,
    tables: {
        /** 事件主表：键是事件 id。 */
        events: domainTable(eventSchema),
        /** 投递表：键是 `eventId::channel`，同一事件同一渠道只有一条。 */
        deliveries: domainTable(deliverySchema),
        /** 操作台账：键是 operationId，重放同一 operationId 直接取首次结果。 */
        ops: domainTable(operationSchema),
    },
    global: { schema: globalSchema, initial: DEFAULT_GLOBAL },
});
