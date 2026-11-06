/** 在原生 Markdown 上遮住尚未读到的字，不替换正文或其节点。 */
export declare function createFastReply(): {
    stop: () => void;
    update(next: HTMLElement, id: string): void;
};
