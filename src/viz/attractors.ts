import * as THREE from "three";
import type { MetricBus } from "../metrics-bus.js";
import { createPbrScene, physicalShellMaterial, type SceneKit } from "./scene-kit.js";
import type { VizContext, VizMode } from "./types.js";

const COUNT = 16000;
const SOFT = 0.55; // soft-core radius so particles don't collapse into the balls
const ATTR_R = 0.42; // bounce radius around each attractor

function bounceShell(
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  r: number, ax: number, ay: number, az: number
): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
  const ox = x - ax;
  const oy = y - ay;
  const oz = z - az;
  const d2 = ox * ox + oy * oy + oz * oz;
  if (d2 >= r * r || d2 < 1e-8)
    return { x, y, z, vx, vy, vz };
  const d = Math.sqrt(d2);
  const nx = ox / d;
  const ny = oy / d;
  const nz = oz / d;
  x = ax + nx * r;
  y = ay + ny * r;
  z = az + nz * r;
  const vn = vx * nx + vy * ny + vz * nz;
  if (vn < 0) {
    vx -= 1.6 * vn * nx;
    vy -= 1.6 * vn * ny;
    vz -= 1.6 * vn * nz;
  }
  return { x, y, z, vx, vy, vz };
}

export function createAttractorsMode(): VizMode {
  let kit: SceneKit | null = null;
  let points: THREE.Points | null = null;
  let focusMesh: THREE.Mesh | null = null;
  let calmMesh: THREE.Mesh | null = null;
  let raf = 0;
  let positions: Float32Array | null = null;
  let colors: Float32Array | null = null;
  let velocities: Float32Array | null = null;
  let bus: MetricBus | null = null;
  let paused: () => boolean = () => false;
  let t0 = performance.now();

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
    // Keep both wells alive so one side never vacuum-cleans the field.
    const focus = 0.22 + snap.focus * 0.78;
    const calm = 0.22 + snap.calm * 0.78;

    const fX = 1.35;
    const fY = 0.15;
    const fZ = 0;
    const cX = -1.35;
    const cY = 0.15;
    const cZ = 0;
    const tiltX = snap.accel.x * 0.35;
    const tiltZ = snap.accel.z * 0.15 - 0.15;

    if (focusMesh && calmMesh) {
      focusMesh.scale.setScalar(0.35 + snap.focus * 0.75);
      calmMesh.scale.setScalar(0.35 + snap.calm * 0.75);
      const fMat = focusMesh.material as THREE.MeshPhysicalMaterial;
      const cMat = calmMesh.material as THREE.MeshPhysicalMaterial;
      fMat.emissiveIntensity = 0.15 + snap.focus * 1.4;
      cMat.emissiveIntensity = 0.15 + snap.calm * 1.4;
      fMat.roughness = 0.08 + (1 - snap.focus) * 0.3;
      cMat.roughness = 0.08 + (1 - snap.calm) * 0.3;
      fMat.metalness = 0.35 + snap.focus * 0.45;
      cMat.metalness = 0.35 + snap.calm * 0.45;
    }

    for (let i = 0; i < COUNT; i++) {
      const ix = i * 3;
      let x = positions[ix];
      let y = positions[ix + 1];
      let z = positions[ix + 2];
      let vx = velocities[ix];
      let vy = velocities[ix + 1];
      let vz = velocities[ix + 2];

      // Soft-core 1/r^2: force peaks away from the core, then falls to zero inside.
      const dfX = fX - x;
      const dfY = fY - y;
      const dfZ = fZ - z;
      const dF2 = dfX * dfX + dfY * dfY + dfZ * dfZ;
      const dF = Math.sqrt(dF2) + 1e-4;
      const fMag = (focus * 1.15) * dF / Math.pow(dF2 + SOFT * SOFT, 1.5);

      const dcX = cX - x;
      const dcY = cY - y;
      const dcZ = cZ - z;
      const dC2 = dcX * dcX + dcY * dcY + dcZ * dcZ;
      const dC = Math.sqrt(dC2) + 1e-4;
      const cMag = (calm * 1.15) * dC / Math.pow(dC2 + SOFT * SOFT, 1.5);

      // Tangential swirl so particles orbit instead of diving in.
      const swirl = 0.35 + (focus + calm) * 0.25;
      const fTx = -dfZ / dF;
      const fTz = dfX / dF;
      const cTx = -dcZ / dC;
      const cTz = dcX / dC;

      vx += (dfX * fMag + dcX * cMag + (fTx * focus + cTx * calm) * swirl + tiltX) * dt;
      vy += (dfY * fMag + dcY * cMag + 0.04 * Math.sin(time * 1.3 + i * 0.01)) * dt;
      vz += (dfZ * fMag + dcZ * cMag + (fTz * focus + cTz * calm) * swirl + tiltZ) * dt;

      // Mild noise / dispersion so clumps break apart.
      vx += (Math.sin(time * 2.1 + i * 0.17) * 0.08) * dt;
      vz += (Math.cos(time * 1.7 + i * 0.13) * 0.08) * dt;

      vx *= 0.985;
      vy *= 0.985;
      vz *= 0.985;
      x += vx * dt * 10;
      y += vy * dt * 10;
      z += vz * dt * 10;

      // Soft bounce off each attractor shell.
      ({ x, y, z, vx, vy, vz } = bounceShell(x, y, z, vx, vy, vz, ATTR_R, fX, fY, fZ));
      ({ x, y, z, vx, vy, vz } = bounceShell(x, y, z, vx, vy, vz, ATTR_R, cX, cY, cZ));

      const r2 = x * x + y * y + z * z;
      if (r2 > 14) {
        const s = 3.6 / Math.sqrt(r2);
        x *= s;
        y *= s;
        z *= s;
        vx *= -0.35;
        vy *= -0.35;
        vz *= -0.35;
      }

      if (y < -0.95) {
        y = -0.95;
        vy = Math.abs(vy) * 0.55;
      }

      positions[ix] = x;
      positions[ix + 1] = y;
      positions[ix + 2] = z;
      velocities[ix] = vx;
      velocities[ix + 1] = vy;
      velocities[ix + 2] = vz;

      const vote = focus / (focus + calm + 0.001);
      colors[ix] = 0.2 + vote * 0.9;
      colors[ix + 1] = 0.45 + (1 - vote) * 0.4;
      colors[ix + 2] = 0.95 - vote * 0.55;
    }

    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.attributes.color.needsUpdate = true;
    kit.camera.position.x = Math.sin(time * 0.12) * 0.4 + tiltX;
    kit.camera.position.y = 0.85 + tiltZ * 0.5;
    kit.camera.lookAt(0, 0.1, 0);
    kit.render();
  }

  return {
    id: "attractors",
    label: "Attractors",
    mount(ctx: VizContext) {
      bus = ctx.bus;
      paused = ctx.paused;
      ctx.container.innerHTML = "";
      kit = createPbrScene(ctx.container, {
        cameraPos: [0, 0.9, 4.4],
        fov: 55
      });

      focusMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 48, 32),
        physicalShellMaterial(0xff6b4a, {
          metalness: 0.55,
          roughness: 0.15,
          transmission: 0.35,
          opacity: 0.92
        })
      );
      focusMesh.material.emissive = new THREE.Color(0xff4020);
      focusMesh.material.emissiveIntensity = 0.4;
      focusMesh.position.set(1.35, 0.15, 0);

      calmMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 48, 32),
        physicalShellMaterial(0x4ad2ff, {
          metalness: 0.55,
          roughness: 0.15,
          transmission: 0.35,
          opacity: 0.92
        })
      );
      calmMesh.material.emissive = new THREE.Color(0x2080ff);
      calmMesh.material.emissiveIntensity = 0.4;
      calmMesh.position.set(-1.35, 0.15, 0);
      kit.scene.add(focusMesh, calmMesh);

      positions = new Float32Array(COUNT * 3);
      colors = new Float32Array(COUNT * 3);
      velocities = new Float32Array(COUNT * 3);
      for (let i = 0; i < COUNT; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 4;
        positions[i * 3 + 1] = Math.random() * 1.5;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 4;
        velocities[i * 3] = (Math.random() - 0.5) * 0.4;
        velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
        colors[i * 3] = 0.5;
        colors[i * 3 + 1] = 0.7;
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
      focusMesh?.geometry.dispose();
      (focusMesh?.material as THREE.Material | undefined)?.dispose();
      calmMesh?.geometry.dispose();
      (calmMesh?.material as THREE.Material | undefined)?.dispose();
      kit?.dispose();
      kit = null;
      points = focusMesh = calmMesh = null;
      positions = colors = velocities = null;
      bus = null;
    },
    setSize(width: number, height: number) {
      kit?.setSize(width, height);
    }
  };
}
