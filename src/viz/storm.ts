import * as THREE from "three";
import type { MetricBus } from "../metrics-bus.js";
import { createPbrScene, liveOrDemo, type SceneKit } from "./scene-kit.js";
import type { VizContext, VizMode } from "./types.js";

const COUNT = 22000;

function curlNoise(x: number, y: number, z: number, t: number): THREE.Vector3 {
  // Cheap analytic curl-ish field
  const e = 0.15;
  const n1 = Math.sin(y * 1.3 + t) * Math.cos(z * 1.1 - t * 0.7);
  const n2 = Math.sin(z * 1.4 - t * 0.5) * Math.cos(x * 1.2 + t * 0.3);
  const n3 = Math.sin(x * 1.2 + t * 0.9) * Math.cos(y * 1.5 - t * 0.4);
  const a = Math.sin((y + e) * 1.3 + t) * Math.cos(z * 1.1 - t * 0.7);
  const b = Math.sin(z * 1.4 - t * 0.5) * Math.cos((x + e) * 1.2 + t * 0.3);
  const c = Math.sin(x * 1.2 + t * 0.9) * Math.cos((y + e) * 1.5 - t * 0.4);
  return new THREE.Vector3((c - n3) - (b - n2), (a - n1) - (c - n3), (b - n2) - (a - n1));
}

export function createStormMode(): VizMode {
  let kit: SceneKit | null = null;
  let points: THREE.Points | null = null;
  let shock: THREE.Mesh | null = null;
  let raf = 0;
  let positions: Float32Array | null = null;
  let colors: Float32Array | null = null;
  let velocities: Float32Array | null = null;
  let bus: MetricBus | null = null;
  let paused: () => boolean = () => false;
  let t0 = performance.now();
  let lastFocus = 0.5;
  let shockLife = 0;

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!kit || !points || !bus || !positions || !colors || !velocities)
      return;
    if (paused()) {
      kit.render();
      return;
    }

    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    const snap = bus.snapshot;
    const time = now / 1000;
    const focus = liveOrDemo(snap.updatedAt, snap.focus, 0.5 + 0.4 * Math.sin(time * 0.6));
    const calm = liveOrDemo(snap.updatedAt, snap.calm, 0.5 + 0.35 * Math.cos(time * 0.45));
    const meanBand = (arr: number[], fallback: number) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : fallback;
    const delta = liveOrDemo(snap.updatedAt, meanBand(snap.bands.delta, 0.3), 0.3 + 0.2 * Math.sin(time));
    const beta = liveOrDemo(snap.updatedAt, meanBand(snap.bands.beta, 0.3), 0.3 + 0.2 * Math.cos(time * 1.3));
    const gamma = liveOrDemo(snap.updatedAt, meanBand(snap.bands.gamma, 0.2), 0.2 + 0.2 * Math.sin(time * 2));

    if (focus - lastFocus > 0.12)
      shockLife = 1;
    lastFocus = focus;
    shockLife = Math.max(0, shockLife - dt * 0.85);

    if (shock) {
      const s = 0.4 + (1 - shockLife) * 4.5;
      shock.scale.setScalar(s);
      const mat = shock.material as THREE.MeshBasicMaterial;
      mat.opacity = shockLife * 0.45;
      shock.visible = shockLife > 0.02;
    }

    const turb = 0.35 + delta * 0.5 + beta * 0.8 + gamma * 1.1 + (1 - calm) * 0.7;
    const laminar = 0.15 + calm * 0.85;

    for (let i = 0; i < COUNT; i++) {
      const ix = i * 3;
      let x = positions[ix];
      let y = positions[ix + 1];
      let z = positions[ix + 2];
      let vx = velocities[ix];
      let vy = velocities[ix + 1];
      let vz = velocities[ix + 2];

      const field = curlNoise(x * 0.55, y * 0.55, z * 0.55, time * (0.4 + turb * 0.5));
      field.multiplyScalar(turb);

      // calm collapses toward laminar orbital flow
      const orbit = new THREE.Vector3(-z, 0.02, x).normalize().multiplyScalar(laminar * 0.8);
      vx += (field.x + orbit.x) * dt;
      vy += (field.y * 0.7 + orbit.y) * dt;
      vz += (field.z + orbit.z) * dt;

      if (shockLife > 0) {
        const dir = new THREE.Vector3(x, y, z);
        if (dir.lengthSq() > 0.0001) {
          dir.normalize().multiplyScalar(shockLife * 2.8);
          vx += dir.x * dt;
          vy += dir.y * dt;
          vz += dir.z * dt;
        }
      }

      vx *= 0.975;
      vy *= 0.975;
      vz *= 0.975;
      x += vx * dt * 10;
      y += vy * dt * 10;
      z += vz * dt * 10;

      const r2 = x * x + y * y + z * z;
      if (r2 > 16 || r2 < 0.04) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.4 + Math.random() * 1.6;
        x = Math.cos(a) * r;
        y = (Math.random() - 0.5) * 1.2;
        z = Math.sin(a) * r;
        vx = vy = vz = 0;
      }
      if (y < -0.95) {
        y = -0.95;
        vy = Math.abs(vy) * 0.5;
      }

      positions[ix] = x;
      positions[ix + 1] = y;
      positions[ix + 2] = z;
      velocities[ix] = vx;
      velocities[ix + 1] = vy;
      velocities[ix + 2] = vz;

      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      colors[ix] = 0.25 + speed * 1.8 + gamma * 0.5;
      colors[ix + 1] = 0.35 + calm * 0.5 + beta * 0.3;
      colors[ix + 2] = 0.85 + focus * 0.4 - gamma * 0.2;
    }

    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.attributes.color.needsUpdate = true;
    kit.setBloomBoost(0.7 + focus * 0.8 + shockLife);
    kit.camera.position.x = Math.sin(time * 0.14) * 0.6;
    kit.camera.position.y = 0.9 + (1 - calm) * 0.35;
    kit.camera.lookAt(0, 0.1, 0);
    kit.render();
  }

  return {
    id: "storm",
    label: "Storm",
    mount(ctx: VizContext) {
      bus = ctx.bus;
      paused = ctx.paused;
      ctx.container.innerHTML = "";
      kit = createPbrScene(ctx.container, {
        cameraPos: [0, 1.0, 4.6],
        bloomStrength: 1.1
      });

      shock = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 16),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          wireframe: true,
          depthWrite: false
        })
      );
      shock.visible = false;
      kit.scene.add(shock);

      positions = new Float32Array(COUNT * 3);
      colors = new Float32Array(COUNT * 3);
      velocities = new Float32Array(COUNT * 3);
      for (let i = 0; i < COUNT; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.3 + Math.random() * 2.2;
        positions[i * 3] = Math.cos(a) * r;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 1.6;
        positions[i * 3 + 2] = Math.sin(a) * r;
        colors[i * 3] = 0.4;
        colors[i * 3 + 1] = 0.6;
        colors[i * 3 + 2] = 1;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      points = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          size: 0.028,
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
      shock?.geometry.dispose();
      (shock?.material as THREE.Material | undefined)?.dispose();
      kit?.dispose();
      kit = null;
      points = shock = null;
      positions = colors = velocities = null;
      bus = null;
    },
    setSize(width: number, height: number) {
      kit?.setSize(width, height);
    }
  };
}
