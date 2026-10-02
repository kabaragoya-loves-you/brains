import * as THREE from "three";
import type { MetricBus } from "../metrics-bus.js";
import { createPbrScene, liveOrDemo, type SceneKit } from "./scene-kit.js";
import type { VizContext, VizMode } from "./types.js";

const FOG_COUNT = 12000;
const BOLT_MAX = 6;

type Bolt = {
  life: number;
  points: THREE.Vector3[];
  mesh: THREE.Line;
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function createWeatherMode(): VizMode {
  let kit: SceneKit | null = null;
  let fog: THREE.Points | null = null;
  let shafts: THREE.Mesh[] = [];
  let bolts: Bolt[] = [];
  let raf = 0;
  let positions: Float32Array | null = null;
  let colors: Float32Array | null = null;
  let bus: MetricBus | null = null;
  let paused: () => boolean = () => false;
  let t0 = performance.now();
  let boltCooldown = 0;

  function spawnBolt(energy: number): void {
    if (!kit)
      return;
    const origin = new THREE.Vector3(
      (Math.random() - 0.5) * 2.4,
      3.4 + Math.random() * 1.2,
      (Math.random() - 0.5) * 2.4 - 1.5
    );
    const points: THREE.Vector3[] = [origin.clone()];
    let p = origin.clone();
    const steps = 12 + Math.floor(energy * 10);
    for (let i = 0; i < steps; i++) {
      p = p.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.55,
          -0.28 - Math.random() * 0.22,
          (Math.random() - 0.5) * 0.55
        )
      );
      points.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mesh = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: 0xe8f6ff,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    kit.scene.add(mesh);
    bolts.push({ life: 0.28 + energy * 0.3, points, mesh });
    while (bolts.length > BOLT_MAX) {
      const old = bolts.shift();
      if (!old)
        break;
      kit.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      (old.mesh.material as THREE.Material).dispose();
    }
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!kit || !bus || !fog || !positions || !colors)
      return;
    if (paused()) {
      kit.render();
      return;
    }

    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    const snap = bus.snapshot;
    const t = now / 1000;
    const focus = liveOrDemo(snap.updatedAt, snap.focus, 0.5 + 0.35 * Math.sin(t * 0.55));
    const calm = liveOrDemo(snap.updatedAt, snap.calm, 0.5 + 0.35 * Math.cos(t * 0.4));
    const mean = (arr: number[], fb: number) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : fb;
    const delta = clamp01(liveOrDemo(snap.updatedAt, mean(snap.bands.delta, 0.35), 0.35 + 0.2 * Math.sin(t * 0.3)));
    const theta = clamp01(liveOrDemo(snap.updatedAt, mean(snap.bands.theta, 0.3), 0.3 + 0.2 * Math.cos(t * 0.5)));
    const alpha = clamp01(liveOrDemo(snap.updatedAt, mean(snap.bands.alpha, 0.35), 0.35 + 0.2 * Math.sin(t * 0.8)));
    const beta = clamp01(liveOrDemo(snap.updatedAt, mean(snap.bands.beta, 0.3), 0.3 + 0.25 * Math.sin(t * 1.6)));
    const gamma = clamp01(liveOrDemo(snap.updatedAt, mean(snap.bands.gamma, 0.2), 0.2 + 0.25 * Math.cos(t * 2.2)));

    const dens = 0.25 + delta * 0.55;
    const undulate = 0.15 + theta * 0.7;
    const tiltX = snap.accel.x * 0.35;
    const tiltZ = (snap.accel.z - 1) * 0.2;

    for (let i = 0; i < FOG_COUNT; i++) {
      const ix = i * 3;
      let x = positions[ix];
      let y = positions[ix + 1];
      let z = positions[ix + 2];
      y += Math.sin(t * undulate + x * 0.45 + z * 0.3) * 0.008 * dens;
      x += Math.sin(t * 0.18 + z) * 0.0035 * (1 - calm);
      z += Math.cos(t * 0.16 + x) * 0.0035 * (1 - calm);
      if (y > 4.5)
        y = -0.4;
      if (y < -0.6)
        y = 4.2;
      if (Math.abs(x) > 7)
        x *= -0.92;
      if (Math.abs(z) > 7)
        z *= -0.92;
      positions[ix] = x;
      positions[ix + 1] = y;
      positions[ix + 2] = z;
      const h = (y + 0.5) / 5;
      const glow = dens * (0.35 + h * 0.45);
      colors[ix] = (0.22 + alpha * 0.28) * glow;
      colors[ix + 1] = (0.32 + calm * 0.28) * glow;
      colors[ix + 2] = (0.42 + (1 - focus) * 0.28) * glow;
    }
    fog.geometry.attributes.position.needsUpdate = true;
    fog.geometry.attributes.color.needsUpdate = true;
    (fog.material as THREE.PointsMaterial).opacity = 0.22 + dens * 0.28;
    (fog.material as THREE.PointsMaterial).size = 0.04 + dens * 0.03;

    for (let s = 0; s < shafts.length; s++) {
      const shaft = shafts[s];
      shaft.rotation.z = Math.sin(t * 0.25 + s) * 0.12 * (1 - calm) + tiltX * 0.15;
      shaft.rotation.x = tiltZ * 0.25;
      shaft.position.x = Math.sin(t * 0.12 + s * 1.7) * (1.1 + alpha * 0.6);
      const mat = shaft.material as THREE.MeshPhysicalMaterial;
      mat.opacity = 0.03 + alpha * 0.1 * calm;
      mat.emissiveIntensity = 0.08 + alpha * 0.35;
    }

    boltCooldown -= dt;
    const storminess = clamp01(beta * 0.55 + gamma * 0.9 + focus * 0.35);
    if (boltCooldown <= 0 && storminess > 0.4) {
      spawnBolt(storminess);
      boltCooldown = 0.7 + Math.random() * (2.2 - storminess) + calm * 1.1;
    }

    bolts = bolts.filter((b) => {
      b.life -= dt;
      const mat = b.mesh.material as THREE.LineBasicMaterial;
      mat.opacity = Math.max(0, b.life * 1.6);
      if (b.life <= 0) {
        kit!.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        mat.dispose();
        return false;
      }
      return true;
    });

    if (kit.scene.fog && kit.scene.fog instanceof THREE.FogExp2)
      kit.scene.fog.density = 0.018 + delta * 0.025;

    // Keep bloom gentle — storm flashes shouldn't white-out the frame.
    kit.setBloomBoost(0.4 + storminess * 0.35 + (bolts.length ? 0.12 : 0));
    kit.camera.position.x = Math.sin(t * 0.08) * 1.1 + tiltX * 0.5;
    kit.camera.position.y = 2.6 + calm * 0.6;
    kit.camera.position.z = 8.4;
    kit.camera.lookAt(0, 0.9, -0.6);
    kit.render();
  }

  return {
    id: "weather",
    label: "Weather",
    mount(ctx: VizContext) {
      bus = ctx.bus;
      paused = ctx.paused;
      ctx.container.innerHTML = "";
      kit = createPbrScene(ctx.container, {
        cameraPos: [0, 2.8, 8.6],
        fov: 48,
        bloomStrength: 0.55
      });

      positions = new Float32Array(FOG_COUNT * 3);
      colors = new Float32Array(FOG_COUNT * 3);
      for (let i = 0; i < FOG_COUNT; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 12;
        positions[i * 3 + 1] = Math.random() * 4.2 - 0.2;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 12 - 1;
        colors[i * 3] = 0.25;
        colors[i * 3 + 1] = 0.32;
        colors[i * 3 + 2] = 0.42;
      }
      const fogGeo = new THREE.BufferGeometry();
      fogGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      fogGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      fog = new THREE.Points(
        fogGeo,
        new THREE.PointsMaterial({
          size: 0.055,
          vertexColors: true,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      kit.scene.add(fog);

      shafts = [];
      for (let i = 0; i < 5; i++) {
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.4, 5.5, 16, 1, true),
          new THREE.MeshPhysicalMaterial({
            color: 0xfff2d0,
            emissive: 0xffe6a8,
            emissiveIntensity: 0.15,
            transparent: true,
            opacity: 0.06,
            roughness: 0.4,
            metalness: 0,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        shaft.position.set((i - 2) * 1.15, 1.8, -1.2);
        shafts.push(shaft);
        kit.scene.add(shaft);
      }

      const horizon = new THREE.Mesh(
        new THREE.TorusGeometry(5.5, 0.035, 12, 128),
        new THREE.MeshPhysicalMaterial({
          color: 0x88aacc,
          metalness: 1,
          roughness: 0.12,
          emissive: 0x223344,
          emissiveIntensity: 0.3,
          clearcoat: 1
        })
      );
      horizon.rotation.x = Math.PI / 2;
      horizon.position.y = -0.85;
      kit.scene.add(horizon);

      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    },
    unmount() {
      cancelAnimationFrame(raf);
      fog?.geometry.dispose();
      (fog?.material as THREE.Material | undefined)?.dispose();
      for (const s of shafts) {
        s.geometry.dispose();
        (s.material as THREE.Material).dispose();
      }
      for (const b of bolts) {
        kit?.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
      }
      bolts = [];
      shafts = [];
      kit?.dispose();
      kit = null;
      fog = null;
      positions = colors = null;
      bus = null;
    },
    setSize(width: number, height: number) {
      kit?.setSize(width, height);
    }
  };
}
