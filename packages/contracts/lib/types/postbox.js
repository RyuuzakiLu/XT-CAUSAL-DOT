/**
 * 一条事件是否该在“有新信件”提示里出现。
 * 为什么成函数：书房信件入口、精灵气泡、系统通知都要同一条判定，
 * 否则会出现"信已读但气泡还在"这类自相矛盾的显示。
 * @param event - 事件
 * @returns 未读且未归档时为 true
 */
export function isUnreadLetter(event) {
    return !event.read && !event.archived;
}
