import * as THREE from "three";
import { channelPosition, type MetricBus } from "../metrics-bus.js";
import { createPbrScene, liveOrDemo, type SceneKit } from "./scene-kit.js";
import type { VizContext, VizMode } from "./types.js";

const HEAD_DOTS = 7000;

function sampleHeadPoint(): [number, number, number] {
  // Ellipsoid skull + slight jaw/neck
  for (let attempt = 0; attempt < 8; attempt++) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    let x = Math.sin(phi) * Math.cos(theta);
    let y = Math.cos(phi);
    let z = Math.sin(phi) * Math.sin(theta);
    // stretch to head proportions
    x *= 0.78;
    y *= 1.05;
    z *= 0.92;
    y += 0.15;
    // flatten below chin into neck
    if (y < -0.35) {
      const t = (-0.35 - y) / 0.5;
      x *= 1 - t * 0.45;
      z *= 1 - t * 0.45;
      y = -0.35 - t * 0.55;
    }
    // facial inset for nose region
    if (z > 0.55 && Math.abs(x) < 0.25 && y > -0.05 && y < 0.35) {
      z += 0.08 * (1 - Math.abs(x) / 0.25);
    }
    return [x, y, z];
  }
  return [0, 0.2, 0];
}

export function createHeadMode(): VizMode {
  let kit: SceneKit | null = null;
  let headPts: THREE.Points | null = null;
  let electrodes: THREE.Mesh[] = [];
  let crownBand: THREE.Mesh | null = null;
  let headRoot: THREE.Group | null = null;
  let raf = 0;
  let colors: Float32Array | null = null;
  let bus: MetricBus | null = null;
  let paused: () => boolean = () => false;

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!kit || !bus || !headPts || !colors || !headRoot)
      return;
    if (paused()) {
      kit.render();
      return;
    }

    const snap = bus.snapshot;
    const t = now / 1000;
    const focus = liveOrDemo(snap.updatedAt, snap.focus, 0.5 + 0.3 * Math.sin(t * 0.6));
    const calm = liveOrDemo(snap.updatedAt, snap.calm, 0.5 + 0.3 * Math.cos(t * 0.45));
    const mean = (arr: number[], fb: number) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : fb;
    const beta = liveOrDemo(snap.updatedAt, mean(snap.bands.beta, 0.3), 0.3 + 0.2 * Math.sin(t));
    const alpha = liveOrDemo(snap.updatedAt, mean(snap.bands.alpha, 0.35), 0.35 + 0.2 * Math.cos(t));

    // Color wash over head dots from global state
    const base = new THREE.Color().setHSL(0.58 - focus * 0.15, 0.55, 0.45 + calm * 0.15);
    const hot = new THREE.Color().setHSL(0.08, 0.85, 0.55);
    for (let i = 0; i < HEAD_DOTS; i++) {
      const mix = 0.35 + beta * 0.4 + 0.15 * Math.sin(t * 2 + i * 0.01);
      const c = base.clone().lerp(hot, mix * focus);
      const glow = 0.45 + alpha * 0.4 + focus * 0.35;
      colors[i * 3] = c.r * glow;
      colors[i * 3 + 1] = c.g * glow;
      colors[i * 3 + 2] = c.b * glow;
    }
    headPts.geometry.attributes.color.needsUpdate = true;
    (headPts.material as THREE.PointsMaterial).size = 0.028 + focus * 0.02;

    for (let i = 0; i < electrodes.length; i++) {
      const name = snap.channelNames[i] ?? Object.keys(snap.bands)[0];
      const status = snap.signalStatuses[i] ?? "good";
      const power =
        (snap.bands.beta[i] ?? 0) * 0.5 +
        (snap.bands.gamma[i] ?? 0) * 0.7 +
        (snap.bands.alpha[i] ?? 0) * 0.3;
      const q =
        status === "great" ? 1 : status === "good" ? 0.7 : status === "bad" ? 0.35 : 0.12;
      const mat = electrodes[i].material as THREE.MeshPhysicalMaterial;
      mat.emissiveIntensity = 0.3 + power * 2.2 * q;
      mat.color.setHSL(0.55 - power * 0.4, 0.7, 0.55);
      mat.emissive.copy(mat.color);
      electrodes[i].scale.setScalar(0.85 + power * 0.7 * q);
    }

    // Orientation from accelerometer pitch/roll (degrees → radians)
    const pitch = liveOrDemo(snap.updatedAt, snap.accel.pitch ?? 0, Math.sin(t * 0.35) * 12);
    const roll = liveOrDemo(snap.updatedAt, snap.accel.roll ?? 0, Math.cos(t * 0.28) * 10);
    headRoot.rotation.x = THREE.MathUtils.degToRad(pitch) * 0.85;
    headRoot.rotation.z = -THREE.MathUtils.degToRad(roll) * 0.85;
    headRoot.rotation.y = Math.sin(t * 0.08) * 0.15;

    if (crownBand) {
      const mat = crownBand.material as THREE.MeshPhysicalMaterial;
      mat.emissiveIntensity = 0.25 + focus * 0.9;
      mat.roughness = 0.15 + (1 - calm) * 0.25;
    }

    kit.setBloomBoost(0.55 + focus * 0.55);
    kit.camera.position.x = Math.sin(t * 0.12) * 0.55;
    kit.camera.position.y = 0.55 + (1 - calm) * 0.15;
    kit.camera.lookAt(0, 0.2, 0);
    kit.render();
  }

  return {
    id: "head",
    label: "Head",
    mount(ctx: VizContext) {
      bus = ctx.bus;
      paused = ctx.paused;
      ctx.container.innerHTML = "";
      kit = createPbrScene(ctx.container, {
        cameraPos: [0, 0.55, 3.6],
        bloomStrength: 0.85
      });

      headRoot = new THREE.Group();
      kit.scene.add(headRoot);

      const positions = new Float32Array(HEAD_DOTS * 3);
      colors = new Float32Array(HEAD_DOTS * 3);
      for (let i = 0; i < HEAD_DOTS; i++) {
        const [x, y, z] = sampleHeadPoint();
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        colors[i * 3] = 0.4;
        colors[i * 3 + 1] = 0.7;
        colors[i * 3 + 2] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      headPts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          size: 0.03,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      headRoot.add(headPts);

      electrodes = [];
      const names = ["F5", "F6", "C3", "C4", "CP3", "CP4", "PO3", "PO4"];
      for (let i = 0; i < names.length; i++) {
        const [x, y, z] = channelPosition(names[i], i);
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 16, 12),
          new THREE.MeshPhysicalMaterial({
            color: 0x88ddff,
            emissive: 0x44aaff,
            emissiveIntensity: 0.6,
            metalness: 0.4,
            roughness: 0.25,
            clearcoat: 0.8
          })
        );
        // push slightly outward from skull
        const len = Math.hypot(x, y, z) || 1;
        mesh.position.set((x / len) * 1.02, (y / len) * 1.02, (z / len) * 1.02);
        electrodes.push(mesh);
        headRoot.add(mesh);
      }

      crownBand = new THREE.Mesh(
        new THREE.TorusGeometry(0.82, 0.045, 12, 64),
        new THREE.MeshPhysicalMaterial({
          color: 0xd0dde8,
          metalness: 0.85,
          roughness: 0.2,
          emissive: 0x6688aa,
          emissiveIntensity: 0.35,
          clearcoat: 1
        })
      );
      crownBand.rotation.x = Math.PI / 2.15;
      crownBand.position.y = 0.55;
      headRoot.add(crownBand);

      raf = requestAnimationFrame(frame);
    },
    unmount() {
      cancelAnimationFrame(raf);
      headPts?.geometry.dispose();
      (headPts?.material as THREE.Material | undefined)?.dispose();
      for (const e of electrodes) {
        e.geometry.dispose();
        (e.material as THREE.Material).dispose();
      }
      crownBand?.geometry.dispose();
      (crownBand?.material as THREE.Material | undefined)?.dispose();
      kit?.dispose();
      kit = null;
      headPts = null;
      electrodes = [];
      crownBand = null;
      headRoot = null;
      colors = null;
      bus = null;
    },
    setSize(width: number, height: number) {
      kit?.setSize(width, height);
    }
  };
}
