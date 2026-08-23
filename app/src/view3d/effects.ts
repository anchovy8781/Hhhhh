/**
 * Failure effects.
 *
 * A number going red is easy to miss; a coil catching fire is not. These are
 * driven by what the simulation actually found — smoke when a part passes its
 * limit, flame when it keeps climbing, an arc flash when the core saturates on
 * inrush, and a burst when a part runs so far past its rating that nothing
 * would be left of it.
 */

import * as THREE from "three";

/** A soft round sprite, built once and shared by every particle system. */
function softSprite(inner: string, outer: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.45, outer);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

let smokeTexture: THREE.CanvasTexture | null = null;
let flameTexture: THREE.CanvasTexture | null = null;

const textures = () => {
  smokeTexture ??= softSprite("rgba(150,150,150,0.85)", "rgba(90,90,90,0.35)");
  flameTexture ??= softSprite("rgba(255,240,170,1)", "rgba(255,120,20,0.6)");
  return { smoke: smokeTexture, flame: flameTexture };
};

interface ParticleOptions {
  count: number;
  texture: THREE.Texture;
  size: number;
  color: number;
  additive: boolean;
  /** Seconds a particle lives. */
  life: number;
  speed: number;
  spread: number;
  /** Upward bias: smoke rises, debris falls. */
  buoyancy: number;
  origin: THREE.Vector3;
  radius: number;
  /** Emit continuously, or all at once. */
  continuous: boolean;
  growth: number;
}

/**
 * One particle system.
 *
 * Positions and ages live in plain arrays and are written into a single
 * BufferGeometry each frame — a few hundred particles cost nothing, and a
 * phone can run several of these at once without dropping the 3D view.
 */
export class ParticleField {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly options: ParticleOptions;
  private readonly material: THREE.PointsMaterial;
  private emitted = 0;
  /** Set to false to let the current particles die out without new ones. */
  emitting = true;

  constructor(options: ParticleOptions) {
    this.options = options;
    this.positions = new Float32Array(options.count * 3);
    this.velocities = new Float32Array(options.count * 3);
    this.ages = new Float32Array(options.count);
    for (let i = 0; i < options.count; i++) {
      this.ages[i] = options.continuous ? -Math.random() * options.life : 0;
      this.spawn(i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      size: options.size,
      map: options.texture,
      color: options.color,
      transparent: true,
      depthWrite: false,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      opacity: 0.9,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  private spawn(index: number) {
    const { origin, radius, speed, spread, buoyancy } = this.options;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * Math.cbrt(Math.random());
    this.positions[index * 3] = origin.x + r * Math.sin(phi) * Math.cos(theta);
    this.positions[index * 3 + 1] = origin.y + r * Math.cos(phi);
    this.positions[index * 3 + 2] = origin.z + r * Math.sin(phi) * Math.sin(theta);
    this.velocities[index * 3] = (Math.random() - 0.5) * spread;
    this.velocities[index * 3 + 1] = speed * buoyancy + (Math.random() - 0.3) * spread;
    this.velocities[index * 3 + 2] = (Math.random() - 0.5) * spread;
    this.ages[index] = 0;
    this.emitted++;
  }

  update(dt: number): void {
    const { life, count, continuous, growth } = this.options;
    let alive = 0;
    for (let i = 0; i < count; i++) {
      this.ages[i]! += dt;
      if (this.ages[i]! > life) {
        if (continuous && this.emitting) this.spawn(i);
        else continue;
      }
      if (this.ages[i]! < 0) continue;
      alive++;
      this.positions[i * 3] += this.velocities[i * 3]! * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1]! * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2]! * dt;
      // Rising plumes slow and spread as they cool.
      this.velocities[i * 3 + 1]! *= 1 - 0.4 * dt;
    }
    this.material.size = this.options.size * (1 + growth * 0.5);
    this.material.opacity = alive > 0 ? 0.9 : 0;
    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  get finished(): boolean {
    return !this.emitting && this.ages.every((age) => age > this.options.life);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

const vec = (position: THREE.Vector3) => position.clone();

export function makeSmoke(origin: THREE.Vector3, scale: number): ParticleField {
  return new ParticleField({
    count: 90,
    texture: textures().smoke,
    size: scale * 0.5,
    color: 0x8a8a8a,
    additive: false,
    life: 2.6,
    speed: scale * 0.55,
    spread: scale * 0.18,
    buoyancy: 1,
    origin: vec(origin),
    radius: scale * 0.35,
    continuous: true,
    growth: 0.6,
  });
}

export function makeFire(origin: THREE.Vector3, scale: number): ParticleField {
  return new ParticleField({
    count: 120,
    texture: textures().flame,
    size: scale * 0.34,
    color: 0xffa22a,
    additive: true,
    life: 0.75,
    speed: scale * 1.5,
    spread: scale * 0.3,
    buoyancy: 1,
    origin: vec(origin),
    radius: scale * 0.3,
    continuous: true,
    growth: 0,
  });
}

export function makeSparks(origin: THREE.Vector3, scale: number): ParticleField {
  return new ParticleField({
    count: 160,
    texture: textures().flame,
    size: scale * 0.12,
    color: 0xbfe6ff,
    additive: true,
    life: 0.5,
    speed: scale * 4,
    spread: scale * 5,
    buoyancy: 0.1,
    origin: vec(origin),
    radius: scale * 0.15,
    continuous: false,
    growth: 0,
  });
}

export function makeDebris(origin: THREE.Vector3, scale: number): ParticleField {
  return new ParticleField({
    count: 200,
    texture: textures().smoke,
    size: scale * 0.22,
    color: 0x4a4038,
    additive: false,
    life: 2.2,
    speed: scale * 6,
    spread: scale * 7,
    buoyancy: 0.2,
    origin: vec(origin),
    radius: scale * 0.2,
    continuous: false,
    growth: 0,
  });
}

/** The expanding shock front of a burst, plus the flash that lights the scene. */
export class Blast {
  readonly group = new THREE.Group();
  private readonly shell: THREE.Mesh;
  private readonly light: THREE.PointLight;
  private age = 0;
  private readonly scale: number;

  constructor(origin: THREE.Vector3, scale: number) {
    this.scale = scale;
    const material = new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material);
    this.shell.position.copy(origin);
    this.light = new THREE.PointLight(0xffa040, 40, scale * 12);
    this.light.position.copy(origin);
    this.group.add(this.shell, this.light);
  }

  update(dt: number): void {
    this.age += dt;
    const t = Math.min(this.age / 0.85, 1);
    const radius = this.scale * (0.3 + 3.2 * t);
    this.shell.scale.setScalar(radius);
    (this.shell.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t) ** 1.6;
    this.light.intensity = 40 * (1 - t) ** 2;
  }

  get finished(): boolean {
    return this.age > 0.9;
  }

  dispose(): void {
    this.shell.geometry.dispose();
    (this.shell.material as THREE.Material).dispose();
  }
}
