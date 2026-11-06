import { jsx as _jsx } from "react/jsx-runtime";
import { useChunk } from "./chunks/use-chunk.js";
import { ChunkFrame } from "./chunks/ChunkFrame.js";
import { LiteShell } from "./lite/LiteShell.js";
export function DotShell(props) {
    return _jsx(LiteShell, { ...props, renderSettings: () => _jsx(SettingsHost, { props: props }) });
}
function SettingsHost({ props }) {
    const { module, error, retry, attempt } = useChunk('settings');
    if (module === null)
        return _jsx(ChunkFrame, { overlay: true, label: "\u8BBE\u7F6E", error: error, retry: retry, fallback: () => props.actions.settings(null) }, attempt);
    const Scene = module.Scene;
    return _jsx(Scene, { ...props });
}
