# DOT Lite 界面

手机优先的 Lite 网页界面，经典场景已移除。入口为 `src/client/DotShell.tsx`，主体在 `src/client/lite/`，共享设置和素材按需加载，字体使用系统字体。

需要 DSH 宿主、DOT 业务插件及自行配置的外部服务。具体配置、构建命令和已知接口差异见根目录 [README.md](../../README.md)。

公开副本不附带测试用例；电脑端体验和完整端到端链路尚未验收。
