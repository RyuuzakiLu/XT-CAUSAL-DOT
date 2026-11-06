import { type Domain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
declare const entrySchema: z.ZodObject<{
    accountId: z.ZodString;
    inputId: z.ZodString;
    sessionRef: z.ZodString;
    messageId: z.ZodString;
    key: z.ZodString;
    resolutionId: z.ZodString;
    text: z.ZodString;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"supplement">;
        workId: z.ZodString;
        sessionId: z.ZodString;
        generation: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"followup">;
        workId: z.ZodString;
        parentRevision: z.ZodNumber;
        newWorkId: z.ZodString;
    }, z.core.$strict>], "kind">;
    state: z.ZodEnum<{
        accepted: "accepted";
        materialized: "materialized";
        delivered: "delivered";
    }>;
    createdAt: z.ZodString;
    attempts: z.ZodOptional<z.ZodNumber>;
    lastError: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type InputEntry = z.infer<typeof entrySchema>;
type Target = InputEntry['target'];
type AcceptedTarget = Exclude<Target, {
    kind: 'followup';
}> | Omit<Extract<Target, {
    kind: 'followup';
}>, 'newWorkId'>;
export declare const inputDomain: {
    name: string;
    version: number;
    tables: {
        commands: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            accountId: string;
            inputId: string;
            sessionRef: string;
            messageId: string;
            key: string;
            resolutionId: string;
            text: string;
            target: {
                kind: "supplement";
                workId: string;
                sessionId: string;
                generation: number;
            } | {
                kind: "followup";
                workId: string;
                parentRevision: number;
                newWorkId: string;
            };
            state: "accepted" | "materialized" | "delivered";
            createdAt: string;
            attempts?: number | undefined;
            lastError?: string | undefined;
        }>;
    };
};
type Source = Pick<InputEntry, 'sessionRef' | 'messageId' | 'key' | 'resolutionId' | 'text'>;
export declare function inputIdOf(actor: string, session: string, message: string, key: string): string;
export declare function acceptInput(domain: Domain<typeof inputDomain>, actor: string, source: Source, validateTarget: () => AcceptedTarget): Promise<InputEntry>;
export declare function materializeInput(domain: Domain<typeof inputDomain>, actor: string, inputId: string, apply: (entry: InputEntry) => Promise<void>): Promise<InputEntry>;
export {};
