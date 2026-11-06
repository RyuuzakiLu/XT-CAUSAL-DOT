import type { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client';
export declare function installSettingSubmission(conversation: ConversationController, handle: (text: string) => Promise<boolean>): () => void;
