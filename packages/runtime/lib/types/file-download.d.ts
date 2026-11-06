export declare const FILE_DOWNLOAD_PATH = "/api/dotFiles/download";
/** 附件服务里用到的方法。 */
export interface DownloadAttachments {
    fileHostPath?: (ref: {
        kind: 'file';
        attachmentId: string;
        name: string;
        bytes: number;
    }) => string | undefined;
}
/**
 * 处理一次下载请求。
 * @param request - 入站请求
 * @param attachments - 本实例附件服务
 */
export declare function handleFileDownload(request: Request, attachments: DownloadAttachments | undefined): Response;
