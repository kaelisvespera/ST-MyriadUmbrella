import { albumCss } from './album-style.js';

export const homeCss = `
    :host{position:fixed;left:0;top:0;width:100dvw;height:100dvh;z-index:4000;pointer-events:none;--tt-surface:var(--st-home-surface,#faf9f6);--tt-ink:var(--st-home-ink,#282927);--tt-border:color-mix(in srgb,var(--tt-ink) 15%,var(--tt-surface));--tt-muted:color-mix(in srgb,var(--tt-ink) 58%,var(--tt-surface));font:13px/1.5 var(--mainFontFamily,system-ui,sans-serif);color:var(--tt-ink);letter-spacing:normal;text-shadow:none;isolation:isolate}
    .home{position:absolute;inset:auto;left:auto;right:20px;top:70px;transform:none;pointer-events:auto;width:360px;height:600px;max-width:calc(100dvw - 20px);max-height:calc(100dvh - 20px);margin:0;padding:0;border:1px solid var(--tt-border);border-radius:14px;overflow:hidden;background:var(--tt-surface);color:var(--tt-ink)}
    .shell{height:100%;display:flex;flex-direction:column;background:var(--tt-surface)}
    .home-header{display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;padding:12px 14px 8px;gap:8px}
    .home-search{flex:1;min-width:0}.home-header>.icon-button{margin-left:auto}.home-search .search{margin:0}.home-search .reader-back{min-height:36px}
    .icon-button{display:inline-grid;place-items:center;flex:0 0 auto;width:32px;height:32px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--tt-ink)}
    .icon-button i{font-size:18px;pointer-events:none}
    .home-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
    .home-view{min-width:0;min-height:100%;padding:6px 14px 16px}
    .home-view:has(>.reader:not([hidden])){height:100%}
    .home-tabs{display:flex;flex:0 0 auto;padding:4px 12px 6px;border-top:1px solid var(--tt-border);background:var(--tt-surface)}
    .home-tab{position:relative;display:grid;justify-items:center;gap:2px;flex:1;min-height:42px;padding:3px 8px 6px;border:0;border-radius:0;background:transparent;color:var(--tt-muted);font-size:12px}
    .home-tab i{font-size:17px}.home-tab[aria-selected=true]{color:var(--tt-ink);font-weight:650}
    .home-tab:hover{background:transparent}
    .home-tab[aria-selected=true]::after{content:'';position:absolute;bottom:0;width:28px;height:2px;background:var(--tt-ink);border-radius:2px}
    .search{display:flex;align-items:center;gap:8px;margin:0 0 14px;padding:0 10px;min-height:34px;border-radius:5px;background:color-mix(in srgb,var(--tt-ink) 6%,var(--tt-surface));color:var(--tt-muted)}
    .search input{width:100%;min-width:0;padding:6px 0;border:0;outline:none;background:transparent;color:var(--tt-ink);font-size:16px;line-height:1.4}
    .search:focus-within{outline:1px solid var(--tt-border)}.search input:focus-visible{outline:none}.search input::placeholder{color:var(--tt-muted)}
    .library-message{padding:40px 6px;color:var(--tt-muted);font-size:13px;text-align:center}
    .reader{display:flex;flex-direction:column;gap:10px;min-height:100%;height:100%}
    .reader-toolbar{display:flex;align-items:center;gap:8px}.reader-back{display:flex;align-items:center;gap:7px;padding:4px 0;border:0;background:transparent;font-size:13px}
    .reader-heading{display:flex;align-items:center;gap:12px}.reader-cover{display:block;width:56px;max-height:78px;object-fit:contain;border-radius:5px}.reader-heading h2{margin:0;font-size:16px;font-weight:550;overflow-wrap:anywhere}
    .greeting-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--tt-border);padding-top:12px;font-size:12px;color:var(--tt-muted)}
    .greeting-controls .row{gap:3px}.greeting-controls .icon-button{width:32px;height:32px}.greeting-controls i{font-size:14px}
    .greeting-frame{display:block;flex:1;width:100%;min-height:240px;border:0;background:var(--tt-surface);color-scheme:normal}

    .toolbox{--tool-fill:color-mix(in srgb,var(--tt-ink) 5%,var(--tt-surface));--tool-line:color-mix(in srgb,var(--tt-ink) 16%,var(--tt-surface));--tool-soft:color-mix(in srgb,var(--tt-ink) 75%,var(--tt-surface));padding-top:4px;font-size:14px}
    .toolbox:not([hidden]){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));align-content:start;align-items:start;gap:16px}
    .toolbox .tool-group{min-width:0}
    .toolbox h3{display:flex;align-items:center;gap:8px;margin:0 2px 5px;font-size:12px;font-weight:650;line-height:1.5;color:var(--tool-soft)}
    .toolbox h3 i{width:16px;text-align:center}
    .toolbox .tool-sheet{overflow:hidden;border:1px solid var(--tool-line);border-radius:10px;background:var(--tool-fill)}
    .toolbox .tool-sheet:not(.tool-qr)>:not([hidden])~:not([hidden]){border-top:1px solid var(--tool-line)}
    .toolbox .tool-control{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;margin:0;padding:8px 11px;line-height:1.35;cursor:pointer}
    .toolbox .tool-control>span{min-width:0;overflow-wrap:anywhere}
    .toolbox small{display:block;margin-top:2px;font-size:11px;color:var(--tool-soft)}
    .toolbox .tool-control:has(input:disabled){cursor:wait}
    .toolbox input[type=checkbox]{appearance:none;display:grid;align-items:center;flex:none;width:32px;height:18px;margin:0;padding:2px;border:1px solid color-mix(in srgb,var(--tt-ink) 50%,var(--tt-surface));border-radius:12px;background:var(--tt-surface);cursor:inherit}
    .toolbox input[type=checkbox]::before{content:'';width:12px;height:12px;border-radius:50%;background:var(--tool-soft)}
    .toolbox input[type=checkbox]:checked{border-color:var(--tt-ink);background:var(--tt-ink)}
    .toolbox input[type=checkbox]:checked::before{justify-self:end;background:var(--tt-surface)}
    .toolbox input[type=checkbox]:focus-visible{outline:2px solid var(--tt-ink);outline-offset:2px}
    .toolbox input[type=checkbox]:disabled{opacity:.55}
    .toolbox .tool-qr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
    .toolbox .tool-qr>label:nth-child(even){border-inline-start:1px solid var(--tool-line)}
    .toolbox .tool-qr>label:nth-child(n+3){border-top:1px solid var(--tool-line)}
    .toolbox .tool-qr>label:last-child:nth-child(odd){grid-column:1/-1}
    .toolbox .tool-actions,.toolbox .tool-notice{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;padding:7px 10px}
    .toolbox .tool-notice label{flex:1 1 auto;margin:0;min-height:0}
    .toolbox :is(button,select){min-height:36px;max-width:100%;padding:4px 8px;border:1px solid var(--tool-line);border-radius:6px;background:var(--tt-surface);color:var(--tt-ink);font-size:12px}
    .toolbox :is(button,select):focus-visible{outline-color:var(--tt-ink);outline-offset:1px}
    .toolbox button:hover{background:var(--tool-fill)}
    .tools-heading{margin:0;font-size:17px;font-weight:680;line-height:1.3}
    :host(.tools-active){z-index:2147483646}
    @media(forced-colors:active){.toolbox input[type=checkbox]{appearance:auto}.toolbox input[type=checkbox]::before{display:none}}
    @media(min-width:641px){:host(:not(.tt-mobile)) .home-header{cursor:grab;touch-action:none;user-select:none}.home.is-dragging .home-header{cursor:grabbing}}
    @media(max-width:640px){.home{top:max(20px,env(safe-area-inset-top,0px));left:50%;right:auto;transform:translateX(-50%);width:max(0px,calc(var(--tt-window-width,100dvw) - 20px));max-width:none;height:max(0px,calc(var(--tt-window-height,100dvh) - max(40px,env(safe-area-inset-top,0px)) - max(40px,env(safe-area-inset-bottom,0px))));max-height:none}}
    :host(.tt-mobile) .home{top:20px;left:50%;right:auto;transform:translateX(-50%);width:max(0px,calc(var(--tt-window-width,100dvw) - 20px));max-width:none;height:max(0px,calc(var(--tt-window-height,100dvh) - 80px));max-height:none}
` + albumCss;
