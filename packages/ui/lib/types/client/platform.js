/* 不支持 Web Speech 时明确失败，留给 Android 原生接头或文字输入。 */
export async function recognizeSpeech() {
    if (window.dotAndroid)
        return (await window.dotAndroid.recognize()).text;
    const browser = window;
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor)
        throw new Error('此设备尚未提供可用的语音转写，请使用文字输入');
    return new Promise((resolve, reject) => {
        const recognition = new Constructor();
        let settled = false;
        recognition.lang = 'zh-CN';
        recognition.interimResults = false;
        const timeout = setTimeout(() => { recognition.stop(); if (!settled) {
            settled = true;
            reject(new Error('语音转写超时，文字草稿未改变'));
        } }, 45000);
        recognition.onresult = event => { if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve(Array.from(event.results).map(result => result[0]?.transcript ?? '').join(''));
        } };
        recognition.onerror = event => { if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`语音输入失败：${event.error}`));
        } };
        recognition.onend = () => { clearTimeout(timeout); if (!settled) {
            settled = true;
            reject(new Error('未识别到文字，草稿未改变'));
        } };
        recognition.start();
    });
}
/* 用户点击开启才申请权限，不能首次打开就弹系统门。 */
export async function requestNotifications() {
    if (window.dotAndroid) {
        if (!(await window.dotAndroid.requestNotifications()).granted)
            throw new Error('系统通知权限未授予');
        return;
    }
    if (!('Notification' in window))
        throw new Error('此浏览器不支持系统通知，星邮匣仍可查看');
    if (await Notification.requestPermission() !== 'granted')
        throw new Error('系统通知权限未授予');
}
/* 返回值只表示本轮本地系统通知已创建，不冒充远端或锁屏送达。 */
export async function showNotification(event, open) {
    if (window.dotAndroid)
        return (await window.dotAndroid.notify(event)).delivered;
    if (!('Notification' in window) || Notification.permission !== 'granted')
        return false;
    const notification = new Notification(event.title, { body: event.body, tag: `dot-${event.id}` });
    notification.onclick = () => { window.focus(); open(); notification.close(); };
    return true;
}
