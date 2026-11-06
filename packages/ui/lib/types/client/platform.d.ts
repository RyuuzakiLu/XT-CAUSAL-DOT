export interface AndroidBridge {
    notify(input: {
        id: string;
        title: string;
        body: string;
        workId?: string;
    }): Promise<{
        delivered: boolean;
    }>;
    requestNotifications(): Promise<{
        granted: boolean;
    }>;
    recognize(): Promise<{
        text: string;
    }>;
    configureConnection(): Promise<void>;
}
declare global {
    interface Window {
        dotAndroid?: AndroidBridge;
    }
}
export declare function recognizeSpeech(): Promise<string>;
export declare function requestNotifications(): Promise<void>;
export declare function showNotification(event: {
    id: string;
    title: string;
    body: string;
    workId?: string;
}, open: () => void): Promise<boolean>;
