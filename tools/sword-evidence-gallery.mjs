import fs from 'node:fs'
import { chromium } from 'playwright'
const dir = process.argv[2] ?? 'output/playwright/sword-restored'
const files = fs.readdirSync(dir).filter(f => /-(fingers|full|top)\.png$/.test(f)).sort()
const css = 'body{margin:0;background:#ddd;font:13px system-ui;display:grid;grid-template-columns:repeat(4,280px)}figure{margin:4px;background:white}img{width:272px;display:block}figcaption{padding:5px}'
fs.writeFileSync(`${dir}/gallery.html`, `<style>${css}</style>` + files.map(f => `<figure><img src="${f}"><figcaption>${f}</figcaption></figure>`).join(''))
const browser = await chromium.launch({ headless: true })
try {
 const page = await browser.newPage({ viewport:{width:1120,height:800} })
 await page.setContent(`<style>${css}</style>` + files.map(f=>`<figure><img src="data:image/png;base64,${fs.readFileSync(`${dir}/${f}`).toString('base64')}"><figcaption>${f}</figcaption></figure>`).join(''))
 await page.screenshot({path:`${dir}/gallery.png`,fullPage:true})
} finally {await browser.close()}
