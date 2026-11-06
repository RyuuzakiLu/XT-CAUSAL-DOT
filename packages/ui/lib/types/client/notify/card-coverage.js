/** 这条通知对应的工作卡状态；不参与去重的返回 undefined。 */
export function cardStatusOf(notice) {
    if (!notice.workId)
        return undefined;
    /* 「你不在时…」汇总的是好几件工作，不能因为其中一张卡露着就收掉。 */
    if (notice.key?.startsWith('away:'))
        return undefined;
    if (notice.kind === 'input')
        return 'waiting-input';
    if (notice.kind === 'info' && notice.tone === 'done')
        return 'succeeded';
    if (notice.kind === 'info' && notice.tone === 'failed')
        return 'failed';
    return undefined;
}
/** 屏幕上是否已有一张同一工作、同一状态的工作卡在展示这条通知的内容。 */
export function noticeCoveredByCard(notice, doc = globalThis.document) {
    const status = cardStatusOf(notice);
    if (!status || !doc)
        return false;
    const view = doc.defaultView;
    const width = view?.innerWidth ?? 0, height = view?.innerHeight ?? 0;
    for (const element of doc.querySelectorAll('[data-work-id]')) {
        if (element.getAttribute('data-work-id') !== notice.workId || element.getAttribute('data-status') !== status)
            continue;
        if (element.closest('[hidden],[aria-hidden="true"],[inert]'))
            continue;
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0)
            continue;
        if (box.bottom <= 0 || box.right <= 0 || box.top >= height || box.left >= width)
            continue;
        return true;
    }
    return false;
}
