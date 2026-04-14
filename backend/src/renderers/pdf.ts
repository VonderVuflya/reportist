import puppeteer, { type Browser } from 'puppeteer-core';

const EXECUTABLE_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        executablePath: EXECUTABLE_PATH,
        args: LAUNCH_ARGS,
        headless: true,
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

type PdfOptions = {
  format?: 'A4' | 'Letter';
  landscape?: boolean;
};

export async function renderPdf(
  bodyHtml: string,
  options: PdfOptions = {},
): Promise<Buffer> {
  const doc = `<!doctype html><html><head><meta charset="utf-8"></head><body>${bodyHtml}</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(doc, { waitUntil: 'networkidle0', timeout: 15000 });
    const pdf = await page.pdf({
      format: options.format ?? 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}
