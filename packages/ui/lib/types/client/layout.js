/* 纯布局面保留官方调用契约，视图写入仅经声明 actions。 */
export class DotLayout {
    move;
    menu;
    nativePanel;
    rightbar;
    selection = { activePanelId: 'dot.study' };
    listeners = new Set();
    navigation = new AbortController();
    panelInfo = {
        getSnapshot: () => this.selection,
        subscribe: listener => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; },
    };
    constructor(move, menu, nativePanel, rightbar) {
        this.move = move;
        this.menu = menu;
        this.nativePanel = nativePanel;
        this.rightbar = rightbar;
    }
    selectPanel(panelId) {
        this.navigation.abort();
        this.selection = { activePanelId: panelId };
        const space = panelId === null || panelId === 'conversation' ? 'conversation' : String(panelId).replace(/^dot\./, '');
        /* 2026-10-27 能力空间整页删除：宿主或旧链接仍点名 dot.capabilities 时送回书房，不落进原生面板。 */
        if (space === 'capabilities')
            this.move('study');
        else if (['study', 'conversation', 'work', 'memory', 'postbox'].includes(space))
            this.move(space);
        else
            this.nativePanel(String(panelId));
        for (const listener of this.listeners)
            listener();
    }
    beginNavigation() { this.navigation.abort(); this.navigation = new AbortController(); return this.navigation.signal; }
    toggleSidebar() { this.menu(); }
    openRightbar(_track, _fullscreen) { this.rightbar(true); }
    closeRightbar() { this.rightbar(false); }
    dispose() { this.navigation.abort(); this.listeners.clear(); }
}
