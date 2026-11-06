export interface ChunkFrameProps {
    /** 房间给人看的名字，例如「工作」。 */
    readonly label: string;
    /** 取块失败原因；null 表示还在取。 */
    readonly error: Error | null;
    /** 重试入口。 */
    readonly retry: () => void;
    /** 回退出口（通常是回书房）。 */
    readonly fallback: () => void;
    /** 覆盖层形态：设置/精灵块失败时不顶掉底下房间。 */
    readonly overlay?: boolean;
}
export declare function ChunkFrame({ label, error, retry, fallback, overlay }: ChunkFrameProps): import("react").JSX.Element;
