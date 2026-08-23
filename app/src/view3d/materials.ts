/** Shared surface treatments for the 3D device models. */

import * as THREE from "three";

/** Laminated steel / ferrite: fairly rough, slightly metallic. */
export function coreSurface(color: number, saturation: number): THREE.MeshStandardMaterial {
  const base = new THREE.Color(color);
  // Saturation tints the core toward red so the failure mode is visible from
  // across the room, not buried in a number.
  const hot = new THREE.Color(0xff3b30);
  // Stay the material's own colour while there is real headroom; a design at
  // 70 % of saturation is healthy and should not look like it is on fire.
  const blend = Math.min(Math.max((saturation - 0.6) / 0.45, 0), 1);
  return new THREE.MeshStandardMaterial({
    color: base.clone().lerp(hot, blend * 0.8),
    metalness: 0.55,
    roughness: 0.52,
    emissive: hot.clone().multiplyScalar(Math.max(0, saturation - 0.9) * 0.6),
  });
}

/** Enamelled magnet wire: glossy, strongly metallic. */
export function wireSurface(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.85,
    roughness: 0.28,
  });
}

export function magnetSurface(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.7,
    roughness: 0.35,
  });
}

export function plasticSurface(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.05,
    roughness: 0.75,
  });
}

/** Translucent marker for air gaps, so the gap itself is visible. */
export function gapSurface(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.35,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.4,
  });
}
