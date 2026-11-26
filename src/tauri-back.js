// TT's native bridge does not traverse shadow roots to find open panels.
export function installTauriBack(consume, win = window) {
    const original = win.__TAURITAVERN_HANDLE_BACK__;
    if (!win.__TAURITAVERN_HOST__ || typeof original !== 'function') return null;

    let active = true;
    function handleBack() {
        if (active && !win.document.querySelector('dialog[open]:not([closing])') && consume()) return true;
        return original.call(this);
    }
    win.__TAURITAVERN_HANDLE_BACK__ = handleBack;
    return () => {
        active = false;
        if (win.__TAURITAVERN_HANDLE_BACK__ === handleBack) win.__TAURITAVERN_HANDLE_BACK__ = original;
    };
}
