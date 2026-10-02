import * as THREE from "three";
import { channelPosition, CHANNEL_POSITIONS, type MetricBus } from "../metrics-bus.js";
import { createPbrScene, physicalShellMaterial, type SceneKit } from "./scene-kit.js";
import type { VizContext, VizMode } from "./types.js";

const PARTICLE_COUNT = 14000;
const CHANNELS = 8;

type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  channel: number;
  size: number;
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function createFirefliesMode(): VizMode {
  let kit: SceneKit | null = null;
  let points: THREE.Points | null = null;
  let head: THREE.Mesh | null = null;
  let emitters: THREE.Mesh[] = [];
  let raf = 0;
  let particles: Particle[] = [];
  let positions: Float32Array | null = null;
  let colors: Float32Array | null = null;
  let bus: MetricBus | null = null;
  let paused: () => boolean = () => false;
  let t0 = performance.now();

  function spawn(channel: number, energy: number): void {
    if (!bus)
      return;
    const names = bus.snapshot.channelNames;
    const [px, py, pz] = channelPosition(names[channel] ?? `ch${channel}`, channel);
    const spread = 0.1 + energy * 0.18;
    const speed = 0.55 + energy * 1.6;
    particles.push({
      x: px + (Math.random() - 0.5) * spread,
      y: py + (Math.random() - 0.5) * spread,
      z: pz + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * speed,
      vy: 0.35 + Math.random() * speed,
      vz: (Math.random() - 0.5) * speed,
      life: 0,
      maxLife: 1.2 + Math.random() * 2.4,
      channel,
      size: 0.8 + energy
    });
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!kit || !points || !bus || !positions || !colors)
      return;
    if (paused()) {
      kit.render();
      return;
    }

    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    const snap = bus.snapshot;
    const focus = snap.focus;
    const calm = snap.calm;
    const time = now / 1000;

    for (let c = 0; c < CHANNELS; c++) {
      const alpha = clamp01((snap.bands.alpha[c] ?? 0.25) * 0.55);
      const beta = clamp01((snap.bands.beta[c] ?? 0.2) * 0.45);
      const gamma = clamp01((snap.bands.gamma[c] ?? 0.15) * 0.4);
      const energy = clamp01(0.2 + alpha * 0.35 + beta * 0.55 + gamma * 0.7 + focus * 0.25);
      const status = snap.signalStatuses[c] ?? "good";
      const qualityMul =
        status === "noContact" ? 0.35 :
        status === "bad" ? 0.55 :
        status === "good" ? 0.85 : 1;
      // Aim for a lively fountain even at modest band levels.
      const rate = (18 + energy * 55) * (0.45 + focus * 0.7) * qualityMul * dt;
      let budget = rate;
      while (budget > 1 && particles.length < PARTICLE_COUNT) {
        spawn(c, energy);
        budget -= 1;
      }
      if (budget > 0 && particles.length < PARTICLE_COUNT && Math.random() < budget)
        spawn(c, energy);

      const emitter = emitters[c];
      if (emitter) {
        const mat = emitter.material as THREE.MeshPhysicalMaterial;
        mat.emissiveIntensity = 0.35 + energy * 2.2;
        mat.roughness = 0.12 + (1 - qualityMul) * 0.45;
        emitter.scale.setScalar(0.85 + energy * 0.9);
      }
    }

    while (particles.length > PARTICLE_COUNT)
      particles.shift();

    const drag = 0.08 + calm * 0.28;
    let i = 0;
    for (const p of particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - drag * dt;
      p.vy *= 1 - drag * dt * 0.45;
      p.vz *= 1 - drag * dt;
      p.vy += (0.12 + focus * 0.35) * dt;
      // Soft outward drift away from skull center.
      p.vx += p.x * 0.15 * dt;
      p.vz += p.z * 0.15 * dt;

      const age = p.life / p.maxLife;
      const a = Math.max(0, 1 - age * age);
      const bands = snap.bands;
      const cool = (bands.alpha[p.channel] ?? 0.2) + (bands.theta[p.channel] ?? 0);
      const hot = (bands.beta[p.channel] ?? 0.2) + (bands.gamma[p.channel] ?? 0) * 1.4;
      const mix = hot / (cool + hot + 0.001);

      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      const glow = (0.55 + focus * 0.9 + p.size * 0.15) * a;
      colors[i * 3] = (0.3 + mix * 0.85) * glow;
      colors[i * 3 + 1] = (0.6 + (1 - mix) * 0.4) * glow;
      colors[i * 3 + 2] = (1.05 - mix * 0.5) * glow;
      i++;
    }

    particles = particles.filter((p) => p.life < p.maxLife);
    const geo = points.geometry;
    geo.setDrawRange(0, i);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    (points.material as THREE.PointsMaterial).size = 0.045 + focus * 0.025;

    if (head) {
      head.rotation.y = time * (0.08 + (1 - calm) * 0.12);
      const mat = head.material as THREE.MeshPhysicalMaterial;
      mat.roughness = 0.12 + calm * 0.25;
      mat.metalness = 0.05 + focus * 0.2;
      mat.transmission = 0.62 + calm * 0.2;
      mat.opacity = 0.78;
    }

    kit.camera.position.x = Math.sin(time * 0.15) * 0.45;
    kit.camera.position.y = 0.55;
    kit.camera.lookAt(0, 0.25, 0);
    kit.render();
  }

  return {
    id: "fireflies",
    label: "Fireflies",
    mount(ctx: VizContext) {
      bus = ctx.bus;
      paused = ctx.paused;
      ctx.container.innerHTML = "";
      kit = createPbrScene(ctx.container, { cameraPos: [0, 0.55, 3.5] });

      head = new THREE.Mesh(
        new THREE.SphereGeometry(1.05, 64, 48),
        physicalShellMaterial(0x9ec2ff, {
          metalness: 0.12,
          roughness: 0.2,
          transmission: 0.72,
          opacity: 0.82
        })
      );
      kit.scene.add(head);

      emitters = [];
      const names = Object.keys(CHANNEL_POSITIONS);
      for (let c = 0; c < CHANNELS; c++) {
        const name = names[c] ?? `ch${c}`;
        const [x, y, z] = channelPosition(name, c);
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 16, 12),
          new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            emissive: 0x88bbff,
            emissiveIntensity: 0.6,
            metalness: 0.7,
            roughness: 0.2,
            clearcoat: 1,
            clearcoatRoughness: 0.1,
            envMapIntensity: 1.5
          })
        );
        mesh.position.set(x, y, z);
        emitters.push(mesh);
        kit.scene.add(mesh);
      }

      positions = new Float32Array(PARTICLE_COUNT * 3);
      colors = new Float32Array(PARTICLE_COUNT * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.setDrawRange(0, 0);
      points = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          size: 0.05,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true
        })
      );
      kit.scene.add(points);

      particles = [];
      for (let n = 0; n < 500; n++)
        spawn(n % CHANNELS, 0.55);
      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    },
    unmount() {
      cancelAnimationFrame(raf);
      points?.geometry.dispose();
      (points?.material as THREE.Material | undefined)?.dispose();
      head?.geometry.dispose();
      (head?.material as THREE.Material | undefined)?.dispose();
      for (const e of emitters) {
        e.geometry.dispose();
        (e.material as THREE.Material).dispose();
      }
      emitters = [];
      kit?.dispose();
      kit = null;
      points = null;
      head = null;
      particles = [];
      positions = null;
      colors = null;
      bus = null;
    },
    setSize(width: number, height: number) {
      kit?.setSize(width, height);
    }
  };
}
