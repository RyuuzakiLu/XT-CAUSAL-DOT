/* 服务签收的是哪个模型必须核对，不能只收到ok就标为选中。 */
export async function selectDotModel(port, provider, model) {
    const route = port.rows().find(row => row.id === provider);
    const entry = route?.models.find(row => row.id === model);
    if (!entry || !route?.active)
        throw new Error('模型不在当前可用目录，请重新读取');
    if (port.busy())
        throw new Error('ASTRA正在处理当前对话，请结束后再切换模型');
    const result = await port.select({ sessionId: await port.session(), provider, model });
    if (!result.ok)
        throw new Error(result.error.message);
    if (result.value.selected.provider !== provider || result.value.selected.model !== model)
        throw new Error('服务未确认切换到所选模型');
    port.selected(provider, model);
    return entry.name;
}
