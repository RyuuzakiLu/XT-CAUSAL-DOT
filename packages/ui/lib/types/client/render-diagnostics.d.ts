declare global {
    interface Window {
        dotRenderErrors?: string[];
    }
}
export declare function observeRenderErrors(): () => void;
