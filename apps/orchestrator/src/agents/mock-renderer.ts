import { chromium, type Browser } from "playwright";

export type RenderInput = { html: string; tokensCss: string };
export type RenderOutput = { desktopPng: Buffer; mobilePng: Buffer };

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

function compose(html: string, tokensCss: string): string {
  const head = `<style>${tokensCss}\n*{animation:none!important;transition:none!important;}</style>`;
  if (html.includes("<head>")) return html.replace("<head>", `<head>${head}`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

export class MockRenderer {
  private browser: Browser | null = null;

  private async ensure(): Promise<Browser> {
    if (!this.browser) this.browser = await chromium.launch({ args: ["--no-sandbox"] });
    return this.browser;
  }

  async render(input: RenderInput): Promise<RenderOutput> {
    const browser = await this.ensure();
    const context = await browser.newContext();
    try {
      const content = compose(input.html, input.tokensCss);
      const shoot = async (vp: { width: number; height: number }): Promise<Buffer> => {
        const page = await context.newPage();
        await page.route("**/*", (r) => {
          const t = r.request().resourceType();
          if (t === "document") return r.continue();
          return r.abort(); // offline: block all external sub-resources
        });
        await page.setViewportSize(vp);
        await page.setContent(content, { waitUntil: "load" });
        const png = (await page.screenshot({ fullPage: true, type: "png" })) as Buffer;
        await page.close();
        return png;
      };
      const desktopPng = await shoot(DESKTOP);
      const mobilePng = await shoot(MOBILE);
      return { desktopPng, mobilePng };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
