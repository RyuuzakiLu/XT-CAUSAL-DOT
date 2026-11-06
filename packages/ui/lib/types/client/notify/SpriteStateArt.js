import { jsx as _jsx } from "react/jsx-runtime";
/* ================================================================
   DOT 精灵状态图 · 按精灵图集逐帧播放一种状态
   ▍这是什么
   用一张精灵图集（几列几行），按 manifest 里的每帧时长切 background-position。
   外框尺寸完全沿用传进来的 className（精灵原来的 spriteArt），所以换图不改变精灵大小和位置。
   减少动画时只显示第一帧。
   *更新：2026-10-24 · 建立（先接 reminder）*
   *更新：2026-10-24 · 七种样子全接上（「等你定的事」第 10 项 C），读屏文字按样子换*
================================================================ */
import { useEffect, useState } from 'react';
import css from './notify.module.css';
import { spriteStateSheets } from "../sprite-states-art.js";
/** 第 index 帧在图集里的 background-position（百分比）。 */
export function sheetPosition(index, columns, rows) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = columns > 1 ? (column / (columns - 1)) * 100 : 0;
    const y = rows > 1 ? (row / (rows - 1)) * 100 : 0;
    return `${x}% ${y}%`;
}
const POSE_ALT = {
    idle: 'ASTRA 在待机',
    'user-typing': 'ASTRA 在听你说',
    thinking: 'ASTRA 在思考',
    responding: 'ASTRA 在回答',
    working: 'ASTRA 在工作',
    reminder: 'ASTRA 捧着信封，请你确认',
    done: 'ASTRA 完成了一项工作',
};
export function SpriteStateArt({ state, className, reducedMotion }) {
    const sheet = spriteStateSheets[state];
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        setFrame(0);
        if (reducedMotion)
            return;
        let index = 0;
        let timer;
        const tick = () => {
            timer = setTimeout(() => {
                const next = index + 1;
                if (next >= sheet.durationsMs.length && !sheet.loop)
                    return;
                index = next % sheet.durationsMs.length;
                setFrame(index);
                tick();
            }, sheet.durationsMs[index] ?? 160);
        };
        tick();
        return () => clearTimeout(timer);
    }, [sheet, reducedMotion]);
    return _jsx("span", { className: `${className ?? ''} ${css['spriteStateArt']}`, role: "img", "aria-label": POSE_ALT[state], "data-sprite-pose": state, "data-frame": frame, style: { backgroundImage: `url("${sheet.src}")`, backgroundSize: `${sheet.columns * 100}% ${sheet.rows * 100}%`, backgroundPosition: sheetPosition(frame, sheet.columns, sheet.rows) } });
}
