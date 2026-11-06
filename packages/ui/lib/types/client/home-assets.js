/* ================================================================
   DOT 首页交付素材 · 总导游图
   ▍这是什么
   原图的WebP派生内嵌资源，供原生单文件 client 加载，不依赖宿主磁盘路径。
   现按用途拆到 ./home-assets/<键>.ts：只有真正用到某张图的房间才背那张图，
   本文件保留成合并视图，供旧的整表引用继续编译。
   ▍结构
   单键模块（字节原样）→ 本文件合并成 homeAssets 表。
   ▍修改铁律
   1. 原件留assets，派生图不覆盖原件；头像只裁现有入物不生成新角色。
   2. 【不】把新图直接塞进本文件：新增键先落单键模块，本表再登记。
   3. 【新】生产代码请直接 import 单键模块（./home-assets/<键>.ts）；
      引用本表等于把六张图一起拖进所在分块，首开不该这么做。
   ▍更新记录
   *更新：2026-10-23 · 主立绘、精灵与横竖书房四个可选位置*
   *更新：2026-10-25 · 按空间分块：拆成单键模块，本文件改为合并导出（字节零改动）*
================================================================ */
import { astra_avatar_small } from "./home-assets/astra_avatar_small.js";
import { astra_chibi_idle } from "./home-assets/astra_chibi_idle.js";
import { astra_sprite_docked_v2 } from "./home-assets/astra_sprite_docked_v2.js";
import { astra_sprite_seated_v2 } from "./home-assets/astra_sprite_seated_v2.js";
import { home_bg_study_night } from "./home-assets/home_bg_study_night.js";
import { home_core_orbit_base } from "./home-assets/home_core_orbit_base.js";
export const homeAssets = { astra_avatar_small, astra_chibi_idle, astra_sprite_docked_v2, astra_sprite_seated_v2, home_bg_study_night, home_core_orbit_base };
