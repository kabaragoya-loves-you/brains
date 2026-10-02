import * as THREE from "three";
import {
  paletteForHour,
  sunAltitude,
  worldClock,
  type SkyPaletteRaw
} from "./world-clock.js";

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, z: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    sum += noise2(x * freq, z * freq) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

export type DesertWorld = {
  root: THREE.Group;
  applyHour: (hour: number) => void;
  dispose: () => void;
  setLights: (hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight, moon: THREE.DirectionalLight) => void;
};

export function createDesertWorld(scene: THREE.Scene): DesertWorld {
  const root = new THREE.Group();
  root.name = "desertWorld";

  // Sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x050816) },
      horizon: { value: new THREE.Color(0x1a1530) }
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = normalize(wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenith;
      uniform vec3 horizon;
      varying vec3 vWorld;
      void main() {
        float h = clamp(vWorld.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.85));
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), skyMat);
  root.add(sky);

  // Stars (visible at night via opacity)
  const starCount = 1200;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(Math.random() * 0.85);
    const r = 70;
    starPos[i * 3] = Math.sin(b) * Math.cos(a) * r;
    starPos[i * 3 + 1] = Math.abs(Math.cos(b)) * r;
    starPos[i * 3 + 2] = Math.sin(b) * Math.sin(a) * r;
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(starPos, 3)),
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.35,
      transparent: true,
      opacity: 0.8,
      depthWrite: false
    })
  );
  root.add(stars);

  // Desert floor with Poly Haven sand_01 PBR maps (CC0)
  const groundRes = 96;
  const groundSize = 120;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, groundRes, groundRes);
  groundGeo.rotateX(-Math.PI / 2);
  const gpos = groundGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < gpos.count; i++) {
    const x = gpos.getX(i);
    const z = gpos.getZ(i);
    const dunes = fbm(x * 0.045, z * 0.045) * 1.8;
    const ripples = fbm(x * 0.2, z * 0.2) * 0.15;
    gpos.setY(i, dunes + ripples - 1.05);
  }
  groundGeo.computeVertexNormals();

  const loader = new THREE.TextureLoader();
  const tile = 18;
  const colorMap = loader.load("./textures/sand/sand_diff.jpg");
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.wrapS = colorMap.wrapT = THREE.RepeatWrapping;
  colorMap.anisotropy = 8;
  colorMap.repeat.set(tile, tile);

  const normalMap = loader.load("./textures/sand/sand_nor.jpg");
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 8;
  normalMap.repeat.set(tile, tile);

  const roughMap = loader.load("./textures/sand/sand_rough.jpg");
  roughMap.wrapS = roughMap.wrapT = THREE.RepeatWrapping;
  roughMap.anisotropy = 8;
  roughMap.repeat.set(tile, tile);

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: colorMap,
    normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: roughMap,
    roughness: 1,
    metalness: 0.02,
    flatShading: false
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = false;
  root.add(ground);

  // Mountain silhouettes
  const mountains = new THREE.Group();
  for (let ring = 0; ring < 3; ring++) {
    const count = 14 + ring * 4;
    const radius = 28 + ring * 10;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + ring * 0.35;
      const h = 3 + hash2(i, ring) * (6 + ring * 3);
      const w = 2.5 + hash2(ring, i) * 4;
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(w, h, 5),
        new THREE.MeshStandardMaterial({
          color: 0x3a322c,
          roughness: 0.95,
          metalness: 0.05,
          flatShading: true
        })
      );
      mesh.position.set(Math.cos(ang) * radius, h * 0.35 - 0.8, Math.sin(ang) * radius);
      mesh.rotation.y = ang;
      mountains.add(mesh);
    }
  }
  root.add(mountains);

  // Soft dune haze plate near horizon (very subtle, not a mirror)
  const haze = new THREE.Mesh(
    new THREE.CircleGeometry(55, 48),
    new THREE.MeshBasicMaterial({
      color: 0x1a1520,
      transparent: true,
      opacity: 0.18,
      depthWrite: false
    })
  );
  haze.rotation.x = -Math.PI / 2;
  haze.position.y = -0.7;
  root.add(haze);

  let hemi: THREE.HemisphereLight | null = null;
  let sun: THREE.DirectionalLight | null = null;
  let moon: THREE.DirectionalLight | null = null;

  const applyPalette = (p: SkyPaletteRaw, hour: number) => {
    (skyMat.uniforms.zenith.value as THREE.Color).setHex(p.zenith);
    (skyMat.uniforms.horizon.value as THREE.Color).setHex(p.horizon);
    groundMat.color.setHex(p.ground);
    haze.material.color.setHex(p.horizon);
    haze.material.opacity = 0.12 + (1 - Math.max(0, sunAltitude(hour))) * 0.12;
    (stars.material as THREE.PointsMaterial).opacity =
      Math.max(0, 0.9 - Math.max(0, sunAltitude(hour)) * 1.6);

    for (const m of mountains.children) {
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(
        sunAltitude(hour) > 0.2 ? 0x5a4a3a : 0x2a2420
      );
    }

    if (hemi) {
      hemi.color.setHex(p.hemiSky);
      hemi.groundColor.setHex(p.hemiGround);
      hemi.intensity = 0.35 + p.sunIntensity * 0.25 + p.moonIntensity * 0.2;
    }
    if (sun) {
      const alt = sunAltitude(hour);
      const az = ((hour - 12) / 12) * Math.PI;
      sun.position.set(Math.sin(az) * 40, Math.max(-8, alt * 35), Math.cos(az) * 40);
      sun.color.setHex(p.sunColor);
      sun.intensity = Math.max(0, p.sunIntensity * Math.max(0, alt));
    }
    if (moon) {
      const alt = -sunAltitude(hour);
      const az = ((hour - 12) / 12) * Math.PI + Math.PI;
      moon.position.set(Math.sin(az) * 35, Math.max(2, alt * 28 + 8), Math.cos(az) * 35);
      moon.color.setHex(0xb0c4ff);
      moon.intensity = Math.max(0, p.moonIntensity * Math.max(0.15, alt + 0.4));
    }

    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.setHex(p.fog);
      scene.fog.density = 0.018 + (1 - Math.max(0, sunAltitude(hour))) * 0.012;
    }
    scene.background = new THREE.Color(p.zenith);
  };

  scene.add(root);
  applyPalette(paletteForHour(worldClock.hours), worldClock.hours);

  return {
    root,
    setLights(h, s, m) {
      hemi = h;
      sun = s;
      moon = m;
      applyPalette(paletteForHour(worldClock.hours), worldClock.hours);
    },
    applyHour(hour: number) {
      applyPalette(paletteForHour(hour), hour);
    },
    dispose() {
      colorMap.dispose();
      normalMap.dispose();
      roughMap.dispose();
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat))
            mat.forEach((m) => m.dispose());
          else
            mat.dispose();
        }
      });
      scene.remove(root);
    }
  };
}
