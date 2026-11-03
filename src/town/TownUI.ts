export function installTownStyles(): void {
  if (document.getElementById('town-styles')) return
  const style = document.createElement('style'); style.id = 'town-styles'
  style.textContent = `
    .town-panel { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(680px,calc(100vw - 48px)); box-sizing:border-box; max-height:85vh; overflow:auto; z-index:1000; padding:26px 30px; color:#f1e4cb; background:linear-gradient(125deg,#30291f,#181b1b); border:1px solid #95784f; border-top:4px solid #ba995e; border-radius:8px; box-shadow:0 24px 100px #000c; font:15px/1.65 system-ui }
    .town-mission-tabs { display:flex; gap:10px; margin:12px 0 18px; position:sticky; top:-26px; background:#25231f; padding:10px 0; z-index:1 }
    .town-mission-tabs .town-button { flex:1; margin:0 }
    .town-mission-tabs [aria-pressed="true"], .town-mission-tabs [aria-selected="true"] { background:#765c35; border-color:#f0cc86; color:#fff0c9 }
    .town-shop-tabs { display:flex; gap:10px; margin-top:14px }
    .town-shop-tabs .town-button { flex:1; margin:0 }
    .town-shop-tabs .town-button:disabled { opacity:1; background:#765c35; border-color:#f0cc86; color:#fff0c9 }
    .town-shop-categories[hidden] { display:none }
    .town-shop-categories .town-button { padding:10px 6px; font-size:13px }
    .town-shop-categories [aria-pressed="true"] { background:#765c35; border-color:#f0cc86; color:#fff0c9 }
    .town-purchase-products > h3 { display:flex; align-items:center; gap:12px; letter-spacing:.14em; font-size:14px }
    .town-purchase-products > h3::before,.town-purchase-products > h3::after { content:''; flex:1; height:1px; background:#95784f88 }
    .town-sale { grid-column:1 / -1; margin-top:14px; padding:12px; background:#0b101344; border:1px solid #95784f; border-radius:5px }
    .town-sale label { display:block; font-size:13px; color:#c4b69e }
    .town-sale-select { display:block; width:100%; max-width:100%; margin-right:0 }
    .town-panel h2 { margin:5px 0 16px; font:700 27px/1.3 Georgia,serif; color:#ffe5af }
    .town-panel p { margin:12px 0; white-space:pre-line }
    .town-eyebrow { font:11px/1.5 Georgia,serif; letter-spacing:.2em; color:#bb9e71 }
    .town-button { color:#ecd8ad; background:#453723; border:1px solid #947448; border-radius:4px; padding:9px 15px; margin:8px 9px 0 0; font:600 14px system-ui; cursor:pointer }
    .town-button:hover,.town-button:focus-visible { background:#665033; border-color:#eac683; outline:2px solid #be9a58; outline-offset:2px }
    .town-button:disabled { opacity:.5; cursor:default }
    .town-products > h3 { grid-column:1 / -1; margin:12px 0 0; color:#ffe5af; font-size:17px }
    .town-summary { background:#0b101344; border-left:3px solid #b3945e; padding:10px 14px; color:#c4b69e; font-size:13px }
    .town-products { display:grid; grid-template-columns:repeat(auto-fit,minmax(235px,1fr)); gap:10px; margin-top:16px }
    .town-product { border:1px solid #77654866; border-radius:5px; padding:12px; background:#0002; display:flex; flex-direction:column; align-items:flex-start }
    .town-product strong { font-size:14px; color:#ead7b2 } .town-product small { color:#b7a78c; margin-top:4px }
    .town-purchase-products { grid-template-columns:repeat(auto-fit,minmax(min(235px,100%),1fr)) }
    .town-purchase-quantity { margin-top:8px; max-width:100%; font-size:13px; color:#c4b69e }
    .town-purchase-select { box-sizing:border-box; max-width:100%; padding:5px 10px; color:#ead8b8; background:#332d24; border:1px solid #92754e; border-radius:4px; font:inherit }
    .town-purchase-select:focus-visible { outline:2px solid #be9a58; outline-offset:2px }
    .town-purchase-select:disabled { opacity:.5; cursor:default }
    .town-ambient { position:fixed; transform:translate(-50%,-100%); max-width:280px; z-index:95; background:#201d18e8; color:#ffe6b5; padding:8px 12px; border:1px solid #967950; border-radius:5px; font:14px/1.4 system-ui; pointer-events:none }
    #career-duel-hud { position:fixed; left:50%; top:12%; transform:translateX(-50%); z-index:94; pointer-events:none; text-align:center; color:#ffe5af; text-shadow:0 3px 8px #000,0 0 20px #000; font-family:system-ui }
    .duel-countdown-label { font-size:18px; font-weight:600; letter-spacing:.08em }
    .duel-countdown-value { font-size:clamp(48px,7vw,80px); font-weight:800; line-height:1.15; font-variant-numeric:tabular-nums }
    #career-entry { position:fixed; inset:0; overflow:auto; z-index:1000; padding:clamp(20px,5vh,60px) clamp(20px,6vw,100px); box-sizing:border-box; background:radial-gradient(ellipse at 30% 0,#473a28,#171b1f 65%); color:#ead8b8; font:16px/1.6 system-ui }
    #career-entry h1 { margin:5px 0; font:700 34px Georgia,serif }
  `
  document.head.append(style)
}
