import * as THREE from "three";
import type { MetricBus } from "../metrics-bus.js";
import { createPbrScene, type SceneKit } from "./scene-kit.js";
import type { VizContext, VizMode } from "./types.js";

const FREQ_BINS = 64;
const CHANNELS = 8;
const TRAIL = 48;

export function createAuroraMode(): VizMode {
  let kit: SceneKit | null = null;
  let points: THREE.Points | null = null;
  let canopy: THREE.Mesh | null = null;
  let raf = 0;
  let positions: Float32Array | null = null;
  let colors: Float32Array | null = null;
  let history: Float32Array | null = null;
  let bus: MetricBus | null = null;
  let paused: () => boolean = () => false;
  let t0 = performance.now();
  let cursor = 0;

  function ingestPsd(): void {
    if (!bus || !history)
      return;
    const snap = bus.snapshot;
    const demo = snap.updatedAt === 0 || !snap.psd;
    const time = performance.now() / 1000;

    for (let c = 0; c < CHANNELS; c++) {
      for (let f = 0; f < FREQ_BINS; f++) {
        let v = 0;
        if (demo) {
          const band = f / FREQ_BINS;
          v =
            0.15 +
            0.55 * Math.exp(-Math.pow((band - 0.2 - 0.05 * Math.sin(time + c)) * 8, 2)) +
            0.25 * Math.exp(-Math.pow((band - 0.45) * 10, 2)) * (0.5 + 0.5 * Math.sin(time * 2 + c));
        } else if (snap.psd) {
          const row = snap.psd.values[c] ?? snap.psd.values[0];
          const srcLen = row?.length ?? 0;
          if (srcLen > 0) {
            const idx = Math.min(srcLen - 1, Math.floor((f / FREQ_BINS) * srcLen));
            v = Math.max(0, row[idx] ?? 0);
          }
        }
        history[((cursor * CHANNELS) + c) * FREQ_BINS + f] = v;
      }
    }
    cursor = (cursor + 1) % TRAIL;
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!kit || !points || !bus || !positions || !colors || !history)
      return;
    if (paused()) {
      kit.render();
      return;
    }

    const dtGate = now - t0;
    if (dtGate > 40) {
      t0 = now;
      ingestPsd();
    }

    const snap = bus.snapshot;
    const focus = snap.focus;
    const calm = snap.calm;
    let i = 0;
    let peak = 0;
    for (let t = 0; t < TRAIL; t++) {
      const histIndex = (cursor - 1 - t + TRAIL) % TRAIL;
      const fade = 1 - t / TRAIL;
      for (let c = 0; c < CHANNELS; c++) {
        for (let f = 0; f < FREQ_BINS; f++) {
          const power = history[(histIndex * CHANNELS + c) * FREQ_BINS + f] ?? 0;
          const amp = Math.min(2.2, Math.pow(power, 0.55) * (0.8 + focus));
          peak = Math.max(peak, amp);
          const x = (f / (FREQ_BINS - 1) - 0.5) * 6.5;
          const y = amp * (0.7 + (1 - calm) * 0.5);
          const z = (c / (CHANNELS - 1) - 0.5) * 3.2 - t * 0.045;

          positions[i * 3] = x;
          positions[i * 3 + 1] = y;
          positions[i * 3 + 2] = z;

          const hue = f / FREQ_BINS;
          colors[i * 3] = (0.2 + hue * 0.8) * fade * (0.4 + amp);
          colors[i * 3 + 1] = (0.7 - Math.abs(hue - 0.4)) * fade * (0.4 + amp);
          colors[i * 3 + 2] = (1.0 - hue * 0.5) * fade * (0.5 + amp);
          i++;
        }
      }
    }

    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.attributes.color.needsUpdate = true;

    if (canopy) {
      const mat = canopy.material as THREE.MeshPhysicalMaterial;
      mat.roughness = 0.05 + calm * 0.2;
      mat.metalness = 0.7 + focus * 0.25;
      mat.emissiveIntensity = 0.05 + peak * 0.35;
      canopy.rotation.y = now / 1000 * 0.05;
    }

    const time = now / 1000;
    kit.camera.position.x = Math.sin(time * 0.1) * 0.8;
    kit.camera.position.y = 2.4 + calm * 0.4;
    kit.camera.lookAt(0, 0.6, 0);
    kit.render();
  }

  return {
    id: "aurora",
    label: "Aurora",
    mount(ctx: VizContext) {
      bus = ctx.bus;
      paused = ctx.paused;
      ctx.container.innerHTML = "";
      kit = createPbrScene(ctx.container, {
        cameraPos: [0, 2.5, 5.8],
        bloomStrength: 1.0
      });

      canopy = new THREE.Mesh(
        new THREE.SphereGeometry(4.8, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.48),
        new THREE.MeshPhysicalMaterial({
          color: 0x1a2230,
          metalness: 0.85,
          roughness: 0.12,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          envMapIntensity: 1.6,
          side: THREE.BackSide,
          emissive: 0x224466,
          emissiveIntensity: 0.1
        })
      );
      canopy.position.y = 0.2;
      kit.scene.add(canopy);

      const count = TRAIL * CHANNELS * FREQ_BINS;
      history = new Float32Array(count);
      positions = new Float32Array(count * 3);
      colors = new Float32Array(count * 3);
      cursor = 0;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      points = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          size: 0.045,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      kit.scene.add(points);

      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    },
    unmount() {
      cancelAnimationFrame(raf);
      points?.geometry.dispose();
      (points?.material as THREE.Material | undefined)?.dispose();
      canopy?.geometry.dispose();
      (canopy?.material as THREE.Material | undefined)?.dispose();
      kit?.dispose();
      kit = null;
      points = null;
      canopy = null;
      positions = colors = history = null;
      bus = null;
    },
    setSize(width: number, height: number) {
      kit?.setSize(width, height);
    }
  };
}
