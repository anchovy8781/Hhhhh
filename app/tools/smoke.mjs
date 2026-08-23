/**
 * Headless smoke test: build, serve, drive the real app in Chromium.
 *
 * Unit tests cover the physics; this covers the half that only fails in a
 * browser -- WebGL actually drawing, the controls wiring up, every device
 * switching without throwing.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 4173;
const OUT = "screenshots";
const DEVICES = ["inductor", "transformer", "solenoid", "motor"];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(250);
  }
  throw new Error(`서버가 ${timeoutMs}ms 안에 뜨지 않았습니다: ${url}`);
}

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
  detached: false,
});

const failures = [];
let browser;

try {
  await waitForServer(`http://localhost:${PORT}/`);
  mkdirSync(OUT, { recursive: true });

  // Prefer the browser this container ships with; on CI let Playwright resolve
  // the one it just installed.
  const preinstalled = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const useLocal =
    process.env.PLAYWRIGHT_BROWSER_PATH !== "default" && existsSync(preinstalled);
  browser = await chromium.launch({
    ...(useLocal ? { executablePath: preinstalled } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 412, height: 892 },
    deviceScaleFactor: 2,
  });

  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__lab));
  await wait(800);

  // The renderer must actually have produced pixels, not just a black canvas.
  const canvasIsDrawn = async () => {
    const sample = await page.evaluate(() => window.__lab.sample());
    return {
      ok: sample.colours > 4 && sample.width > 0,
      reason: `${sample.colours} distinct colours in ${sample.width}x${sample.height}`,
    };
  };

  for (const id of DEVICES) {
    await page.evaluate((deviceId) => window.__lab.setDevice(deviceId), id);
    await wait(700);

    const headline = await page.locator("#headline .stat").count();
    if (headline < 2) failures.push(`${id}: 헤드라인 지표가 ${headline}개뿐입니다`);

    const controls = await page.locator(".control").count();
    if (controls < 1) failures.push(`${id}: 컨트롤이 렌더링되지 않았습니다`);

    const drawn = await canvasIsDrawn();
    if (!drawn.ok) failures.push(`${id}: 3D가 그려지지 않았습니다 (${drawn.reason})`);

    const meshes = await page.evaluate(() => {
      let count = 0;
      window.__lab.viewer.stage.traverse((child) => {
        if (child.isMesh) count++;
      });
      return count;
    });
    if (meshes < 2) failures.push(`${id}: 스테이지 메시가 ${meshes}개뿐입니다`);

    await page.screenshot({ path: `${OUT}/${id}.png` });
  }

  // Exercise every parameter group tab and a slider drag on the first device.
  await page.evaluate(() => window.__lab.setDevice("inductor"));
  await wait(400);
  for (const group of ["재료", "치수", "권선", "운전"]) {
    const tab = page.locator(".group-tab", { hasText: group });
    if ((await tab.count()) > 0) {
      await tab.first().click();
      await wait(150);
      if ((await page.locator(".control").count()) < 1) {
        failures.push(`${group} 탭에 컨트롤이 없습니다`);
      }
    }
  }

  // A parameter change must move the numbers.
  const before = await page.evaluate(
    () => window.__lab.result().metrics.find((m) => m.key === "L0").raw,
  );
  await page.evaluate(() => window.__lab.setValue("turns", 120));
  await wait(400);
  const after = await page.evaluate(
    () => window.__lab.result().metrics.find((m) => m.key === "L0").raw,
  );
  if (!(after > before * 2)) {
    failures.push(`턴수를 올렸는데 인덕턴스가 변하지 않았습니다 (${before} -> ${after})`);
  }
  await page.screenshot({ path: `${OUT}/inductor-120t.png` });

  // Presets must load and stay inside their own limits.
  await page.locator("#presets").evaluateAll(() => {});
  const presetErrors = await page.evaluate(() => {
    const problems = [];
    for (const button of document.querySelectorAll(".preset")) {
      button.click();
      const result = window.__lab.result();
      const errors = result.warnings.filter((w) => w.level === "error");
      if (errors.length) problems.push(`${button.textContent}: ${errors[0].text}`);
    }
    return problems;
  });
  failures.push(...presetErrors.map((p) => `프리셋이 한계를 넘습니다 -- ${p}`));

  // Desktop layout.
  await page.setViewportSize({ width: 1280, height: 800 });
  await wait(600);
  await page.evaluate(() => window.__lab.setDevice("motor"));
  await wait(600);
  await page.screenshot({ path: `${OUT}/desktop.png` });

  if (consoleErrors.length) {
    failures.push(...consoleErrors.slice(0, 5).map((e) => `콘솔 오류: ${e}`));
  }
} catch (error) {
  failures.push(`실행 실패: ${error.message}`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

writeFileSync(
  `${OUT}/report.txt`,
  failures.length ? failures.join("\n") : "모든 검사 통과",
);

if (failures.length) {
  console.error(`실패 ${failures.length}건:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("스모크 테스트 통과");
