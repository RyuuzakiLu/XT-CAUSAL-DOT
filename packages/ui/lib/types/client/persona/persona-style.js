/* 账号设定（引导页 + 设置里的人格页）的样式：深蓝玻璃 + 细金边，和星空书房/设置中心同一套配色。
   用 data-dotp 属性限定作用范围，不碰现有样式。 */
export const PERSONA_CSS = `
[data-dotp] { --dotp-gold: #dcb96f; --dotp-gold-hi: #f2d690; --dotp-ink: #f1e7d0; --dotp-mute: #95a2ba; }
[data-dotp] .dotp-field { display: flex; flex-direction: column; gap: 7px; padding: 12px 2px; }
[data-dotp] .dotp-field + .dotp-field { border-top: 1px solid #d9b56a29; }
[data-dotp] .dotp-label { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: max(var(--dot-fs-min, 0px), calc(14.5px * var(--dot-type-k, 1))); letter-spacing: .04em; color: var(--dotp-ink); }
[data-dotp] .dotp-label small { font-size: max(var(--dot-fs-min, 0px), calc(12px * var(--dot-type-k, 1))); color: var(--dotp-mute); letter-spacing: 0; }
[data-dotp] .dotp-input, [data-dotp] .dotp-area {
  box-sizing: border-box; width: 100%; margin: 0; padding: 11px 14px; border-radius: 12px;
  border: 1px solid #d9b56a6b; background: #050b1ccc; color: var(--dotp-ink);
  font: 16px/1.5 var(--dot-font-body, serif); letter-spacing: .02em; box-shadow: inset 0 1px 4px #000a; outline: none;
  transition: border-color .2s ease, box-shadow .2s ease;
}
[data-dotp] .dotp-area { min-height: 220px; resize: vertical; font-size: 15px; line-height: 1.75; }
[data-dotp] .dotp-input::placeholder, [data-dotp] .dotp-area::placeholder { color: #6f7c96; }
[data-dotp] .dotp-input:focus, [data-dotp] .dotp-area:focus { border-color: var(--dotp-gold-hi); box-shadow: inset 0 1px 4px #000a, 0 0 0 3px #f2cd7826; }
[data-dotp] .dotp-seg { display: flex; gap: 4px; padding: 4px; border-radius: 999px; border: 1px solid #d9b56a85; background: #070d1ee0; box-shadow: inset 0 1px 3px #0009; }
[data-dotp] .dotp-seg > button { all: unset; box-sizing: border-box; flex: 1 1 0; height: 38px; border-radius: 999px; text-align: center; cursor: pointer; color: #d6c8a6; font-size: 15px; letter-spacing: .08em; transition: background .2s ease, color .2s ease; }
[data-dotp] .dotp-seg > button:hover { background: #d9b56a1f; color: #f4e5c3; }
[data-dotp] .dotp-seg > button[aria-pressed=true] { background: linear-gradient(180deg, #f3d891, #c99d4b 70%, #b78a3c); color: #1d1607; font-weight: 600; box-shadow: 0 0 8px #f2cd7866, inset 0 1px 1px #ffffff73; }
[data-dotp] .dotp-seg > button:focus-visible, [data-dotp] .dotp-chip:focus-visible, [data-dotp] .dotp-btn:focus-visible { outline: 1.5px solid var(--dotp-gold-hi); outline-offset: 2px; }
[data-dotp] .dotp-chips { display: flex; flex-wrap: wrap; gap: 7px; }
[data-dotp] .dotp-chip { all: unset; box-sizing: border-box; padding: 6px 12px; border-radius: 999px; border: 1px solid #d9b56a55; background: #0b1530b3; color: #d9cba9; font-size: 13px; cursor: pointer; letter-spacing: .03em; }
[data-dotp] .dotp-chip:hover { border-color: var(--dotp-gold-hi); color: #f6e6bf; }
[data-dotp] .dotp-brief { min-height: 240px; font-size: 15px; line-height: 1.7; }
[data-dotp] .dotp-brief::placeholder { color: #66738d; font-size: 13.5px; line-height: 1.75; }
[data-dotp] .dotp-thin { margin: 2px 0 0; padding: 9px 12px; border-radius: 10px; border: 1px solid #d9b56a55; background: #2a2210b3; color: #ecd59f; font-size: 13px; line-height: 1.6; }
[data-dotp] .dotp-preview-tag { display: inline-block; align-self: center; margin: 0 auto 4px; padding: 2px 10px; border-radius: 999px; border: 1px solid #d9b56a66; color: #e9d29b; font-size: 12px; letter-spacing: .08em; }
@media (max-width: 420px) { [data-dotp] .dotp-brief { min-height: 272px; } }
[data-dotp] .dotp-hint { margin: 0; font-size: max(var(--dot-fs-min, 0px), calc(12.5px * var(--dot-type-k, 1))); line-height: 1.65; color: var(--dotp-mute); }
[data-dotp] .dotp-error { margin: 4px 0 0; padding: 9px 12px; border-radius: 10px; border: 1px solid #e0806f66; background: #2a1414cc; color: #f3c3b8; font-size: 13px; line-height: 1.6; }
[data-dotp] .dotp-ok { color: #a9e2bb; font-size: 13px; }
[data-dotp] .dotp-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 14px; }
[data-dotp] .dotp-btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; min-width: 120px; padding: 0 22px; border-radius: 999px; cursor: pointer;
  border: 1px solid #d9b56a9e; background: linear-gradient(180deg, #16243fd9, #0a1428eb); color: #ecdcb6; font-size: 15px; letter-spacing: .1em; box-shadow: inset 0 1px 0 #f6e2a833, 0 4px 12px #0008; }
[data-dotp] .dotp-btn:hover:not([aria-disabled=true]) { border-color: var(--dotp-gold-hi); box-shadow: inset 0 1px 0 #f6e2a833, 0 0 10px #f2cd7833, 0 4px 12px #0008; }
[data-dotp] .dotp-btn[data-primary=true] { border-color: #f6e2a8; background: linear-gradient(180deg, #f3d891, #c99d4b 70%, #b78a3c); color: #1d1607; font-weight: 600; box-shadow: 0 0 12px #f2cd7859, inset 0 1px 1px #ffffff73; }
[data-dotp] .dotp-btn[aria-disabled=true] { opacity: .55; cursor: default; }
[data-dotp] .dotp-link { all: unset; cursor: pointer; color: #b9c3d6; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
[data-dotp] .dotp-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #f2d69055; border-top-color: var(--dotp-gold-hi); animation: dotp-spin .9s linear infinite; }
@keyframes dotp-spin { to { transform: rotate(360deg); } }

/* ── 引导页：整屏星空 + 中央玻璃卡 ── */
.dotp-onboard { position: fixed; inset: 0; z-index: 2147482000; display: flex; align-items: center; justify-content: center; padding: max(16px, env(safe-area-inset-top)) 14px max(16px, env(safe-area-inset-bottom));
  overflow-y: auto; -webkit-overflow-scrolling: touch; font-family: var(--dot-font-body, serif); color: #f1e7d0;
  background:
    radial-gradient(1.4px 1.4px at 12% 18%, #fff8 50%, transparent 51%), radial-gradient(1px 1px at 28% 72%, #fff7 50%, transparent 51%),
    radial-gradient(1.6px 1.6px at 67% 14%, #ffe9b8aa 50%, transparent 51%), radial-gradient(1px 1px at 82% 46%, #fff6 50%, transparent 51%),
    radial-gradient(1.2px 1.2px at 45% 38%, #fff5 50%, transparent 51%), radial-gradient(1px 1px at 91% 83%, #fff7 50%, transparent 51%),
    radial-gradient(1.3px 1.3px at 7% 61%, #ffe9b899 50%, transparent 51%), radial-gradient(1px 1px at 56% 90%, #fff6 50%, transparent 51%),
    radial-gradient(120% 80% at 50% 0%, #1b2d55 0%, #0b1530 45%, #040812 100%);
  animation: dotp-fade .5s ease both; }
.dotp-onboard::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: radial-gradient(60% 40% at 50% 105%, #d9b56a1f, transparent 70%); }
@keyframes dotp-fade { from { opacity: 0; } to { opacity: 1; } }
.dotp-card { position: relative; box-sizing: border-box; width: min(100%, 470px); margin: auto; padding: 26px 20px 20px; border-radius: 22px;
  background: linear-gradient(180deg, #111f3ad9, #070e1ef0); border: 1px solid #d9b56a8c;
  box-shadow: inset 0 1px 0 #f6e2a833, inset 0 0 0 3px #08122633, inset 0 0 0 4px #d9b56a17, 0 18px 50px #000c;
  -webkit-backdrop-filter: blur(10px) saturate(1.1); backdrop-filter: blur(10px) saturate(1.1); animation: dotp-rise .6s cubic-bezier(.2,.8,.2,1) both; }
.dotp-card::before { content: ""; position: absolute; left: 14%; right: 14%; top: -1px; height: 1px; background: linear-gradient(90deg, #f6e2a800, #f8e7b4, #f6e2a800); }
@keyframes dotp-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.dotp-emblem { display: block; width: 58px; height: 58px; margin: 0 auto 10px; color: #f2d690; filter: drop-shadow(0 0 10px #f2cd7880); }
.dotp-kicker { margin: 0; text-align: center; font-family: var(--dot-font-accent, serif); font-size: 11px; letter-spacing: .5em; color: #c9a862; }
.dotp-title { margin: 6px 0 4px; text-align: center; font-family: var(--dot-font-heading, serif); font-weight: 500; font-size: 24px; letter-spacing: .14em; color: #f6ead0; }
.dotp-sub { margin: 0 0 14px; text-align: center; font-size: 13.5px; line-height: 1.7; color: #9fabc2; }
.dotp-steps { display: flex; justify-content: center; gap: 8px; margin: 0 0 12px; }
.dotp-steps > i { width: 7px; height: 7px; transform: rotate(45deg); border: 1px solid #d9b56a99; }
.dotp-steps > i[data-on=true] { background: linear-gradient(135deg, #f8e6ae, #b98c3e); box-shadow: 0 0 6px #f2cd78b3; }
.dotp-onboard .dotp-area:not(.dotp-brief) { min-height: 260px; }
@media (max-width: 420px) { .dotp-card { padding: 22px 16px 16px; border-radius: 18px; } .dotp-title { font-size: 21px; } [data-dotp] .dotp-btn { flex: 1 1 100%; } }
@media (prefers-reduced-motion: reduce) { .dotp-onboard, .dotp-card { animation: none; } [data-dotp] .dotp-spin { animation-duration: 3s; } }

/* ── 设置中心里的人格页：套在现有 cGlass 卡里 ── */
[data-dotp=settings] .dotp-field { padding: 12px 0; }
[data-dotp=settings] .dotp-actions { justify-content: flex-end; margin: 4px 0 12px; }
[data-dotp=settings] .dotp-btn { min-height: 40px; min-width: 96px; padding: 0 18px; font-size: 14px; }
`;
let installed = null;
let users = 0;
export function usePersonaStyle() {
    users += 1;
    if (!installed) {
        installed = document.createElement('style');
        installed.setAttribute('data-dot-persona-style', '');
        installed.textContent = PERSONA_CSS;
        document.head.appendChild(installed);
    }
    return () => {
        users -= 1;
        if (users <= 0 && installed) {
            installed.remove();
            installed = null;
            users = 0;
        }
    };
}
