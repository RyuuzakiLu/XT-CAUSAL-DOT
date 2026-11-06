export type ModelFamily = 'DeepSeek' | 'Claude' | 'GPT' | 'Gemini' | 'GLM' | 'Qwen' | 'Kimi' | 'Grok' | 'Mistral' | '其他模型';
export declare function modelFamily(model: {
    id: string;
    name: string;
}): ModelFamily;
