import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { defaultValues, device } from "../src/physics/index";
import { readEnvironment } from "../src/physics/environment";
import { runDevice } from "../src/physics/run";
it("p", () => {
  const lines: string[] = [];
  for (const id of ["transformer", "cmchoke", "inductor"]) {
    const d = device(id);
    const v = defaultValues(d);
    const r = d.simulate(v);
    lines.push(`\n=== ${id} ===`);
    for (const m of r.metrics.filter((m) => m.headline)) lines.push(`  ${m.label} = ${m.text} [${m.tone}]`);
    for (const w of r.warnings) lines.push(`  ${w.level.toUpperCase()}: ${w.text}`);
    if (r.runtime) {
      const run = runDevice(r.runtime, readEnvironment(v), { duration: 1800 });
      lines.push(`  RUN verdict=${run.verdict} peak=${run.peakCurrent.toFixed(3)}A steady=${run.steadyCurrent.toFixed(3)}A rise=${run.currentRise}`);
      for (const e of run.events) lines.push(`    ${e.level} @${e.t.toFixed(1)}s ${e.title}: ${e.text.slice(0, 90)}`);
      lines.push(`    final: ${JSON.stringify(Object.fromEntries(Object.entries(run.finalTemperatures).map(([k, t]) => [k, Math.round(t as number)])))}`);
    } else lines.push("  RUN: none");
  }
  writeFileSync("/tmp/p6.txt", lines.join("\n"));
});
