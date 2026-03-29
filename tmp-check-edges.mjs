import { chromium } from './node_modules/playwright/index.mjs';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1600,height:1000}});
await page.goto('http://127.0.0.1:5180/LTHS_MD/', {waitUntil:'networkidle'});
await page.waitForTimeout(1400);
const data = await page.evaluate(() => {
  const mains = [...document.querySelectorAll('.edge-path--main')].slice(0, 12).map((el, i) => ({
    i,
    strokeAttr: el.getAttribute('stroke'),
    strokeWidth: el.getAttribute('stroke-width'),
    markerEnd: el.getAttribute('marker-end'),
    d: el.getAttribute('d')?.slice(0, 140)
  }));
  const markers = [...document.querySelectorAll('.edge-layer defs marker')].slice(0, 10).map((el) => ({
    id: el.getAttribute('id'),
    fill: el.querySelector('path')?.getAttribute('fill'),
    stroke: el.querySelector('path')?.getAttribute('stroke'),
  }));
  return { mains, markers };
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
