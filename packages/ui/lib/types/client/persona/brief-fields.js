/* ================================================================
   DOT 人设分栏 · 总导游图
   ▍这是什么
   把外貌、性格等自由填写栏装进原有 brief 字符串；不改变保存接口。
   纯 TypeScript，无网络；引导页和设置页共用，旧的一整段人设放在“其他”。
   ▍结构
   栏目定义 → 解析旧值 → 序列化。
   ▍修改铁律
   1. 【不】把示例当默认值；空栏不送给模型，免得用户没填也被安排一种性格。
   2. 保留旧正文，不为分栏丢失用户已经写过的内容。
   ▍更新记录
   *更新：2026-10-27 · 补齐自由填写分栏，沿用原 brief 存储与扩写预览。*
================================================================ */
export const BRIEF_FIELDS = [
    { key: 'appearance', label: '外貌', placeholder: '可以写发型、衣着或你希望的形象。' },
    { key: 'personality', label: '性格', placeholder: '它待人做事是什么脾气？' },
    { key: 'style', label: '说话风格', placeholder: '喜欢简短直说，还是细致解释？' },
    { key: 'address', label: '称呼', placeholder: '希望它平时怎么称呼你？' },
    { key: 'self', label: '自称', placeholder: '它说起自己时，用什么称呼？' },
    { key: 'catchphrase', label: '口癖', placeholder: '有什么常说的话或表达习惯？' },
    { key: 'other', label: '其他', placeholder: '还想补充什么？原来写的人设也保留在这里。' },
];
/* 只认自己生成的行首标签；无标签的旧正文原样留在“其他”。 */
export function parseBrief(value) {
    const values = Object.fromEntries(BRIEF_FIELDS.map(field => [field.key, '']));
    let current = 'other';
    for (const line of value.split('\n')) {
        const field = BRIEF_FIELDS.find(item => line.startsWith(`${item.label}：`));
        if (field) {
            current = field.key;
            values[current] += (values[current] ? '\n' : '') + line.slice(field.label.length + 1);
        }
        else
            values[current] += (values[current] ? '\n' : '') + line;
    }
    return values;
}
/* 标签只为扩写模型认栏，不填的栏目不凭空添加内容。 */
export function serializeBrief(values) {
    return BRIEF_FIELDS.filter(field => values[field.key].trim()).map(field => `${field.label}：${values[field.key]}`).join('\n');
}
