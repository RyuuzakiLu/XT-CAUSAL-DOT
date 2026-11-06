/* 只包已经存在的原生方法；未知版本明确失败，不能静默拿到一个没生效的接头。 */
export function installSettingSubmission(conversation, handle) {
    const prototype = Object.getPrototypeOf(conversation);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'sendSession');
    if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.configurable)
        throw new Error('原生对话提交接口未匹配，设置指令桥未安装');
    const original = descriptor.value;
    const wrapped = async function (session, text, attachments, mode, signal) {
        if (!attachments.length && !signal?.aborted && await handle(text))
            return { kind: 'success' };
        return original.call(this, session, text, attachments, mode, signal);
    };
    Object.defineProperty(prototype, 'sendSession', { ...descriptor, value: wrapped });
    return () => {
        if (Object.getOwnPropertyDescriptor(prototype, 'sendSession')?.value === wrapped)
            Object.defineProperty(prototype, 'sendSession', descriptor);
    };
}
