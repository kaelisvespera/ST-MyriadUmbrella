const redBirdBack = [
    ['.rbt-float-asheet', '.rbt-asheet-cancel'],
    ['#rbt-shell-root .rbt-imp', '.rbt-titlebar-x'],
    ['#rbt-shell-root .rbt-sheet', '.rbt-titlebar-x'],
    ['#rbt-shell-root .rbt-left-scrim', null],
    ['#rbt-root .rbt-dock', '.rbt-titlebar-x'],
];

function closeRedBirdPanel(win) {
    for (const [selector, closeSelector] of redBirdBack) {
        const panel = win.document.querySelector(selector);
        if (!panel?.getClientRects().length || win.getComputedStyle(panel).visibility !== 'visible') continue;
        const close = closeSelector ? panel.querySelector(closeSelector) : panel;
        if (close && !close.disabled) close.click();
        return true;
    }
    return false;
}

// TT's native bridge does not traverse shadow roots to find open panels.
export function installTauriBack(consume, win = window) {
    const original = win.__TAURITAVERN_HANDLE_BACK__;
    if (!win.__TAURITAVERN_HOST__ || typeof original !== 'function') return null;

    let active = true;
    function handleBack() {
        if (active && !win.document.querySelector('dialog[open]:not([closing])')
            && (consume() || closeRedBirdPanel(win))) return true;
        return original.call(this);
    }
    win.__TAURITAVERN_HANDLE_BACK__ = handleBack;
    return () => {
        active = false;
        if (win.__TAURITAVERN_HANDLE_BACK__ === handleBack) win.__TAURITAVERN_HANDLE_BACK__ = original;
    };
}
