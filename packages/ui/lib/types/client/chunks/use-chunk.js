/* ================================================================
   React 侧的分块取用钩子
   ▍这是什么
   把 loadChunk 包成「首帧能同步命中就先渲染，没命中就占位并补取」的小 hook；
   失败保留错误给占位显示重试，不在 hook 里自己吞掉。
   ▍结构
   初始态（peek 同步命中）→ effect 补取 → 重试计数驱动再来一次。
   ▍修改铁律
   1. 【不】在这里做 suspense：整棵壳不能被一个字块的网络等待挂起。
   2. 【不】卸载时清缓存：房间来回切换不该每次重新下载。
   3. `enabled=false` 表示"现在不需要"：典型是精灵图集，静止时不该为七种样子的
      大图先付一次下载；等真的要换样子再打开开关。
   ================================================================ */
import { useCallback, useEffect, useState } from 'react';
import { loadChunk, peekChunk } from "./runtime.js";
/**
 * 取一块并跟随其状态。
 * @param id - 块 id
 * @param enabled - 关掉时不发起请求，但仍会响应"已经就绪"的同步命中
 * @returns 模块、错误与重试入口
 */
export function useChunk(id, enabled = true) {
    const [module, setModule] = useState(() => peekChunk(id) ?? null);
    const [error, setError] = useState(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const ready = peekChunk(id);
        if (ready !== undefined) {
            setModule(ready);
            setError(null);
            return;
        }
        if (!enabled)
            return;
        let alive = true;
        setModule(null);
        setError(null);
        loadChunk(id).then((value) => { if (alive) {
            setModule(value);
            setError(null);
        } }, (cause) => { if (alive)
            setError(cause instanceof Error ? cause : new Error(String(cause))); });
        return () => { alive = false; };
    }, [id, attempt, enabled]);
    const retry = useCallback(() => setAttempt(value => value + 1), []);
    return { module, error, retry, attempt };
}
