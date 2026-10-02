/** Shared clock for desert day/night. Hours in [0, 24). */
export class WorldClock {
  private hour = new Date().getHours() + new Date().getMinutes() / 60;
  private listeners = new Set<(hour: number) => void>();
  private locked = false;

  get hours(): number {
    return this.hour;
  }

  get isScrubbing(): boolean {
    return this.locked;
  }

  setHours(hour: number, fromScrub = false): void {
    let h = hour % 24;
    if (h < 0)
      h += 24;
    this.hour = h;
    if (fromScrub)
      this.locked = true;
    for (const cb of this.listeners)
      cb(this.hour);
  }

  followWallClock(): void {
    this.locked = false;
    const now = new Date();
    this.setHours(now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600);
  }

  tickWallClock(): void {
    if (this.locked)
      return;
    const now = new Date();
    this.setHours(now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600);
  }

  onChange(cb: (hour: number) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  label(): string {
    const h24 = this.hour;
    const h = Math.floor(h24);
    const m = Math.floor((h24 - h) * 60);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
  }
}

export const worldClock = new WorldClock();

export type SkyPaletteRaw = {
  zenith: number;
  horizon: number;
  ground: number;
  sunColor: number;
  ambient: number;
  hemiSky: number;
  hemiGround: number;
  fog: number;
  sunIntensity: number;
  moonIntensity: number;
  bloomBias: number;
  bloomScale: number;
  bloomThreshold: number;
  exposure: number;
};

function lerpHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function mixPalette(a: SkyPaletteRaw, b: SkyPaletteRaw, t: number): SkyPaletteRaw {
  const u = Math.max(0, Math.min(1, t));
  return {
    zenith: lerpHex(a.zenith, b.zenith, u),
    horizon: lerpHex(a.horizon, b.horizon, u),
    ground: lerpHex(a.ground, b.ground, u),
    sunColor: lerpHex(a.sunColor, b.sunColor, u),
    ambient: lerpHex(a.ambient, b.ambient, u),
    hemiSky: lerpHex(a.hemiSky, b.hemiSky, u),
    hemiGround: lerpHex(a.hemiGround, b.hemiGround, u),
    fog: lerpHex(a.fog, b.fog, u),
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * u,
    moonIntensity: a.moonIntensity + (b.moonIntensity - a.moonIntensity) * u,
    bloomBias: a.bloomBias + (b.bloomBias - a.bloomBias) * u,
    bloomScale: a.bloomScale + (b.bloomScale - a.bloomScale) * u,
    bloomThreshold: a.bloomThreshold + (b.bloomThreshold - a.bloomThreshold) * u,
    exposure: a.exposure + (b.exposure - a.exposure) * u
  };
}

const NIGHT: SkyPaletteRaw = {
  zenith: 0x050816,
  horizon: 0x1a1530,
  ground: 0x2a2218,
  sunColor: 0xc8d6ff,
  ambient: 0x1a2030,
  hemiSky: 0x2a3550,
  hemiGround: 0x1a140e,
  fog: 0x0a0c14,
  sunIntensity: 0.05,
  moonIntensity: 0.55,
  bloomBias: 0.15,
  bloomScale: 1,
  bloomThreshold: 0.18,
  exposure: 0.95
};

const DAWN: SkyPaletteRaw = {
  zenith: 0x2a3a6a,
  horizon: 0xff7a4a,
  ground: 0x4a3020,
  sunColor: 0xffb070,
  ambient: 0x403020,
  hemiSky: 0x6a80b0,
  hemiGround: 0x3a2818,
  fog: 0x2a2030,
  sunIntensity: 0.7,
  moonIntensity: 0.1,
  bloomBias: -0.05,
  bloomScale: 0.45,
  bloomThreshold: 0.42,
  exposure: 1.0
};

const DAY: SkyPaletteRaw = {
  zenith: 0x4a90e0,
  horizon: 0xc8e4ff,
  ground: 0xc2a06a,
  sunColor: 0xfff2c8,
  ambient: 0x8899aa,
  hemiSky: 0xa8c8ff,
  hemiGround: 0x8a7048,
  fog: 0xb8c8d8,
  sunIntensity: 1.35,
  moonIntensity: 0,
  bloomBias: -0.35,
  bloomScale: 0.18,
  bloomThreshold: 0.62,
  exposure: 1.05
};

const DUSK: SkyPaletteRaw = {
  zenith: 0x1a2048,
  horizon: 0xff5530,
  ground: 0x3a2418,
  sunColor: 0xff8040,
  ambient: 0x302018,
  hemiSky: 0x504878,
  hemiGround: 0x2a1810,
  fog: 0x1a1420,
  sunIntensity: 0.55,
  moonIntensity: 0.15,
  bloomBias: 0.05,
  bloomScale: 0.55,
  bloomThreshold: 0.32,
  exposure: 1.0
};

export function paletteForHour(hour: number): SkyPaletteRaw {
  const h = ((hour % 24) + 24) % 24;
  const keys: Array<[number, SkyPaletteRaw]> = [
    [0, NIGHT],
    [5, NIGHT],
    [6.5, DAWN],
    [9, DAY],
    [16, DAY],
    [18.5, DUSK],
    [21, NIGHT],
    [24, NIGHT]
  ];
  for (let i = 0; i < keys.length - 1; i++) {
    const [h0, p0] = keys[i];
    const [h1, p1] = keys[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0 || 1);
      return mixPalette(p0, p1, t);
    }
  }
  return NIGHT;
}

export function sunAltitude(hour: number): number {
  const rad = ((hour - 6) / 12) * Math.PI;
  return Math.sin(rad);
}
