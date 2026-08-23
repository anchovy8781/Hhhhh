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
const DEVICES = [
  "inductor",
  "transformer",
  "cmchoke",
  "solenoid",
  "motor",
  "bldc",
  "busbar",
];

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
  for (const group of ["재료", "치수", "권선", "운전", "환경"]) {
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

  // The searchable picker must open, filter and apply a selection.
  await page.evaluate(() => window.__lab.setDevice("inductor"));
  await wait(400);
  await page.evaluate(() => window.__lab.openPickerFor("coreMaterial"));
  await wait(300);
  if (await page.locator("#picker").isHidden()) {
    failures.push("재료 검색창이 열리지 않았습니다");
  } else {
    const before = await page.locator(".picker-item").count();
    await page.fill("#picker-search", "나노결정");
    await wait(300);
    const after = await page.locator(".picker-item").count();
    if (!(after > 0 && after < before)) {
      failures.push(`검색이 목록을 좁히지 못했습니다 (${before} -> ${after})`);
    }
    await page.screenshot({ path: `${OUT}/picker.png` });
    await page.locator(".picker-item").first().click();
    await wait(400);
    const picked = await page.evaluate(() => window.__lab.result().metrics.length);
    if (!(picked > 0)) failures.push("재료를 고른 뒤 계산이 되지 않았습니다");
    if (await page.locator("#picker").isVisible()) {
      failures.push("재료를 고른 뒤에도 검색창이 닫히지 않았습니다");
    }
  }

  // Energising must produce a verdict, a timeline and traces.
  for (const id of DEVICES) {
    const run = await page.evaluate((deviceId) => {
      window.__lab.setDevice(deviceId);
      return window.__lab.energise();
    }, id);
    if (!run) {
      failures.push(`${id}: 전원 인가 시뮬레이션이 없습니다`);
      continue;
    }
    if (!(run.thermal.length > 10 && run.electrical.length > 10)) {
      failures.push(`${id}: 전원 인가 결과에 파형이 없습니다`);
    }
    if (!["ok", "warn", "fail"].includes(run.verdict)) {
      failures.push(`${id}: 판정이 이상합니다 (${run.verdict})`);
    }
    for (const event of run.events) {
      if (!event.advice) failures.push(`${id}: 고장 안내에 조치 방법이 없습니다`);
    }
  }

  // A deliberately overdriven design must name the part that fails.
  await page.evaluate(() => {
    window.__lab.setDevice("solenoid");
    window.__lab.setValue("voltage", 45);
    window.__lab.setValue("awg", 28);
    window.__lab.setValue("turns", 1800);
  });
  await wait(400);
  await page.locator("#energise").click();
  await wait(700);
  const reportText = await page.locator("#run-report").innerText();
  if (!/고장|한계/.test(reportText)) {
    failures.push(`과부하 설계인데 고장을 알리지 않았습니다: ${reportText.slice(0, 80)}`);
  }
  const verdictState = await page.locator("#energise").getAttribute("data-state");
  if (verdictState !== "fail") {
    failures.push(`과부하 설계의 판정이 fail이 아닙니다 (${verdictState})`);
  }
  // The timelapse must actually play and set the thing on fire.
  await wait(2500);
  const effects = await page.evaluate(() => window.__lab.effectCount());
  if (!(effects > 0)) {
    failures.push("고장이 났는데 연기·불꽃 효과가 하나도 없습니다");
  }
  const progress = await page.evaluate(() =>
    Number(document.getElementById("tl-fill").style.width.replace("%", "")),
  );
  if (!(progress > 5)) failures.push(`타임랩스가 진행되지 않았습니다 (${progress}%)`);
  await page.screenshot({ path: `${OUT}/run-failure.png` });
  await wait(6000);
  await page.screenshot({ path: `${OUT}/run-fire.png` });

  // A 24-hour run must be selectable and must change the reported span.
  await page.selectOption("#run-duration", "86400");
  await page.locator("#energise").click();
  await wait(900);
  const dayText = await page.locator("#run-report").innerText();
  if (!/시간/.test(dayText)) {
    failures.push(`24시간 운전 결과에 시간 단위가 없습니다: ${dayText.slice(0, 60)}`);
  }

  // Beginner mode must hide the advanced settings and keep the design working.
  await page.evaluate(() => window.__lab.setDevice("transformer"));
  await wait(500);
  await page.locator(".group-tab", { hasText: "치수" }).first().click();
  await wait(200);
  const expertCount = await page.evaluate(() => {
    window.__lab.setBeginner(false);
    return window.__lab.controlCount();
  });
  const beginnerCount = await page.evaluate(() => {
    window.__lab.setBeginner(true);
    return window.__lab.controlCount();
  });
  if (!(beginnerCount < expertCount)) {
    failures.push(`초보자 모드가 설정을 줄이지 않았습니다 (${expertCount} -> ${beginnerCount})`);
  }

  // Recommendations must exist, apply, and leave the design valid.
  await page.evaluate(() => {
    window.__lab.setDevice("transformer");
    window.__lab.setValue("vin", 380);
    window.__lab.setValue("voutTarget", 48);
  });
  await wait(500);
  const advice = await page.evaluate(() => window.__lab.advice());
  if (!(advice.length > 0)) failures.push("전압을 바꿨는데 추천값이 나오지 않았습니다");
  for (const item of advice) {
    if (!item.reason || !item.label) failures.push("추천값에 근거가 없습니다");
  }
  if (await page.locator("#advice").isHidden()) {
    failures.push("추천 카드가 표시되지 않았습니다");
  }
  await page.evaluate(() => {
    document.querySelector(".panel").scrollTop = 0;
  });
  await wait(200);
  await page.screenshot({ path: `${OUT}/advice.png` });
  await page.locator(".advice-apply").click();
  await wait(600);
  const afterApply = await page.evaluate(() => {
    const r = window.__lab.result();
    return {
      errors: r.warnings.filter((w) => w.level === "error").length,
      vout: r.metrics.find((m) => m.key === "vout").raw,
    };
  });
  if (afterApply.errors > 0) {
    failures.push(`추천값을 적용했는데 오류가 ${afterApply.errors}건 남았습니다`);
  }
  if (Math.abs(afterApply.vout - 48) / 48 > 0.15) {
    failures.push(`추천값 적용 후 출력이 목표에서 벗어납니다 (${afterApply.vout})`);
  }

  // Every inductor core shape must build and render.
  for (const shape of ["toroid", "ei", "etd", "pot", "rod"]) {
    await page.evaluate((value) => {
      window.__lab.setDevice("inductor");
      window.__lab.setValue("shape", value);
    }, shape);
    await wait(500);
    const drawn = await canvasIsDrawn();
    if (!drawn.ok) failures.push(`${shape} 코어가 그려지지 않았습니다 (${drawn.reason})`);
    await page.screenshot({ path: `${OUT}/shape-${shape}.png` });
  }

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
