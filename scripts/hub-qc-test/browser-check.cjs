const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.HUB_PLAYWRIGHT_DIR || "playwright");
const out =
  process.env.HUB_QA_OUTPUT ||
  path.resolve(__dirname, "../../../hub-qc-browser-output");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  let checks = 0;
  try {
    const page = await browser.newPage({
      viewport: { width: 1366, height: 768 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "127.0.0.1" || url.protocol === "data:"
        ? route.continue()
        : route.abort();
    });
    await page.goto("http://127.0.0.1:3315");
    await page
      .getByRole("heading", { name: "Tự kiểm tra", exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(out, "desktop-work.png"),
      fullPage: true,
    });
    console.log("INITIAL", await page.locator("body").innerText());
    console.log("ERRORS", errors);
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [1280, 800],
      [1024, 768],
      [390, 844],
      [430, 932],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator("aside")
        .getByRole("button", { name: "To-do", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "To-do & phối hợp", exact: true })
        .waitFor();
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      assert.equal(overflow, false, `page overflow ${width}`);
      checks++;
      await page.screenshot({
        path: path.join(out, `${width}-issues.png`),
        fullPage: true,
      });
      await page.locator("aside")
        .getByRole("button", { name: "QC độc lập", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "QC độc lập", exact: true })
        .last()
        .waitFor();
      await page.waitForTimeout(300);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      checks++;
      await page.screenshot({
        path: path.join(out, `${width}-qc.png`),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    checks++;
    console.log(`PASS ${checks} browser layout checks`, out);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
