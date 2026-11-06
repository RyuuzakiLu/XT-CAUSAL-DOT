/** Build-collected upstream CSS; attached only while our plugin is active. */
const sheets = new Map();
export function registerGenuiStyle(id, css) { sheets.set(id, css); }
export function attachGenuiStyles() {
    const tags = [];
    for (const [id, css] of sheets) {
        const tag = document.createElement('style');
        tag.dataset.dotGenuiStyle = id;
        tag.textContent = css;
        document.head.appendChild(tag);
        tags.push(tag);
    }
    return () => tags.forEach(tag => tag.remove());
}
