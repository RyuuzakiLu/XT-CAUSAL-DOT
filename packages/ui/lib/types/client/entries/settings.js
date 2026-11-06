/* ================================================================
   设置覆盖层分块入口（client.settings.js）
   ▍这是什么
   个人设置（快捷面板 + 设置中心六组）与其两组大美术随块取回。
   覆盖层只是盖在房间上，关闭后底下房间原状态不变。
   ▍样式
   设置自己的规则在本块取回时挂上；壳不再首开挂它。
   ▍修改铁律
   1. 【不】在这里做业务接线：偏好与回执仍由壳注入的 personalSettings 提供。
   2. 【不】import 别的房间：块里只放设置自己的东西。
   ▍更新记录
   2026-10-25 · 建立：设置覆盖层按需块。
   ================================================================ */
import { ensureChunkStyle } from "../chunks/styles.js";
import { cssText } from '../settings.module.css';
import { SettingsOverlay as Scene } from "../SettingsOverlay.js";
ensureChunkStyle('dot-settings', cssText);
export { Scene };
