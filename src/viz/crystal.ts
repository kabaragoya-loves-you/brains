import * as THREE from "three";
import { channelPosition } from "../metrics-bus.js";
import type { MetricBus } from "../metrics-bus.js";
import { createPbrScene, liveOrDemo, physicalShellMaterial, type SceneKit } from "./scene-kit.js";
import type { VizContext, VizMode } from "./types.js";

function icosahedronEdges(detail: number): { vertices: THREE.Vector3[]; edges: Array<[number, number]> } {
  const geo = new THREE.IcosahedronGeometry(1.4, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const vertices: THREE.Vector3[] = [];
  const keyOf = (v: THREE.Vector3) =>
    `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
  const indexOf = new Map<string, number>();
  const edgesSet = new Set<string>();
  const edges: Array<[number, number]> = [];

  const addVertex = (v: THREE.Vector3) => {
    const k = keyOf(v);
    let idx = indexOf.get(k);
    if (idx == null) {
      idx = vertices.length;
      indexOf.set(k, idx);
      vertices.push(v.clone());
    }
    return idx;
  };

  const addEdge = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const k = `${lo}-${hi}`;
    if (edgesSet.has(k))
      return;
    edgesSet.add(k);
    edges.push([lo, hi]);
  };

  for (let i = 0; i < pos.count; i += 3) {
    const a = addVertex(new THREE.Vector3().fromBufferAttribute(pos, i));
    const b = addVertex(new THREE.Vector3().fromBufferAttribute(pos, i + 1));
    const c = addVertex(new THREE.Vector3().fromBufferAttribute(pos, i + 2));
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  geo.dispose();
  return { vertices, edges };
}

export function createCrystalMode(): VizMode {
  let kit: SceneKit | null = null;
  let line: THREE.LineSegments | null = null;
  let nodes: THREE.Points | null = null;
  let shell: THREE.Mesh | null = null;
  let raf = 0;
  let baseVerts: THREE.Vector3[] = [];
  let edges: Array<[number, number]> = [];
  let positions: Float32Array | null = null;
  let colors: Float32Array | null = null;
  let nodePos: Float32Array | null = null;
  let nodeCol: Float32Array | null = null;
  let bus: MetricBus | null = null;
  let paused: () => boolean = () => false;

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!kit || !bus || !line || !positions || !colors || !nodePos || !nodeCol || !nodes)
      return;
    if (paused()) {
      kit.render();
      return;
    }

    const snap = bus.snapshot;
    const t = now / 1000;
    const focus = liveOrDemo(snap.updatedAt, snap.focus, 0.5 + 0.3 * Math.sin(t * 0.7));
    const calm = liveOrDemo(snap.updatedAt, snap.calm, 0.5 + 0.3 * Math.cos(t * 0.5));
    const mean = (arr: number[], fb: number) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : fb;
    const alpha = liveOrDemo(snap.updatedAt, mean(snap.bands.alpha, 0.3), 0.3 + 0.2 * Math.sin(t));
    const beta = liveOrDemo(snap.updatedAt, mean(snap.bands.beta, 0.3), 0.3 + 0.2 * Math.cos(t * 1.4));
    const gamma = liveOrDemo(snap.updatedAt, mean(snap.bands.gamma, 0.2), 0.2 + 0.2 * Math.sin(t * 2.1));

    // crude cross-channel "coherence" proxy
    let coherence = 0.4;
    if (snap.updatedAt && snap.bands.alpha.length > 1) {
      const arr = snap.bands.alpha;
      const m = mean(arr, 0);
      let varSum = 0;
      for (const v of arr)
        varSum += (v - m) * (v - m);
      const std = Math.sqrt(varSum / arr.length);
      coherence = Math.max(0.05, Math.min(1, 1 - std / (m + 0.15)));
    } else {
      coherence = 0.45 + 0.35 * Math.sin(t * 0.35);
    }

    const displaced: THREE.Vector3[] = baseVerts.map((v, i) => {
      const raw = snap.rawMeans[i % Math.max(1, snap.rawMeans.length)] ?? 0;
      const wobble = liveOrDemo(
        snap.updatedAt,
        raw * 0.002,
        Math.sin(t * 2 + i) * 0.04
      );
      const pulse = 1 + beta * 0.12 + gamma * 0.18 + Math.sin(t * 1.5 + i * 0.2) * 0.03;
      return v.clone().multiplyScalar(pulse).addScaledVector(v.clone().normalize(), wobble);
    });

    // map a few vertices toward electrode sites for spatial meaning
    for (let c = 0; c < Math.min(8, displaced.length); c++) {
      const name = snap.channelNames[c] ?? `ch${c}`;
      const [ex, ey, ez] = channelPosition(name, c);
      const target = new THREE.Vector3(ex, ey, ez).multiplyScalar(1.35);
      displaced[c].lerp(target, 0.15 + focus * 0.2);
    }

    let ei = 0;
    for (const [a, b] of edges) {
      const va = displaced[a];
      const vb = displaced[b];
      positions[ei] = va.x;
      positions[ei + 1] = va.y;
      positions[ei + 2] = va.z;
      positions[ei + 3] = vb.x;
      positions[ei + 4] = vb.y;
      positions[ei + 5] = vb.z;
      const glow = (0.25 + coherence * 1.1 + alpha * 0.4) * (0.5 + focus);
      colors[ei] = 0.35 + coherence * 0.5;
      colors[ei + 1] = 0.55 + alpha * 0.4;
      colors[ei + 2] = 0.95;
      colors[ei + 3] = colors[ei] * glow;
      colors[ei + 4] = colors[ei + 1] * glow;
      colors[ei + 5] = colors[ei + 2] * glow;
      // actually set both ends similarly
      colors[ei] *= glow;
      colors[ei + 1] *= glow;
      colors[ei + 2] *= glow;
      colors[ei + 3] = 0.2 + beta * 0.8;
      colors[ei + 4] = 0.4 + calm * 0.5;
      colors[ei + 5] = 0.9 * glow;
      ei += 6;
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.attributes.color.needsUpdate = true;

    for (let i = 0; i < displaced.length; i++) {
      nodePos[i * 3] = displaced[i].x;
      nodePos[i * 3 + 1] = displaced[i].y;
      nodePos[i * 3 + 2] = displaced[i].z;
      nodeCol[i * 3] = 0.6 + focus * 0.4;
      nodeCol[i * 3 + 1] = 0.7 + calm * 0.3;
      nodeCol[i * 3 + 2] = 1;
    }
    nodes.geometry.attributes.position.needsUpdate = true;
    nodes.geometry.attributes.color.needsUpdate = true;

    if (shell) {
      shell.rotation.y = t * (0.08 + (1 - calm) * 0.12);
      const mat = shell.material as THREE.MeshPhysicalMaterial;
      mat.roughness = 0.08 + (1 - coherence) * 0.35;
      mat.metalness = 0.2 + coherence * 0.55;
      mat.transmission = 0.45 + calm * 0.35;
      mat.emissiveIntensity = 0.05 + gamma * 0.5;
    }

    kit.setBloomBoost(0.5 + coherence * 0.7 + focus * 0.35);
    kit.camera.position.x = Math.sin(t * 0.13) * 0.5;
    kit.camera.position.y = 0.65 + (1 - calm) * 0.2;
    kit.camera.lookAt(0, 0.05, 0);
    kit.render();
  }

  return {
    id: "crystal",
    label: "Crystal",
    mount(ctx: VizContext) {
      bus = ctx.bus;
      paused = ctx.paused;
      ctx.container.innerHTML = "";
      kit = createPbrScene(ctx.container, {
        cameraPos: [0, 0.8, 4.2],
        bloomStrength: 0.8
      });

      const built = icosahedronEdges(1);
      baseVerts = built.vertices;
      edges = built.edges;

      positions = new Float32Array(edges.length * 2 * 3);
      colors = new Float32Array(edges.length * 2 * 3);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      lineGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      line = new THREE.LineSegments(
        lineGeo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      kit.scene.add(line);

      nodePos = new Float32Array(baseVerts.length * 3);
      nodeCol = new Float32Array(baseVerts.length * 3);
      const nodeGeo = new THREE.BufferGeometry();
      nodeGeo.setAttribute("position", new THREE.BufferAttribute(nodePos, 3));
      nodeGeo.setAttribute("color", new THREE.BufferAttribute(nodeCol, 3));
      nodes = new THREE.Points(
        nodeGeo,
        new THREE.PointsMaterial({
          size: 0.06,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      kit.scene.add(nodes);

      shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.55, 1),
        physicalShellMaterial(0xb0d4ff, {
          metalness: 0.35,
          roughness: 0.18,
          transmission: 0.7,
          opacity: 0.55
        })
      );
      shell.material.emissive = new THREE.Color(0x224466);
      shell.material.emissiveIntensity = 0.1;
      kit.scene.add(shell);

      raf = requestAnimationFrame(frame);
    },
    unmount() {
      cancelAnimationFrame(raf);
      line?.geometry.dispose();
      (line?.material as THREE.Material | undefined)?.dispose();
      nodes?.geometry.dispose();
      (nodes?.material as THREE.Material | undefined)?.dispose();
      shell?.geometry.dispose();
      (shell?.material as THREE.Material | undefined)?.dispose();
      kit?.dispose();
      kit = null;
      line = nodes = shell = null;
      positions = colors = nodePos = nodeCol = null;
      baseVerts = [];
      edges = [];
      bus = null;
    },
    setSize(width: number, height: number) {
      kit?.setSize(width, height);
    }
  };
}
