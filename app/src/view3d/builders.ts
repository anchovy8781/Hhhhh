/**
 * Procedural geometry: turn a `BuildSpec` into something you can look at.
 *
 * Windings are drawn as real helices swept along the core, because the point
 * of the 3D view is to make "이게 실제로 감기나?" answerable at a glance --
 * turns, wire gauge and window space are the same numbers the physics uses.
 */

import * as THREE from "three";
import type { BuildSpec, WindingVisual } from "../physics/types";
import { coreSurface, gapSurface, magnetSurface, plasticSurface, wireSurface } from "./materials";

/** Drawing every turn of a 2000-turn coil would melt a phone. */
const MAX_DRAWN_TURNS = 46;
const TUBE_SEGMENTS_PER_TURN = 10;

export interface BuiltDevice {
  group: THREE.Group;
  /**
   * Radius of a sphere containing the device, measured from the geometry that
   * was actually created. A hand-computed estimate drifts every time a shape
   * changes and quietly mis-frames the camera.
   */
  radius: number;
  /** True when the winding is drawn with fewer turns than the design has. */
  turnsAbbreviated: boolean;
  labels: { text: string; position: THREE.Vector3 }[];
}

const drawnTurns = (turns: number) => Math.max(3, Math.min(turns, MAX_DRAWN_TURNS));

/**
 * Radius to draw the wire at.
 *
 * When a 2000-turn coil is drawn with 46 turns, using the true wire diameter
 * leaves a sparse spiral that looks nothing like the solid block of copper the
 * real winding is. Fattening the drawn strand to fill the same span keeps the
 * picture honest about how much of the window the winding occupies.
 */
function displayWireRadius(
  actualDiameter: number,
  span: number,
  turnsDrawn: number,
): number {
  const filling = (span / turnsDrawn) * 0.45;
  return Math.max(actualDiameter / 2, Math.min(filling, span / 6));
}

/** A closed helix wrapped around a circular path of `major` radius. */
function toroidHelix(
  major: number,
  minorRadial: number,
  minorAxial: number,
  turns: number,
  arcStart: number,
  arcLength: number,
): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  const steps = Math.ceil(turns * TUBE_SEGMENTS_PER_TURN);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = arcStart + arcLength * t;
    const phi = 2 * Math.PI * turns * t;
    const radial = major + minorRadial * Math.cos(phi);
    points.push(
      new THREE.Vector3(
        radial * Math.cos(theta),
        minorAxial * Math.sin(phi),
        radial * Math.sin(theta),
      ),
    );
  }
  return new THREE.CatmullRomCurve3(points, false, "centripetal", 0.2);
}

/** A helix wrapped around a straight rectangular former (an EI centre leg). */
function racetrackHelix(
  halfWidth: number,
  halfDepth: number,
  height: number,
  turns: number,
): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  const steps = Math.ceil(turns * TUBE_SEGMENTS_PER_TURN);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const phi = 2 * Math.PI * turns * t;
    // Superellipse: a rounded rectangle that hugs the former.
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const p = 4;
    const norm = Math.pow(Math.pow(Math.abs(c), p) + Math.pow(Math.abs(s), p), 1 / p);
    points.push(
      new THREE.Vector3(
        (halfWidth * c) / norm,
        -height / 2 + height * t,
        (halfDepth * s) / norm,
      ),
    );
  }
  return new THREE.CatmullRomCurve3(points, false, "centripetal", 0.2);
}

/** A straight-axis helix, as wound on a solenoid bobbin. */
function cylinderHelix(radius: number, length: number, turns: number): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  const steps = Math.ceil(turns * TUBE_SEGMENTS_PER_TURN);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const phi = 2 * Math.PI * turns * t;
    points.push(
      new THREE.Vector3(
        radius * Math.cos(phi),
        -length / 2 + length * t,
        radius * Math.sin(phi),
      ),
    );
  }
  return new THREE.CatmullRomCurve3(points, false, "centripetal", 0.2);
}

function tube(
  curve: THREE.Curve<THREE.Vector3>,
  wireRadius: number,
  segments: number,
): THREE.TubeGeometry {
  return new THREE.TubeGeometry(curve, Math.min(segments, 2400), wireRadius, 8, false);
}

export function buildDevice(spec: BuildSpec): BuiltDevice {
  const built = (() => {
    switch (spec.kind) {
      case "toroid":
        return buildToroid(spec);
      case "ei":
        return buildEi(spec);
      case "solenoid":
        return buildSolenoid(spec);
      case "motor":
        return buildMotor(spec);
      case "busbar":
        return buildBusbar(spec);
    }
  })();
  return { ...built, radius: measure(built.group) };
}

/** Centre the device on the origin and report the radius that contains it. */
function measure(group: THREE.Group): number {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return 40;
  const centre = box.getCenter(new THREE.Vector3());
  group.position.sub(centre);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return Math.max(sphere.radius, 5);
}

// -- toroid ----------------------------------------------------------------

/** A ring of rectangular cross-section: the shape a real wound core is. */
function ringGeometry(
  innerRadius: number,
  outerRadius: number,
  height: number,
  segments = 64,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, Math.max(innerRadius, 0.1), 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: segments,
  });
  geometry.translate(0, 0, -height / 2);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function buildToroid(spec: Extract<BuildSpec, { kind: "toroid" }>): BuiltDevice {
  const group = new THREE.Group();
  const major = (spec.od + spec.id) / 4;
  const radial = (spec.od - spec.id) / 2;

  const core = new THREE.Mesh(
    ringGeometry(spec.id / 2, spec.od / 2, spec.height),
    coreSurface(spec.coreColor, spec.saturation),
  );
  group.add(core);

  let abbreviated = false;
  let arcStart = 0;
  for (const winding of spec.windings) {
    const turns = drawnTurns(winding.turns);
    if (turns < winding.turns) abbreviated = true;
    const arc = 2 * Math.PI * Math.max(0.12, winding.share) * 0.94;
    const curve = toroidHelix(
      major,
      radial / 2 + winding.wireDiameter * 0.7,
      spec.height / 2 + winding.wireDiameter * 0.7,
      turns,
      arcStart,
      arc,
    );
    group.add(
      new THREE.Mesh(
        tube(
          curve,
          displayWireRadius(winding.wireDiameter, arc * major, turns),
          turns * TUBE_SEGMENTS_PER_TURN,
        ),
        wireSurface(winding.color),
      ),
    );
    arcStart += arc + 0.12;
  }

  return {
    group,
    radius: spec.od / 2 + 6,
    turnsAbbreviated: abbreviated,
    labels: labelsFor(spec.windings, new THREE.Vector3(major, 0, 0)),
  };
}

// -- EI core ---------------------------------------------------------------

function buildEi(spec: Extract<BuildSpec, { kind: "ei" }>): BuiltDevice {
  const group = new THREE.Group();
  const { tongue, stack, windowWidth, windowHeight, gap } = spec;
  const outerWidth = tongue * 2 + windowWidth * 2;
  const yoke = tongue / 2;
  const material = () => coreSurface(spec.coreColor, spec.saturation);

  const box = (w: number, h: number, d: number, x: number, y: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material());
    mesh.position.set(x, y, 0);
    return mesh;
  };

  const halfHeight = windowHeight / 2 + yoke;
  // E half: back yoke plus three legs.
  group.add(box(outerWidth, yoke, stack, 0, -halfHeight + yoke / 2));
  group.add(box(tongue, windowHeight, stack, 0, 0));
  group.add(box(yoke, windowHeight, stack, -outerWidth / 2 + yoke / 2, 0));
  group.add(box(yoke, windowHeight, stack, outerWidth / 2 - yoke / 2, 0));
  // I bar on top, lifted by the air gap.
  const iBar = box(outerWidth, yoke, stack, 0, halfHeight - yoke / 2 + gap);
  group.add(iBar);

  if (gap > 0.01) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(tongue * 1.05, Math.max(gap, 0.4), stack * 1.05),
      gapSurface(),
    );
    marker.position.set(0, windowHeight / 2 + gap / 2, 0);
    group.add(marker);
  }

  // Windings on an EI core are concentric: the secondary goes *over* the
  // primary on the same centre leg, each layer taking a share of the window
  // width. Stacking them vertically instead would misrepresent both the
  // coupling and how much window each one really costs.
  let abbreviated = false;
  let inset = 0;
  for (const winding of spec.windings) {
    const turns = drawnTurns(winding.turns);
    if (turns < winding.turns) abbreviated = true;
    const build = Math.max(
      windowWidth * 0.8 * Math.max(winding.share, 0.12),
      winding.wireDiameter,
    );
    const height = windowHeight * 0.88;
    const curve = racetrackHelix(
      tongue / 2 + inset + build / 2,
      stack / 2 + inset + build / 2,
      height,
      turns,
    );
    group.add(
      new THREE.Mesh(
        tube(curve, displayWireRadius(winding.wireDiameter, height, turns), turns * TUBE_SEGMENTS_PER_TURN),
        wireSurface(winding.color),
      ),
    );
    inset += build;
  }

  return {
    group,
    radius: Math.max(outerWidth, windowHeight + tongue) / 2 + 6,
    turnsAbbreviated: abbreviated,
    labels: labelsFor(spec.windings, new THREE.Vector3(tongue, 0, stack / 2)),
  };
}

// -- solenoid --------------------------------------------------------------

function buildSolenoid(spec: Extract<BuildSpec, { kind: "solenoid" }>): BuiltDevice {
  const group = new THREE.Group();
  const coreMat = coreSurface(spec.coreColor, spec.saturation);

  const bobbin = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.bobbinId / 2, spec.bobbinId / 2, spec.coilLength, 32, 1, true),
    plasticSurface(0x2a2f3a),
  );
  group.add(bobbin);

  let abbreviated = false;
  for (const winding of spec.windings) {
    const turns = drawnTurns(winding.turns);
    if (turns < winding.turns) abbreviated = true;
    const radius = (spec.bobbinId + spec.bobbinOd) / 4;
    const curve = cylinderHelix(radius, spec.coilLength * 0.94, turns);
    group.add(
      new THREE.Mesh(
        tube(
          curve,
          displayWireRadius(winding.wireDiameter, spec.coilLength * 0.94, turns),
          turns * TUBE_SEGMENTS_PER_TURN,
        ),
        wireSurface(winding.color),
      ),
    );
  }

  if (spec.shellThickness > 0.05) {
    const shell = new THREE.Mesh(
      ringGeometry(
        spec.bobbinOd / 2,
        spec.bobbinOd / 2 + spec.shellThickness,
        spec.coilLength * 1.1,
        44,
      ),
      coreMat,
    );
    group.add(shell);
    const backPlate = new THREE.Mesh(
      new THREE.CylinderGeometry(
        spec.bobbinOd / 2 + spec.shellThickness,
        spec.bobbinOd / 2 + spec.shellThickness,
        spec.shellThickness,
        40,
      ),
      coreMat,
    );
    backPlate.position.y = -spec.coilLength * 0.55 - spec.shellThickness / 2;
    group.add(backPlate);
  }

  const plunger = new THREE.Mesh(
    new THREE.CylinderGeometry(
      spec.plungerDiameter / 2,
      spec.plungerDiameter / 2,
      spec.plungerLength,
      32,
    ),
    coreMat,
  );
  plunger.position.y = spec.gap + spec.plungerLength / 2 - spec.coilLength * 0.3;
  group.add(plunger);

  const gapMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(
      spec.plungerDiameter / 2,
      spec.plungerDiameter / 2,
      Math.max(spec.gap, 0.4),
      32,
    ),
    gapSurface(),
  );
  gapMarker.position.y = plunger.position.y - spec.plungerLength / 2 - spec.gap / 2;
  group.add(gapMarker);

  return {
    group,
    radius: Math.max(spec.bobbinOd / 2 + spec.shellThickness, spec.coilLength / 2) + 8,
    turnsAbbreviated: abbreviated,
    labels: labelsFor(spec.windings, new THREE.Vector3(spec.bobbinOd / 2, 0, 0)),
  };
}

// -- motor -----------------------------------------------------------------

function buildMotor(spec: Extract<BuildSpec, { kind: "motor" }>): BuiltDevice {
  const group = new THREE.Group();
  const coreMat = coreSurface(spec.coreColor, spec.saturation);
  const magnetInner = spec.rotorOd / 2 + spec.airGap;
  const magnetOuter = magnetInner + spec.magnetThickness;

  // Stator yoke: a solid ring outside the magnets, not an open shell -- an
  // open cylinder shows its own far inner wall and reads as a curved sheet.
  const yoke = new THREE.Mesh(
    ringGeometry(magnetOuter, spec.statorOd / 2, spec.stackLength, 48),
    coreMat,
  );
  yoke.rotateX(Math.PI / 2);
  group.add(yoke);

  // Magnets: arcs covering ~80 % of each pole pitch.
  const arc = ((2 * Math.PI) / spec.poles) * 0.8;
  for (let pole = 0; pole < spec.poles; pole++) {
    const start = (pole * 2 * Math.PI) / spec.poles - arc / 2;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, magnetOuter, start, start + arc, false);
    shape.absarc(0, 0, magnetInner, start + arc, start, true);
    const magnet = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: spec.stackLength, bevelEnabled: false }),
      magnetSurface(pole % 2 === 0 ? spec.magnetColor : 0x8b5a5a),
    );
    magnet.position.z = -spec.stackLength / 2;
    group.add(magnet);
  }

  // Rotor: a slotted cylinder. Each slot is a notch cut by a small box.
  const rotor = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.rotorOd / 2, spec.rotorOd / 2, spec.stackLength, 48),
    coreMat,
  );
  rotor.rotation.x = Math.PI / 2;
  group.add(rotor);

  const slotDepth = spec.rotorOd * 0.16;
  const slotWidth = Math.min((Math.PI * spec.rotorOd) / spec.slots * 0.45, spec.rotorOd * 0.12);
  const coilMaterial = wireSurface(spec.windings[0]?.color ?? 0xc27a3a);
  for (let slot = 0; slot < spec.slots; slot++) {
    const angle = (slot * 2 * Math.PI) / spec.slots;
    const radius = spec.rotorOd / 2 - slotDepth / 2;
    const coil = new THREE.Mesh(
      new THREE.BoxGeometry(slotWidth, slotDepth, spec.stackLength * 1.08),
      coilMaterial,
    );
    coil.position.set(radius * Math.cos(angle), radius * Math.sin(angle), 0);
    coil.rotation.z = angle + Math.PI / 2;
    group.add(coil);
  }

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(
      spec.shaftDiameter / 2,
      spec.shaftDiameter / 2,
      spec.stackLength * 2.2,
      24,
    ),
    plasticSurface(0x9aa3ad),
  );
  shaft.rotation.x = Math.PI / 2;
  group.add(shaft);

  return {
    group,
    radius: spec.statorOd / 2 + 8,
    turnsAbbreviated: false,
    labels: labelsFor(spec.windings, new THREE.Vector3(spec.rotorOd / 2, 0, 0)),
  };
}

// -- busbar ----------------------------------------------------------------

function buildBusbar(spec: Extract<BuildSpec, { kind: "busbar" }>): BuiltDevice {
  const group = new THREE.Group();
  const surface = spec.finish === "black" ? 0x22262b : spec.color;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(surface).lerp(
      new THREE.Color(0xff3b30),
      Math.min(Math.max(spec.loading - 0.7, 0) / 0.5, 1) * 0.8,
    ),
    metalness: spec.finish === "black" ? 0.2 : 0.9,
    roughness: spec.finish === "black" ? 0.8 : 0.25,
  });
  // Stacked bars sit one gap apart, which is what shades them thermally.
  const pitch = spec.thickness * 2.2;
  for (let bar = 0; bar < spec.bars; bar++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(spec.length, spec.thickness, spec.width),
      material,
    );
    mesh.position.y = (bar - (spec.bars - 1) / 2) * pitch;
    group.add(mesh);
  }
  // Bolted joints at each end, the part that actually runs hottest.
  for (const side of [-1, 1]) {
    for (let bar = 0; bar < spec.bars; bar++) {
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.width * 0.12, spec.width * 0.12, spec.thickness * 1.6, 16),
        plasticSurface(0x8a929b),
      );
      bolt.position.set(
        (side * spec.length) / 2.4,
        (bar - (spec.bars - 1) / 2) * pitch,
        0,
      );
      group.add(bolt);
    }
  }
  return {
    group,
    radius: spec.length / 2,
    turnsAbbreviated: false,
    labels: [],
  };
}

function labelsFor(windings: WindingVisual[], anchor: THREE.Vector3) {
  return windings.map((winding, index) => ({
    text: `${winding.label} ${winding.turns}T`,
    position: anchor.clone().add(new THREE.Vector3(0, index * 6, 0)),
  }));
}
