/** Never infer a historical card's owner from the currently retained conversation. */
export declare function sourceSession(element: Element): {
    id: string;
    readOnly: boolean;
} | undefined;
export declare function fingerprint(text: string): string;
export declare function actionMessage(action: string, payload: Record<string, unknown>): string;
