/* ================================================================
   DOT 界面小本本 · 总导游图（改代码前必读）
   ▍这是什么
   保存本人设备上的空间、草稿、卡片引用与画布；TypeScript + DSH 原生 store。
   只给显示组件使用，不保存工作、记忆或通知的业务事实。
   ▍结构
   类型和几何规则 → 原生持久视图 store → 纯动作。
   ▍修改铁律
   1. 【不】把服务器状态塞进来，否则卡片会和真实工作各说各话。
   2. 撤销只动布局，不取消工作；收卡片只收显示，不删除成果。
   ▍更新记录
   *更新：2026-10-23 · 建立六空间、停靠、固定卡和画布撤销*
   *更新：2026-10-23 · 精灵统一金色环形入口、菜单互斥与返回收起*
   *更新：2026-10-24 · 接个人设置真实保存/显示消费与原生能力配置，保留精灵入口*
================================================================ */
import { defineStore } from '@deepseek-ai/dsh-client-store';
/* 越界坐标会把精灵藏到屏幕外，恢复旧布局也要走同一夹紧规则。 */
export function clamp(value, min, max) {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}
/* 排版只根据传入的卡片身份计算，不读取工作状态，因而撤销不会改业务。 */
export function arrangeCards(ids, width) {
    const columns = Math.max(1, Math.floor(Math.max(320, width) / 330));
    return Object.fromEntries(ids.map((id, index) => [id, {
            x: (index % columns) * 330, y: Math.floor(index / columns) * 230,
            width: 310, height: 210, z: index + 1,
        }]));
}
/* ⚠️ 2026-10-27：记忆房已下线（用户拍板撤掉"自己翻库"的入口）。
   老存档的 history 里可能还压着 'memory'，返回键按到它会把人送进一个没有入口的孤岛，
   所以统一用这个探针过滤：push 时不记、pop 时跳过。类型保留 'memory' 只为能识别旧存档。
   ⚠️ 2026-10-27（晚些）：能力空间也删了（用户：「能力空间那一页可以直接删掉，没有必要」）。
   旧入口仅保留作为兼容标识；
   页面代码和按需块都已删除，类型保留 'capabilities' 只为识别旧存档和旧历史，一律送回书房。 */
const RETIRED_SPACES = new Set(['memory', 'capabilities']);
export const isRetiredSpace = (space) => RETIRED_SPACES.has(space);
const usable = (space) => !isRetiredSpace(space);
/* 工厂由插件 apply 创建并交给注册器，共用一个声明，避免每个入口各记一份草稿。 */
export function createDotViewStore() {
    return defineStore({
        persist: 'xtcausal.dot.view.v1',
        init: () => ({
            space: 'study', nativePanel: null, rightbar: false, history: [], menu: false, orbitMenu: false, card: null, pinned: [], draft: '',
            reducedMotion: false, sprite: { edge: 'right', y: 0.42, small: false },
            canvas: {}, undo: [], focus: null,
        }),
        actions: {
            navigate(d, space) {
                /* 已下线的房间不接受导航：直接停在原地，不写历史、也不留半截状态。 */
                if (!usable(space))
                    return;
                /* 当前停在已下线房间（老存档）时被送回书房：别把那间房压进返回栈。 */
                if (d.space !== space) {
                    if (usable(d.space))
                        d.history.push(d.space);
                    d.space = space;
                }
                d.menu = false;
                d.orbitMenu = false;
                d.nativePanel = null;
            },
            rightbar(d, shown) { d.rightbar = shown; },
            nativePanel(d, panel) { d.nativePanel = panel; d.menu = false; d.orbitMenu = false; },
            settings(d, page) {
                if (page === null)
                    d.settingsStack = [];
                else if (d.settings && d.settings !== page)
                    (d.settingsStack ??= []).push(d.settings);
                d.settings = page;
                d.menu = false;
                d.orbitMenu = false;
            },
            back(d) {
                if (d.settings) {
                    d.settings = d.settingsStack?.pop() ?? null;
                    return;
                }
                if (d.orbitMenu) {
                    d.orbitMenu = false;
                    return;
                }
                if (d.menu) {
                    d.menu = false;
                    return;
                }
                if (d.card) {
                    d.card = null;
                    return;
                }
                if (d.rightbar) {
                    d.rightbar = false;
                    return;
                }
                if (d.nativePanel) {
                    d.nativePanel = null;
                    return;
                }
                /* 老存档压在栈里的已下线房间要跳过，不能退进去；整栈都不剩就回书房。 */
                let target = d.history.pop();
                while (target !== undefined && !usable(target))
                    target = d.history.pop();
                d.space = target ?? 'study';
            },
            /* 两种入口互斥，避免一层菜单盖住另一层却还留着旧焦点。 */
            menu(d, open) { d.menu = open; if (open)
                d.orbitMenu = false; },
            orbitMenu(d, open) { d.orbitMenu = open; if (open)
                d.menu = false; },
            draft(d, text) { d.draft = text; },
            clearSentDraft(d, submitted) { if (d.draft === submitted)
                d.draft = ''; },
            applyVoice(d, original, transcript) { if (d.draft === original)
                d.draft = transcript; },
            openCard(d, id) { d.card = id; },
            pin(d, id) { if (!d.pinned.includes(id))
                d.pinned.push(id); },
            unpin(d, id) { d.pinned = d.pinned.filter(value => value !== id); },
            dock(d, edge, y) { d.sprite = { edge, y: clamp(y, 0.08, 0.76), small: false }; },
            dockHome(d, edge, y) { d.homeSprite = { edge, y: clamp(y, 0.12, 0.64) }; },
            shrink(d, small) { d.sprite.small = small; },
            motion(d, reduce) { d.reducedMotion = reduce; },
            focus(d, id) { d.focus = id; },
            /* 对话里点工作小卡：带历史跳到工作空间，把这项工作设为焦点大卡；返回键回到对话。
               ⚠️ 记历史前先过 usable：当前若停在已下线房间（老存档），别把它压进栈里再退回去。 */
            revealWork(d, id) {
                if (d.space !== 'work') {
                    if (usable(d.space))
                        d.history.push(d.space);
                    d.space = 'work';
                }
                d.menu = false;
                d.orbitMenu = false;
                d.nativePanel = null;
                d.card = null;
                d.focus = id;
                d.workReveal = (d.workReveal ?? 0) + 1;
            },
            moveCard(d, id, value) {
                d.undo.push(Object.fromEntries(Object.entries(d.canvas).map(([id, geometry]) => [id, { ...geometry }])));
                d.undo = d.undo.slice(-20);
                d.canvas[id] = { x: clamp(value.x, 0, 20000), y: clamp(value.y, 0, 20000),
                    width: clamp(value.width, 220, 1600), height: clamp(value.height, 160, 1600), z: value.z };
            },
            arrange(d, ids, width) {
                d.undo.push(Object.fromEntries(Object.entries(d.canvas).map(([id, geometry]) => [id, { ...geometry }])));
                d.undo = d.undo.slice(-20);
                d.canvas = arrangeCards(ids, width);
            },
            undo(d) { const previous = d.undo.pop(); if (previous)
                d.canvas = previous; },
        },
    });
}
