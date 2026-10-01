// Render an HTML file to PDF with Chromium via playwright-core. Usage: node render.js in.html out.pdf
const { chromium } = require('/tmp/claude-0/-home-user-no-lag-here/1c4eed2f-eb55-532f-b143-a5d948e32181/scratchpad/pdfgen/node_modules/playwright-core');
const path = require('path');
(async () => {
  const [,, inHtml, outPdf] = process.argv;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--disable-gpu'] });
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(inHtml), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts ? document.fonts.ready : null);
  await page.pdf({ path: outPdf, format: 'A4', printBackground: true, preferCSSPageSize: false, outline: true,
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-family:Liberation Sans,DejaVu Sans,sans-serif;font-size:7.5px;color:#7a828c;width:100%;padding:0 22mm;display:flex;justify-content:space-between;"><span>JULIUS CAESAR — ACT 1 MASTER COURSE</span><span>ICSE STUDY BOOK</span></div>',
    footerTemplate: '<div style="font-family:Liberation Sans,DejaVu Sans,sans-serif;font-size:8px;color:#5b6470;width:100%;text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: '16mm', bottom: '16mm', left: '0mm', right: '0mm' } });
  await browser.close();
  console.log('PDF written:', outPdf);
})().catch(e => { console.error(e); process.exit(1); });
