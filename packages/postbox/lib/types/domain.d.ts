import type { DeliveryRecord, OperationRecord, PostboxEvent } from './types.ts';
/** 星邮匣域：名固定 `dot_postbox`（UNIT_NAME_RE 要求小写字母开头、仅小写/数字/下划线）。 */
export declare const POSTBOX_DOMAIN: {
    name: string;
    version: number;
    tables: {
        /** 事件主表：键是事件 id。 */
        events: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, PostboxEvent>;
        /** 投递表：键是 `eventId::channel`，同一事件同一渠道只有一条。 */
        deliveries: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, DeliveryRecord>;
        /** 操作台账：键是 operationId，重放同一 operationId 直接取首次结果。 */
        ops: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, OperationRecord>;
    };
    global: {
        schema: import("zod").ZodObject<{
            seq: import("zod").ZodNumber;
            preferences: import("zod").ZodObject<{
                dnd: import("zod").ZodObject<{
                    enabled: import("zod").ZodBoolean;
                    startMinute: import("zod").ZodNumber;
                    endMinute: import("zod").ZodNumber;
                    timezone: import("zod").ZodString;
                    until: import("zod").ZodOptional<import("zod").ZodNumber>;
                    allowUrgent: import("zod").ZodOptional<import("zod").ZodBoolean>;
                }, import("zod/v4/core").$strip>;
                events: import("zod").ZodOptional<import("zod").ZodObject<{
                    completed: import("zod").ZodBoolean;
                    attention: import("zod").ZodBoolean;
                    failed: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                channels: import("zod").ZodObject<{
                    native: import("zod").ZodBoolean;
                    feishu: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>;
                feishu: import("zod").ZodObject<{
                    enabled: import("zod").ZodBoolean;
                    target: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>;
                native: import("zod").ZodObject<{
                    minIntervalMs: import("zod").ZodNumber;
                    maxAgeMs: import("zod").ZodDefault<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>;
        }, import("zod/v4/core").$strip>;
        initial: import("./types.ts").PostboxGlobal;
    };
};
