/** Three.js scene, camera, lighting and the render loop. */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface Viewer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Everything the device builder owns; cleared on every rebuild. */
  stage: THREE.Group;
  setBackground(dark: boolean): void;
  /** Hide the near half of the device so the winding inside is visible. */
  setCutaway(on: boolean): void;
  frame(radius: number): void;
  resize(): void;
  dispose(): void;
}

export function createViewer(canvas: HTMLCanvasElement): Viewer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
  camera.position.set(90, 70, 110);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.7;
  controls.panSpeed = 0.7;
  controls.minDistance = 20;
  controls.maxDistance = 1200;

  // Three-point lighting so the metal reads as metal from any orbit angle.
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(80, 120, 90);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.9);
  fill.position.set(-90, 40, -60);
  const rim = new THREE.DirectionalLight(0xffddaa, 1.1);
  rim.position.set(0, -70, -110);
  scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.35));

  const stage = new THREE.Group();
  scene.add(stage);

  const grid = new THREE.GridHelper(400, 20, 0x334155, 0x1e293b);
  grid.position.y = -40;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  scene.add(grid);

  // A winding lives inside its core, so the most informative view is a cut
  // one. The plane is global: every material picks it up when cutaway is on.
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const setCutaway = (on: boolean) => {
    renderer.clippingPlanes = on ? [cutPlane] : [];
  };

  const setBackground = (dark: boolean) => {
    scene.background = new THREE.Color(dark ? 0x0d1117 : 0xeef2f7);
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.opacity = dark ? 0.35 : 0.2;
  };
  setBackground(true);
  setCutaway(false);

  const resize = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  /** Pull the camera back far enough to see an object of the given radius. */
  const frame = (radius: number) => {
    // Fit the bounding sphere to the *narrower* of the two field-of-view
    // angles, so a tall object on a phone is not cropped top and bottom.
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = (radius * 1.25) / Math.sin(Math.min(vertical, horizontal));
    const direction = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(direction.multiplyScalar(distance));
    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 0.6;
    controls.maxDistance = radius * 12;
    grid.position.y = -radius * 0.9;
    controls.update();
  };

  let running = true;
  const tick = () => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();

  const observer = new ResizeObserver(resize);
  if (canvas.parentElement) observer.observe(canvas.parentElement);
  resize();

  return {
    scene,
    camera,
    renderer,
    controls,
    stage,
    setBackground,
    setCutaway,
    frame,
    resize,
    dispose() {
      running = false;
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}

/** Free every geometry and material under a group, then empty it. */
export function clearGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
  group.clear();
}
