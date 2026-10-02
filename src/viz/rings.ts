import * as THREE from "three";
import type { MetricBus } from "../metrics-bus.js";
import { createPbrScene, liveOrDemo, physicalShellMaterial, type SceneKit } from "./scene-kit.js";
import type { VizContext, VizMode } from "./types.js";

const RING_COUNT = 5;
const SEGMENTS = 256;
const PARTICLES_PER_RING = 1800;

const BAND_KEYS = ["delta", "theta", "alpha", "beta", "gamma"] as const;
const BAND_COLORS = [0x4b6cff, 0x36d6c3, 0xa0ff6a, 0xffb347, 0xff4fd8];

export function createRingsMode(): VizMode {
  let kit: SceneKit | null = null;
  let rings: THREE.Mesh[] = [];
  let arcs: THREE.Points[] = [];
  let head: THREE.Mesh | null = null;
  let raf = 0;
  let bus: MetricBus | null = null;
  let paused: () => boolean = () => false;
  let spin = 0;

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!kit || !bus)
      return;
    if (paused()) {
      kit.render();
      return;
    }

    const snap = bus.snapshot;
    const t = now / 1000;
    const focus = liveOrDemo(snap.updatedAt, snap.focus, 0.5 + 0.35 * Math.sin(t * 0.7));
    const calm = liveOrDemo(snap.updatedAt, snap.calm, 0.5 + 0.35 * Math.cos(t * 0.55));
    spin += (0.15 + focus * 0.9 + (1 - calm) * 0.35) * 0.016;

    for (let r = 0; r < RING_COUNT; r++) {
      const key = BAND_KEYS[r];
      const values = snap.bands[key];
      const mean = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : 0.25 + 0.2 * Math.sin(t * (1 + r * 0.3) + r);
      const power = liveOrDemo(snap.updatedAt, mean, 0.25 + 0.2 * Math.sin(t * (1 + r * 0.3) + r));

      const ring = rings[r];
      if (ring) {
        const radius = 0.7 + calm * 0.55 + r * 0.18 + power * 0.35;
        ring.scale.set(radius, 0.02 + power * 0.08 + focus * 0.04, radius);
        ring.rotation.y = spin * (1 + r * 0.12) * (r % 2 === 0 ? 1 : -1);
        ring.rotation.x = Math.sin(t * 0.2 + r) * 0.18 * (1 - calm);
        const mat = ring.material as THREE.MeshPhysicalMaterial;
        mat.emissiveIntensity = 0.2 + power * 1.6 + focus * 0.4;
        mat.roughness = 0.08 + (1 - power) * 0.25;
        mat.metalness = 0.55 + focus * 0.3;
      }

      const pts = arcs[r];
      if (pts) {
        const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
        const col = pts.geometry.attributes.color as THREE.BufferAttribute;
        const nChan = Math.max(1, snap.channelNames.length);
        for (let i = 0; i < PARTICLES_PER_RING; i++) {
          const a = (i / PARTICLES_PER_RING) * Math.PI * 2 + spin * (0.5 + r * 0.1);
          const chan = i % nChan;
          const local = liveOrDemo(
            snap.updatedAt,
            values[chan] ?? power,
            0.2 + 0.25 * Math.sin(t * 2 + i * 0.01 + r)
          );
          const status = snap.signalStatuses[chan] ?? "great";
          const q = status === "noContact" || status === "bad" ? 0.2 : status === "good" ? 0.7 : 1;
          const rad = 0.7 + calm * 0.55 + r * 0.18 + local * 0.5;
          const y = Math.sin(a * 3 + t + r) * (0.05 + local * 0.2);
          pos.setXYZ(i, Math.cos(a) * rad, y, Math.sin(a) * rad);
          const c = new THREE.Color(BAND_COLORS[r]);
          c.multiplyScalar((0.35 + local * 1.4) * q);
          col.setXYZ(i, c.r, c.g, c.b);
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        (pts.material as THREE.PointsMaterial).size = 0.025 + power * 0.04;
      }
    }

    if (head) {
      head.rotation.y = t * 0.1;
      const mat = head.material as THREE.MeshPhysicalMaterial;
      mat.transmission = 0.55 + calm * 0.3;
      mat.roughness = 0.1 + (1 - focus) * 0.2;
    }

    kit.setBloomBoost(0.55 + focus * 0.7);
    kit.camera.position.x = Math.sin(t * 0.12) * 0.45;
    kit.camera.position.y = 0.55 + (1 - calm) * 0.25;
    kit.camera.lookAt(0, 0.05, 0);
    kit.render();
  }

  return {
    id: "rings",
    label: "Rings",
    mount(ctx: VizContext) {
      bus = ctx.bus;
      paused = ctx.paused;
      ctx.container.innerHTML = "";
      kit = createPbrScene(ctx.container, {
        cameraPos: [0, 0.7, 4.0],
        bloomStrength: 0.9
      });

      head = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 64, 48),
        physicalShellMaterial(0x9ec2ff, { transmission: 0.78, opacity: 0.88 })
      );
      kit.scene.add(head);

      rings = [];
      arcs = [];
      for (let r = 0; r < RING_COUNT; r++) {
        const torus = new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.025, 16, SEGMENTS),
          new THREE.MeshPhysicalMaterial({
            color: BAND_COLORS[r],
            emissive: BAND_COLORS[r],
            emissiveIntensity: 0.4,
            metalness: 0.7,
            roughness: 0.15,
            clearcoat: 1,
            clearcoatRoughness: 0.08,
            transparent: true,
            opacity: 0.85,
            envMapIntensity: 1.6
          })
        );
        rings.push(torus);
        kit.scene.add(torus);

        const positions = new Float32Array(PARTICLES_PER_RING * 3);
        const colors = new Float32Array(PARTICLES_PER_RING * 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const pts = new THREE.Points(
          geo,
          new THREE.PointsMaterial({
            size: 0.03,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          })
        );
        arcs.push(pts);
        kit.scene.add(pts);
      }

      raf = requestAnimationFrame(frame);
    },
    unmount() {
      cancelAnimationFrame(raf);
      for (const r of rings) {
        r.geometry.dispose();
        (r.material as THREE.Material).dispose();
      }
      for (const a of arcs) {
        a.geometry.dispose();
        (a.material as THREE.Material).dispose();
      }
      head?.geometry.dispose();
      (head?.material as THREE.Material | undefined)?.dispose();
      kit?.dispose();
      kit = null;
      rings = [];
      arcs = [];
      head = null;
      bus = null;
    },
    setSize(width: number, height: number) {
      kit?.setSize(width, height);
    }
  };
}
