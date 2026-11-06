/* ================================================================
   人物图源存放处 · 总导游图
   ▍这是什么
   人物图的 data URI 集中放这里，谁需要谁读；壳登记首屏那张头像，art 块登记
   三张精灵图。这样同一张图只在一个块里存在，不会被五个房间各背一份。
   ▍为什么需要这个中转
   分块各自打包时如果每个用到人物图的房间都 import 原图，同一张 140KB 的图会在
   五个块里各存一份——首开没省、总量反而涨。放到一个共享运行时表里，图只有一份。
   ▍为什么状态挂在 globalThis 上
   每个按需块是独立打包的，同一份模块代码在壳和块里各有一份实例；模块级变量
   互不相通。图源必须真共享，所以用 Symbol.for 在页面上存唯一一份状态。
   ▍结构
   页面单例（图源 + 订阅者）→ mergeArtSources → useSyncExternalStore。
   ▍修改铁律
   1. 【不】在这里写死图源：壳只登记自己的头像，三张精灵图只由 client.art.js 登记。
   2. 没取到图时调用方必须能退回占位（ArtSlot 已处理），不能等图才渲染。
   ▍更新记录
   2026-10-25 · 建立：替代 artwork.ts 里的静态全表；状态改为页面级单例。
   ================================================================ */
import { useSyncExternalStore } from 'react';
/* ⚠️ 必须是页面单例：壳与各按需块各有一份本模块代码，模块级变量不通。 */
const KEY = Symbol.for('xtcausal.dot.art-sources');
const host = globalThis;
const bridge = host[KEY] ?? (host[KEY] = { sources: {}, listeners: new Set() });
/**
 * 合并登记一批图源。
 * @param patch - 只提供本次拿到的字段；没提供的保持原值
 */
export function mergeArtSources(patch) {
    let changed = false;
    const next = { ...bridge.sources };
    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && next[key] !== value) {
            next[key] = value;
            changed = true;
        }
    }
    if (!changed)
        return;
    bridge.sources = next;
    for (const fn of [...bridge.listeners])
        fn();
}
/** 供非 React 代码（测试、诊断）同步读取。 */
export function getArtSources() {
    return bridge.sources;
}
function subscribe(fn) {
    bridge.listeners.add(fn);
    return () => { bridge.listeners.delete(fn); };
}
function snapshot() {
    return bridge.sources;
}
/** React 侧订阅：art/头像登记变化时自动重渲染引用它的组件。 */
export function useArtSources() {
    return useSyncExternalStore(subscribe, snapshot, snapshot);
}
