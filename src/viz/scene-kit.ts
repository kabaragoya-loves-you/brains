import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createDesertWorld, type DesertWorld } from "./desert-world.js";
import { paletteForHour, worldClock } from "./world-clock.js";

export type SceneKit = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  desert: DesertWorld;
  /** Mode-driven bloom contribution; daylight scaling is applied in render(). */
  setBloomBoost: (value: number) => void;
  dispose: () => void;
  setSize: (width: number, height: number) => void;
  render: () => void;
};

export function createPbrScene(
  container: HTMLElement,
  opts?: {
    cameraPos?: [number, number, number];
    fov?: number;
    bloomStrength?: number;
  }
): SceneKit {
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 560;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = paletteForHour(worldClock.hours).exposure;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0c14, 0.022);

  const camera = new THREE.PerspectiveCamera(
    opts?.fov ?? 50,
    width / Math.max(height, 1),
    0.1,
    200
  );
  const cam = opts?.cameraPos ?? [0, 0.55, 3.4];
  camera.position.set(cam[0], cam[1], cam[2]);

  const hemi = new THREE.HemisphereLight(0x2a3550, 0x1a140e, 0.45);
  const sun = new THREE.DirectionalLight(0xfff2c8, 0.2);
  sun.position.set(10, 20, 8);
  const moon = new THREE.DirectionalLight(0xb0c4ff, 0.4);
  moon.position.set(-12, 10, -8);
  const fill = new THREE.PointLight(0xffcc88, 0.25, 18);
  fill.position.set(0, 2.4, 2.5);
  scene.add(hemi, sun, moon, fill);

  const desert = createDesertWorld(scene);
  desert.setLights(hemi, sun, moon);

  const baseBloom = opts?.bloomStrength ?? 0.65;
  let modeBloom = baseBloom;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.4,
    0.45,
    0.35
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const applyDayBloom = () => {
    const p = paletteForHour(worldClock.hours);
    renderer.toneMappingExposure = p.exposure;
    bloom.strength = Math.max(0, modeBloom * p.bloomScale + p.bloomBias);
    bloom.threshold = p.bloomThreshold;
    fill.intensity = 0.12 + p.moonIntensity * 0.22 + p.sunIntensity * 0.08;
  };
  applyDayBloom();

  const unsub = worldClock.onChange(() => {
    desert.applyHour(worldClock.hours);
    applyDayBloom();
  });

  return {
    renderer,
    scene,
    camera,
    composer,
    bloom,
    desert,
    setBloomBoost(value: number) {
      modeBloom = Math.max(0, value);
    },
    render() {
      applyDayBloom();
      composer.render();
    },
    setSize(nextW: number, nextH: number) {
      renderer.setSize(nextW, nextH);
      composer.setSize(nextW, nextH);
      camera.aspect = nextW / Math.max(nextH, 1);
      camera.updateProjectionMatrix();
      bloom.setSize(nextW, nextH);
    },
    dispose() {
      unsub();
      desert.dispose();
      composer.dispose();
      renderer.dispose();
      container.innerHTML = "";
    }
  };
}

export function physicalShellMaterial(color: number, opts?: {
  metalness?: number;
  roughness?: number;
  transmission?: number;
  opacity?: number;
}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: opts?.metalness ?? 0.15,
    roughness: opts?.roughness ?? 0.22,
    transmission: opts?.transmission ?? 0.55,
    thickness: 0.55,
    ior: 1.45,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.6,
    transparent: true,
    opacity: opts?.opacity ?? 0.85,
    attenuationColor: new THREE.Color(color),
    attenuationDistance: 2.5
  });
}

export function liveOrDemo(
  updatedAt: number,
  live: number,
  demo: number
): number {
  return updatedAt === 0 ? demo : live;
}
