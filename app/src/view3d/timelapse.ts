/**
 * Timelapse playback of a run.
 *
 * The run already knows every temperature at every instant and every fault
 * with its timestamp. This walks that timeline in about twenty seconds of wall
 * clock, heating the metal, spinning the rotor, pulling the plunger in, and
 * setting the thing on fire at exactly the moment the simulation says it went.
 */

import * as THREE from "three";
import type { PartSpec, RunEvent, RunResult } from "../physics/run";
import {
  Blast,
  makeDebris,
  makeFire,
  makeSmoke,
  makeSparks,
  type ParticleField,
} from "./effects";

/** Wall-clock seconds one playback takes, however long the run was. */
const PLAYBACK_SECONDS = 20;

export interface TimelapseState {
  /** Simulated time now [s]. */
  time: number;
  fraction: number;
  temperatures: Record<string, number>;
  current: number;
  rpm: number;
  playing: boolean;
  /** Faults that have already happened at this point on the timeline. */
  fired: RunEvent[];
}

type Listener = (state: TimelapseState) => void;

/** Heat colour: dull metal, then red, orange and finally white hot. */
function glowFor(temperature: number, limit: number): { colour: THREE.Color; strength: number } {
  const over = (temperature - limit * 0.55) / Math.max(limit * 0.75, 1);
  const t = Math.min(Math.max(over, 0), 1.6);
  const colour = new THREE.Color(0x000000)
    .lerp(new THREE.Color(0xff2000), Math.min(t, 1))
    .lerp(new THREE.Color(0xffd6a0), Math.max(0, t - 1) / 0.6);
  return { colour, strength: t };
}

export class Timelapse {
  private readonly meshes: { mesh: THREE.Mesh; role: string; base: THREE.Color }[] = [];
  private readonly spinners: THREE.Object3D[] = [];
  private readonly plungers: THREE.Object3D[] = [];
  private readonly effects: { field?: ParticleField; blast?: Blast; object: THREE.Object3D }[] = [];
  private readonly listeners: Listener[] = [];
  private readonly partById = new Map<string, PartSpec>();

  private elapsed = 0;
  private angle = 0;
  private running = false;
  private firedIds = new Set<string>();
  private fired: RunEvent[] = [];
  private lastFrame = 0;
  private frameHandle = 0;

  constructor(
    stage: THREE.Group,
    private readonly effectsLayer: THREE.Group,
    private readonly run: RunResult,
    parts: PartSpec[],
    /** Rough size of the device, so effects are scaled to it. */
    private readonly scale: number,
  ) {
    for (const part of parts) this.partById.set(part.id, part);
    stage.traverse((child) => {
      const role = child.userData?.role as string | undefined;
      if (!role) return;
      if (role === "rotor") this.spinners.push(child);
      else if (role === "plunger") this.plungers.push(child);
      else if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (material?.isMeshStandardMaterial) {
          this.meshes.push({ mesh, role, base: material.color.clone() });
        }
      }
    });
  }

  onUpdate(listener: Listener): void {
    this.listeners.push(listener);
  }

  play(): void {
    this.reset();
    this.running = true;
    this.lastFrame = performance.now();
    const tick = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
      this.lastFrame = now;
      this.elapsed += dt;
      this.step(dt);
      if (this.elapsed >= PLAYBACK_SECONDS) {
        // Hold on the final state rather than snapping back.
        this.running = false;
        this.emit();
        return;
      }
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  reset(): void {
    this.stop();
    this.elapsed = 0;
    this.firedIds.clear();
    this.fired = [];
    for (const effect of this.effects) {
      this.effectsLayer.remove(effect.object);
      effect.field?.dispose();
      effect.blast?.dispose();
    }
    this.effects.length = 0;
    for (const entry of this.meshes) {
      const material = entry.mesh.material as THREE.MeshStandardMaterial;
      material.color.copy(entry.base);
      material.emissive.setRGB(0, 0, 0);
    }
  }

  dispose(): void {
    this.reset();
    this.listeners.length = 0;
  }

  private sampleAt(time: number) {
    const samples = this.run.thermal;
    if (samples.length === 0) return null;
    const last = samples.at(-1)!;
    if (time >= last.t) return last;
    // The timeline is uniform, so index arithmetic beats a search.
    const index = Math.min(
      samples.length - 1,
      Math.floor((time / Math.max(last.t, 1e-9)) * (samples.length - 1)),
    );
    return samples[index]!;
  }

  private step(dt: number): void {
    const fraction = Math.min(this.elapsed / PLAYBACK_SECONDS, 1);
    const time = fraction * this.run.duration;
    const sample = this.sampleAt(time);
    if (!sample) return;

    // Heat the metal.
    for (const entry of this.meshes) {
      const partId =
        entry.role === "winding" ? "winding" : entry.role === "magnet" ? "magnet" : "core";
      const temperature = sample.temperatures[partId] ?? sample.temperatures.core ?? 25;
      const part = this.partById.get(partId);
      const { colour, strength } = glowFor(temperature, part?.limit ?? 155);
      const material = entry.mesh.material as THREE.MeshStandardMaterial;
      material.emissive.copy(colour);
      material.emissiveIntensity = Math.min(strength, 1.4);
      // A magnet that has been cooked stays grey: demagnetisation is permanent.
      if (entry.role === "magnet" && part && temperature > part.limit) {
        material.color.lerp(new THREE.Color(0x6b6b6b), 0.02);
      }
      if (strength > 0.9) material.color.lerp(new THREE.Color(0x241a12), 0.006);
    }

    // Spin what turns, in real proportion to the computed speed.
    const rpm = this.run.electrical.at(-1)?.speed
      ? ((this.run.electrical.at(-1)!.speed ?? 0) * 60) / (2 * Math.PI)
      : 0;
    if (rpm > 0) {
      // Show a legible fraction of the real speed; a 1700 rpm blur says nothing.
      this.angle += dt * Math.min(rpm / 60, 6) * Math.PI * 2;
      for (const spinner of this.spinners) spinner.rotation.z = this.angle;
    }

    // Pull the plunger in as current builds.
    const pull = Math.min(sample.current / Math.max(this.run.steadyCurrent, 1e-9), 1);
    for (const plunger of this.plungers) {
      const rest = plunger.userData.restY as number;
      const pulled = plunger.userData.pulledY as number;
      plunger.position.y = rest + (pulled - rest) * pull;
    }

    // Fire the faults that have come due.
    for (const event of this.run.events) {
      const key = `${event.partId}:${event.title}:${event.t}`;
      if (event.t > time || this.firedIds.has(key)) continue;
      this.firedIds.add(key);
      this.fired.push(event);
      this.spawnEffect(event);
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]!;
      effect.field?.update(dt);
      effect.blast?.update(dt);
      if (effect.blast?.finished) {
        this.effectsLayer.remove(effect.object);
        effect.blast.dispose();
        this.effects.splice(i, 1);
      }
    }

    this.emit();
  }

  private originFor(partId: string): THREE.Vector3 {
    const match = this.meshes.find((entry) =>
      partId === "winding" ? entry.role === "winding" : entry.role === partId,
    );
    if (!match) return new THREE.Vector3(0, 0, 0);
    const box = new THREE.Box3().setFromObject(match.mesh);
    return box.getCenter(new THREE.Vector3());
  }

  private spawnEffect(event: RunEvent): void {
    const origin = this.originFor(event.partId);
    const add = (field?: ParticleField, blast?: Blast) => {
      const object = field ? field.points : blast!.group;
      this.effectsLayer.add(object);
      this.effects.push({ field, blast, object });
    };

    if (event.level === "warn") {
      // Something is getting too hot, or the core just saturated on inrush.
      if (event.title.includes("돌입") || event.title.includes("포화")) {
        add(makeSparks(origin, this.scale));
      } else {
        add(makeSmoke(origin, this.scale));
      }
      return;
    }

    const part = this.partById.get(event.partId);
    const final = this.run.finalTemperatures[event.partId] ?? 0;
    const overshoot = part ? final / part.limit : 1;

    if (event.partId === "magnet") {
      // A magnet does not burn; it quietly stops being a magnet.
      add(makeSmoke(origin, this.scale * 0.6));
      return;
    }
    add(makeSmoke(origin, this.scale));
    add(makeFire(origin, this.scale));
    if (overshoot > 1.8) {
      // Far enough past its rating that there would be nothing left.
      add(undefined, new Blast(origin, this.scale));
      add(makeDebris(origin, this.scale));
    }
  }

  private emit(): void {
    const fraction = Math.min(this.elapsed / PLAYBACK_SECONDS, 1);
    const time = fraction * this.run.duration;
    const sample = this.sampleAt(time);
    const state: TimelapseState = {
      time,
      fraction,
      temperatures: sample?.temperatures ?? {},
      current: sample?.current ?? 0,
      rpm: this.run.electrical.at(-1)?.speed
        ? ((this.run.electrical.at(-1)!.speed ?? 0) * 60) / (2 * Math.PI)
        : 0,
      playing: this.running,
      fired: [...this.fired],
    };
    for (const listener of this.listeners) listener(state);
  }
}
