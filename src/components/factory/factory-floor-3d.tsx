"use client";

/**
 * FactoryFloor3D — cinematic 3D (WebGL / three.js) command center.
 *
 * Drop-in replacement for <FactoryVisMap>: identical prop interface, so it wires
 * straight into the existing live Supabase data in FactorySweatshop. No backend,
 * realtime, or review-gate logic is touched — this is purely a visual layer.
 *
 * The 3D scene is built once and reads live state through a ref so realtime
 * agent/metric updates animate without rebuilding the scene.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import * as THREE from "three";
import type { AgentSlug } from "@/lib/ajax/types";
import type { AgentStatus } from "@/lib/ajax/status";
import type { VisAgent, VisMetrics } from "@/components/factory/factory-vis-map";

type Props = {
  agents: VisAgent[];
  metrics: VisMetrics;
  running: boolean;
  cyclePhase: "nova" | "forge" | null;
  runningPixel: boolean;
  resetting: boolean;
  autopilot: boolean;
  lastEventMessage?: string;
  onRunCycle: () => void;
  onRunPixel: () => void;
  onResetFactory: () => void;
  onToggleAutopilot: () => void;
};

type RoomId = "research" | "forge" | "review" | "pixel" | "store" | "operator";

type RoomDef = {
  id: RoomId;
  name: string;
  sub: string;
  agent: AgentSlug | null;
  x: number;
  z: number;
  w: number;
  d: number;
  hex: number;
};

const HEX: Record<RoomId, number> = {
  research: 0x3ce6ff,
  forge: 0xff8a3c,
  review: 0xffc24a,
  pixel: 0x34e0d8,
  store: 0x5cf2a8,
  operator: 0x4d8cff,
};

const ROOMS: RoomDef[] = [
  { id: "research", name: "RESEARCH LAB", sub: "Nova · demand recon", agent: "nova", x: -6.2, z: -3.2, w: 3.6, d: 2.6, hex: HEX.research },
  { id: "forge", name: "DESIGN PRESS", sub: "Forge · asset forge", agent: "forge", x: 0, z: -3.2, w: 3.6, d: 2.6, hex: HEX.forge },
  { id: "review", name: "REVIEW GATE", sub: "Logan · checkpoint", agent: null, x: 6.2, z: -3.2, w: 3.6, d: 2.6, hex: HEX.review },
  { id: "pixel", name: "MEDIA STUDIO", sub: "Pixel · packaging", agent: "pixel", x: -1.6, z: 3.4, w: 3.6, d: 2.6, hex: HEX.pixel },
  { id: "store", name: "STOREFRONT", sub: "Live listings", agent: null, x: 4.6, z: 3.4, w: 3.6, d: 2.6, hex: HEX.store },
  { id: "operator", name: "OPERATOR", sub: "L. Alvarez · oversight", agent: null, x: -7.8, z: 3.4, w: 2.6, d: 2.6, hex: HEX.operator },
];

const CONV: Record<string, number[][]> = {
  c1: [[-4.4, -3.2], [-1.8, -3.2]],
  c2: [[1.8, -3.2], [4.4, -3.2]],
  c3: [[6.2, -2.0], [6.2, 3.4], [0.2, 3.4]],
  c4: [[0.2, 3.4], [2.8, 3.4]],
};

const AGENT_ROOM: Record<AgentSlug, RoomId> = { nova: "research", forge: "forge", pixel: "pixel" };
const AGENT_NAME: Record<AgentSlug, string> = { nova: "Nova", forge: "Forge", pixel: "Pixel" };

function isWorking(s: AgentStatus | undefined) {
  return s === "working" || s === "thinking";
}

type LiveState = {
  agents: VisAgent[];
  metrics: VisMetrics;
  running: boolean;
  cyclePhase: "nova" | "forge" | null;
  autopilot: boolean;
};

type RoomObj = {
  def: RoomDef;
  topMat: THREE.MeshStandardMaterial;
  edgeMat: THREE.LineBasicMaterial;
  light: THREE.PointLight;
  glow: THREE.Sprite;
  color: THREE.Color;
  label: HTMLDivElement;
  holo?: THREE.Mesh;
  screens: THREE.MeshStandardMaterial[];
};

type AgentObj = {
  slug: AgentSlug;
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
  halo: THREE.Sprite;
  light: THREE.PointLight;
  room: RoomDef;
  target: THREE.Vector3;
  dwell: number;
  face: number;
  label: HTMLDivElement;
};

export function FactoryFloor3D(props: Props) {
  const {
    agents,
    metrics,
    running,
    cyclePhase,
    runningPixel,
    resetting,
    autopilot,
    lastEventMessage,
    onRunCycle,
    onRunPixel,
    onResetFactory,
    onToggleAutopilot,
  } = props;

  const mountRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef<LiveState>({ agents, metrics, running, cyclePhase, autopilot });
  const selectedRef = useRef<RoomId | null>(null);
  const [selected, setSelected] = useState<RoomId | null>(null);

  // keep the animation loop fed with the latest live data
  useEffect(() => {
    liveRef.current = { agents, metrics, running, cyclePhase, autopilot };
  }, [agents, metrics, running, cyclePhase, autopilot]);

  useEffect(() => {
    const mount = mountRef.current;
    const overlay = overlayRef.current;
    if (!mount || !overlay) return;

    const W0 = mount.clientWidth || 800;
    const H0 = mount.clientHeight || 460;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W0, H0, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05070f, 0.039);
    const camera = new THREE.PerspectiveCamera(40, W0 / H0, 0.1, 200);
    const camBase = new THREE.Vector3(0.5, 12.2, 15.2);
    const camLook = new THREE.Vector3(0, -0.4, 0.6);
    camera.position.copy(camBase);
    camera.lookAt(camLook);

    scene.add(new THREE.AmbientLight(0x16203c, 1.1));
    const key = new THREE.DirectionalLight(0x9fd0ff, 0.5);
    key.position.set(6, 16, 10);
    scene.add(key);
    const rimL = new THREE.DirectionalLight(0xff77cc, 0.25);
    rimL.position.set(-10, 6, -8);
    scene.add(rimL);

    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(o: T): T => {
      disposables.push(o);
      return o;
    };

    // glow sprite texture
    const gcanvas = document.createElement("canvas");
    gcanvas.width = gcanvas.height = 128;
    const gx = gcanvas.getContext("2d");
    if (gx) {
      const grad = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.3, "rgba(255,255,255,.55)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      gx.fillStyle = grad;
      gx.fillRect(0, 0, 128, 128);
    }
    const glowTex = track(new THREE.CanvasTexture(gcanvas));
    function makeGlow(color: number, size: number, opacity: number): THREE.Sprite {
      const mat = track(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity }));
      const s = new THREE.Sprite(mat);
      s.scale.set(size, size, 1);
      return s;
    }

    // floor with glowing grid
    const fcanvas = document.createElement("canvas");
    fcanvas.width = fcanvas.height = 1024;
    const fx = fcanvas.getContext("2d");
    if (fx) {
      fx.fillStyle = "#070b18";
      fx.fillRect(0, 0, 1024, 1024);
      fx.strokeStyle = "rgba(77,140,255,0.35)";
      fx.lineWidth = 2;
      const step = 1024 / 24;
      for (let i = 0; i <= 24; i++) {
        fx.globalAlpha = 0.5;
        fx.beginPath();
        fx.moveTo(i * step, 0);
        fx.lineTo(i * step, 1024);
        fx.stroke();
        fx.beginPath();
        fx.moveTo(0, i * step);
        fx.lineTo(1024, i * step);
        fx.stroke();
      }
      const rg = fx.createRadialGradient(512, 512, 0, 512, 512, 512);
      rg.addColorStop(0, "rgba(60,230,255,0.10)");
      rg.addColorStop(0.5, "rgba(20,30,60,0)");
      rg.addColorStop(1, "rgba(0,0,0,0.6)");
      fx.globalAlpha = 1;
      fx.fillStyle = rg;
      fx.fillRect(0, 0, 1024, 1024);
    }
    const floorTex = track(new THREE.CanvasTexture(fcanvas));
    const floorGeo = track(new THREE.PlaneGeometry(40, 40));
    const floorMat = track(new THREE.MeshStandardMaterial({ color: 0x0a1020, metalness: 0.85, roughness: 0.35, emissive: 0x0a1428, emissiveMap: floorTex, emissiveIntensity: 1.0, map: floorTex }));
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);

    function makeBox(w: number, h: number, d: number, color: number, emissive: number, emi: number, met: number, rough: number): THREE.Mesh {
      const geo = track(new THREE.BoxGeometry(w, h, d));
      const mat = track(new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emi, metalness: met, roughness: rough }));
      return new THREE.Mesh(geo, mat);
    }

    const rooms: Record<string, RoomObj> = {};
    for (const def of ROOMS) {
      const color = new THREE.Color(def.hex);
      const grp = new THREE.Group();
      grp.position.set(def.x, 0, def.z);

      const slabMat = track(new THREE.MeshStandardMaterial({ color: 0x0c1322, emissive: color.clone().multiplyScalar(0.5), emissiveIntensity: 0.04, metalness: 0.6, roughness: 0.4 }));
      const slab = new THREE.Mesh(track(new THREE.BoxGeometry(def.w, 0.5, def.d)), slabMat);
      slab.position.y = 0.25;
      slab.userData.id = def.id;
      grp.add(slab);

      const topMat = track(new THREE.MeshStandardMaterial({ color: 0x0f1830, emissive: def.hex, emissiveIntensity: 0.18, metalness: 0.3, roughness: 0.5 }));
      const top = new THREE.Mesh(track(new THREE.BoxGeometry(def.w - 0.4, 0.06, def.d - 0.4)), topMat);
      top.position.y = 0.52;
      grp.add(top);

      const edgeGeo = track(new THREE.EdgesGeometry(new THREE.BoxGeometry(def.w, 0.5, def.d)));
      const edgeMat = track(new THREE.LineBasicMaterial({ color: def.hex, transparent: true, opacity: 0.85 }));
      const edge = new THREE.LineSegments(edgeGeo, edgeMat);
      edge.position.y = 0.25;
      grp.add(edge);

      const base = makeBox(def.w, 0.5, def.d, 0x070b16, 0x000000, 0, 0.2, 0.8);
      base.position.y = -0.02;
      grp.add(base);

      const light = new THREE.PointLight(def.hex, 0.25, 9, 2);
      light.position.set(0, 1.4, 0);
      grp.add(light);

      const glow = makeGlow(def.hex, def.w * 1.5, 0.0);
      glow.position.set(0, 0.56, 0);
      grp.add(glow);

      const screens: THREE.MeshStandardMaterial[] = [];
      let holo: THREE.Mesh | undefined;
      addProps(def, color, grp, screens, makeBox, makeGlow, track, (h) => { holo = h; });

      scene.add(grp);

      const label = document.createElement("div");
      label.className = "ff3d-lbl";
      label.style.color = "#" + def.hex.toString(16).padStart(6, "0");
      label.innerHTML = def.name + "<small>" + def.sub + "</small>";
      overlay.appendChild(label);

      rooms[def.id] = { def, topMat, edgeMat, light, glow, color, label, holo, screens };
    }

    // agents
    const agentObjs: Record<string, AgentObj> = {};
    (["nova", "forge", "pixel"] as AgentSlug[]).forEach((slug) => {
      const def = ROOMS.find((r) => r.id === AGENT_ROOM[slug])!;
      const color = new THREE.Color(def.hex);
      const grp = new THREE.Group();

      const bodyMat = track(new THREE.MeshStandardMaterial({ color: def.hex, emissive: def.hex, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.4 }));
      const body = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.22, 0.34, 6, 14)), bodyMat);
      body.position.y = 0.45;
      grp.add(body);

      const headMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: def.hex, emissiveIntensity: 0.7, roughness: 0.3 }));
      const head = new THREE.Mesh(track(new THREE.SphereGeometry(0.2, 18, 18)), headMat);
      head.position.y = 0.86;
      grp.add(head);

      const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.34, 0.03, 8, 28)), track(new THREE.MeshBasicMaterial({ color: def.hex, transparent: true, opacity: 0.8 })));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      grp.add(ring);

      const halo = makeGlow(def.hex, 1.3, 0.7);
      halo.position.y = 0.5;
      grp.add(halo);

      const light = new THREE.PointLight(def.hex, 0.5, 4, 2);
      light.position.y = 0.6;
      grp.add(light);

      grp.position.set(def.x, 0.55, def.z);
      scene.add(grp);

      const label = document.createElement("div");
      label.className = "ff3d-aglbl";
      label.style.color = "#" + def.hex.toString(16).padStart(6, "0");
      overlay.appendChild(label);

      agentObjs[slug] = {
        slug,
        group: grp,
        bodyMat,
        headMat,
        halo,
        light,
        room: def,
        target: new THREE.Vector3(def.x, 0.55, def.z),
        dwell: 0,
        face: 0,
        label,
      };
      void color;
    });

    // conveyors
    type ConvObj = { curve: THREE.CatmullRomCurve3; mat: THREE.MeshBasicMaterial; orbs: THREE.Sprite[]; hex: number };
    const conv: Record<string, ConvObj> = {};
    Object.keys(CONV).forEach((k) => {
      const pts = CONV[k].map((p) => new THREE.Vector3(p[0], 0.34, p[1]));
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0);
      const hex = k === "c3" ? 0xffc24a : k === "c4" ? 0x5cf2a8 : k === "c1" ? 0x3ce6ff : 0xff8a3c;
      const geo = track(new THREE.TubeGeometry(curve, 40, 0.05, 8, false));
      const mat = track(new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.22 }));
      scene.add(new THREE.Mesh(geo, mat));
      const orbs: THREE.Sprite[] = [];
      for (let i = 0; i < 5; i++) {
        const o = makeGlow(hex, 0.5, 0);
        o.userData.off = i / 5;
        scene.add(o);
        orbs.push(o);
      }
      conv[k] = { curve, mat, orbs, hex };
    });

    // particles
    const motesN = 240;
    const motesPos = new Float32Array(motesN * 3);
    for (let i = 0; i < motesN; i++) {
      motesPos[i * 3] = (Math.random() - 0.5) * 30;
      motesPos[i * 3 + 1] = Math.random() * 8;
      motesPos[i * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    const motesGeo = track(new THREE.BufferGeometry());
    motesGeo.setAttribute("position", new THREE.BufferAttribute(motesPos, 3));
    const motesMat = track(new THREE.PointsMaterial({ color: 0x6fa8ff, size: 0.05, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    const motes = new THREE.Points(motesGeo, motesMat);
    scene.add(motes);

    // raycast click
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const slabMeshes: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData && o.userData.id) slabMeshes.push(o);
    });
    let hovered: RoomId | null = null;
    let dragging = false;
    let down: [number, number] | null = null;
    const orbit = { tx: 0, ax: 0, ay: 0, ty: 0 };

    function pick(e: PointerEvent): RoomId | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(slabMeshes, false);
      return hit.length ? (hit[0].object.userData.id as RoomId) : null;
    }
    const onDown = (e: PointerEvent) => {
      dragging = false;
      down = [e.clientX, e.clientY];
    };
    const onMove = (e: PointerEvent) => {
      if (down) {
        if (Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 5) dragging = true;
        if (dragging) {
          orbit.tx = e.clientX - down[0];
          orbit.ty = e.clientY - down[1];
        }
      }
      hovered = pick(e);
      renderer.domElement.style.cursor = hovered ? "pointer" : "grab";
    };
    const onUp = (e: PointerEvent) => {
      if (down && !dragging) {
        const id = pick(e);
        if (id) setSelected(id);
      }
      down = null;
      window.setTimeout(() => {
        dragging = false;
      }, 30);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    // resize
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || W0;
      const h = mount.clientHeight || H0;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    // animation
    const proj = new THREE.Vector3();
    let raf = 0;
    let last = performance.now();
    let introT = 0;

    const render = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const t = now * 0.001;
      const live = liveRef.current;

      if (introT < 1) {
        introT = Math.min(1, introT + dt / 2200);
        const e = 1 - Math.pow(1 - introT, 3);
        camera.position.set(
          THREE.MathUtils.lerp(0.5, camBase.x, e),
          THREE.MathUtils.lerp(20, camBase.y, e),
          THREE.MathUtils.lerp(26, camBase.z, e),
        );
      } else {
        orbit.ax += (orbit.tx * 0.02 - orbit.ax) * 0.05;
        orbit.ay += (orbit.ty * 0.01 - orbit.ay) * 0.05;
        camera.position.x = camBase.x + Math.sin(t * 0.12) * 1.2 + orbit.ax * 0.5;
        camera.position.y = camBase.y + Math.sin(t * 0.16) * 0.4 - orbit.ay * 0.4;
        camera.position.z = camBase.z + Math.cos(t * 0.12) * 0.6;
      }
      camera.lookAt(camLook);

      // derive room states from live agents
      const bySlug: Partial<Record<AgentSlug, VisAgent>> = {};
      for (const a of live.agents) bySlug[a.slug] = a;

      const rect = renderer.domElement.getBoundingClientRect();

      for (const def of ROOMS) {
        const o = rooms[def.id];
        let active = false;
        let alert = false;
        if (def.agent) active = isWorking(bySlug[def.agent]?.status);
        if (def.id === "review") alert = live.metrics.pendingReviews > 0;
        if (def.id === "store") active = live.metrics.publishedListings > 0 && active;
        const hov = hovered === def.id;

        // idle breathing so every zone stays alive even with no active work
        const breathe = 0.5 + 0.5 * Math.sin(t * 1.1 + def.x * 0.7 + def.z * 0.5);

        const tgtEmi = alert ? 0.55 : active ? 0.5 : hov ? 0.28 : 0.16 + 0.06 * breathe;
        o.topMat.emissiveIntensity += (tgtEmi - o.topMat.emissiveIntensity) * 0.12;
        const tgtLi = alert ? 1.4 : active ? 1.3 : hov ? 0.7 : 0.24 + 0.14 * breathe;
        o.light.intensity += (tgtLi - o.light.intensity) * 0.1;
        const tgtGo = active || alert ? 0.5 : hov ? 0.3 : 0.06 + 0.06 * breathe;
        o.glow.material.opacity += (tgtGo - o.glow.material.opacity) * 0.1;
        o.edgeMat.color.setHex(alert ? 0xffc24a : def.hex);
        o.edgeMat.opacity = active || alert ? 0.8 + 0.2 * Math.sin(t * 5) : 0.6 + 0.14 * breathe;
        if (o.holo) {
          o.holo.position.y = 1.25 + Math.sin(t * 2) * 0.06;
          (o.holo.material as THREE.MeshStandardMaterial).opacity = alert ? 0.9 : 0.4;
        }
        o.screens.forEach((sm, si) => {
          sm.emissiveIntensity = (active ? 0.7 : 0.4) + 0.2 * Math.sin(t * 6 + si);
        });

        // label position
        proj.set(def.x, 1.1, def.z).project(camera);
        const lx = (proj.x * 0.5 + 0.5) * rect.width;
        const ly = (-proj.y * 0.5 + 0.5) * rect.height;
        o.label.style.left = lx + "px";
        o.label.style.top = ly + "px";
        o.label.style.opacity = proj.z < 1 ? "1" : "0";
      }

      // agents move + animate
      const dts = Math.min(0.05, dt / 1000);
      for (const slug of Object.keys(agentObjs) as AgentSlug[]) {
        const a = agentObjs[slug];
        const work = isWorking(bySlug[slug]?.status);
        const wait = bySlug[slug]?.status === "waiting_review";
        const hx = a.room.w / 2 - 0.7;
        const hz = a.room.d / 2 - 0.7;
        const spd = work ? 1.6 : 0.85;
        const dx = a.target.x - a.group.position.x;
        const dz = a.target.z - a.group.position.z;
        const d = Math.hypot(dx, dz);
        let moving = false;
        if (a.dwell > 0) {
          a.dwell -= dts;
        } else if (d < 0.12) {
          if (work && Math.random() < 0.6) {
            a.target.set(a.room.x + 0.2 + (Math.random() - 0.5) * 0.6, 0.55, a.room.z + 0.5 + (Math.random() - 0.5) * 0.6);
          } else {
            a.target.set(a.room.x + (Math.random() * 2 - 1) * hx, 0.55, a.room.z + (Math.random() * 2 - 1) * hz);
          }
          a.dwell = work ? 0.1 + Math.random() * 0.4 : 0.35 + Math.random() * 1.0;
        } else {
          const step = Math.min(d, spd * dts);
          a.group.position.x += (dx / d) * step;
          a.group.position.z += (dz / d) * step;
          a.face = Math.atan2(dx, dz);
          moving = true;
        }
        const bob = moving ? Math.abs(Math.sin(t * 13)) * 0.08 : work ? Math.sin(t * 4) * 0.03 : Math.sin(t * 1.5) * 0.02;
        a.group.position.y = bob;
        a.group.rotation.y += (a.face - a.group.rotation.y) * 0.18;
        const idlePulse = 0.5 + 0.5 * Math.sin(t * 2.2 + a.room.x);
        const ei = work ? 1.15 : wait ? 0.8 : 0.46 + 0.16 * idlePulse;
        a.bodyMat.emissiveIntensity += (ei - a.bodyMat.emissiveIntensity) * 0.1;
        a.headMat.emissiveIntensity = a.bodyMat.emissiveIntensity + 0.2;
        a.light.intensity = work ? 1.1 : 0.4 + 0.2 * idlePulse;
        a.halo.material.opacity = work ? 0.95 : 0.4 + 0.18 * idlePulse;
        a.halo.scale.setScalar(1.3 + (moving ? 0.15 * Math.sin(t * 14) : 0.08 * idlePulse));

        proj.set(a.group.position.x, a.group.position.y + 0.95, a.group.position.z).project(camera);
        const ax = (proj.x * 0.5 + 0.5) * rect.width;
        const ay = (-proj.y * 0.5 + 0.5) * rect.height;
        a.label.style.left = ax + "px";
        a.label.style.top = ay + "px";
        a.label.style.opacity = proj.z < 1 && !selectedRef.current ? "1" : "0";
        a.label.className = "ff3d-aglbl" + (work ? " work" : "");
        a.label.innerHTML = "<b>" + AGENT_NAME[slug] + "</b>" + (work ? " · live" : wait ? " · review" : "");
      }

      // conveyors — always a gentle ambient flow so the ecosystem never looks
      // parked; bright + fast when a cycle is actually moving product through.
      const c1on = live.running && live.cyclePhase === "nova";
      const c2on = live.running && live.cyclePhase === "forge";
      const flow: Record<string, boolean> = {
        c1: c1on,
        c2: c2on,
        c3: live.metrics.pendingReviews > 0,
        c4: live.metrics.publishedListings > 0,
      };
      for (const k of Object.keys(conv)) {
        const c = conv[k];
        const on = flow[k];
        const idleOp = live.autopilot ? 0.28 : 0.15;
        const idleSpd = live.autopilot ? 0.22 : 0.12;
        const idleOrb = live.autopilot ? 0.4 : 0.26;
        c.mat.opacity += ((on ? 0.6 : idleOp) - c.mat.opacity) * 0.08;
        const speed = on ? 0.5 : idleSpd;
        c.orbs.forEach((o, oi) => {
          const f = (t * speed + (o.userData.off as number)) % 1;
          o.position.copy(c.curve.getPoint(f));
          o.material.opacity = on ? 0.9 : idleOrb;
          o.scale.setScalar((on ? 0.5 : 0.3) + 0.15 * Math.sin(t * (on ? 10 : 3) + oi * 2));
        });
      }

      motes.rotation.y = t * 0.03;
      motes.position.y = Math.sin(t * 0.4) * 0.15;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    // cleanup
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      for (const o of disposables) {
        try {
          o.dispose();
        } catch {
          /* noop */
        }
      }
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      overlay.innerHTML = "";
    };
  }, []);

  // keep label visibility in sync with inspector without rebuilding the scene
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const activeCount = agents.filter((a) => isWorking(a.status)).length;
  const phaseText = running ? (cyclePhase === "nova" ? "NOVA SCANNING" : "FORGE BUILDING") : runningPixel ? "PIXEL PACKAGING" : null;
  const busy = running || runningPixel || resetting;

  // rotating ambient status so the ticker always feels live between events
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 4200);
    return () => window.clearInterval(id);
  }, []);
  const ambientLines = [
    `Ecosystem online · ${activeCount} agent${activeCount === 1 ? "" : "s"} active`,
    `Storefront · ${metrics.publishedListings} live listing${metrics.publishedListings === 1 ? "" : "s"}`,
    metrics.pendingReviews > 0
      ? `Review gate · ${metrics.pendingReviews} awaiting your approval`
      : "Review gate · clear",
    `Nova archive · ${metrics.productIdeas} ideas on file`,
    `Pixel · ${metrics.scheduledContent} promo${metrics.scheduledContent === 1 ? "" : "s"} staged`,
    autopilot
      ? metrics.pendingReviews > 0
        ? "Autopilot paused · a draft is awaiting your approval"
        : "Autopilot engaged · agents self-running the produce loop"
      : "Autopilot idle · press AUTOPILOT to let the floor self-run",
  ];
  const tickerLines = lastEventMessage ? [lastEventMessage, ...ambientLines] : ambientLines;
  const tickerText = tickerLines[tick % tickerLines.length];

  return (
    <div className="ff3d-wrap">
      <div className="ff3d-canvas" ref={mountRef} />
      <div className="ff3d-overlay" ref={overlayRef} />

      {/* top HUD */}
      <div className="ff3d-hud-top">
        <div className="ff3d-glass ff3d-brand">
          <span className="ff3d-logo">OCTANE&nbsp;AJAX</span>
          <span className="ff3d-eco">AI&nbsp;AGENT&nbsp;ECOSYSTEM</span>
          <span className="ff3d-biz">BUSINESS&nbsp;01 · GOTCHADAYGOODS</span>
          <span className="ff3d-op">OPERATOR: <b>LOGAN ALVAREZ</b>{" // @lilchulo"}</span>
        </div>
        <div className="ff3d-glass ff3d-stats">
          <span className="ff3d-online" />
          <span className="ff3d-onlbl">ONLINE</span>
          <span className="ff3d-light" data-on={activeCount > 0} />
          <span>ACTIVE <b>{activeCount}</b></span>
          <span>QUEUE <b style={{ color: metrics.pendingReviews > 0 ? "#ffc24a" : "#eaf2ff" }}>{metrics.pendingReviews}</b></span>
          <span>LIVE <b style={{ color: "#5cf2a8" }}>{metrics.publishedListings}</b></span>
          {autopilot && (
            <span className="ff3d-auto">◉ AUTOPILOT{metrics.pendingReviews > 0 ? " · AWAITS REVIEW" : ""}</span>
          )}
          {phaseText && <span className="ff3d-phase">▶ {phaseText}</span>}
        </div>
      </div>

      <div className="ff3d-hint">▸ Live AI agent ecosystem · click any zone · drag to look</div>

      {/* controls */}
      <div className="ff3d-controls">
        <button type="button" className="ff3d-btn ff3d-primary" disabled={busy} onClick={onRunCycle}>
          {running ? (
            <span className="ff3d-row"><span className="ff3d-spin" /> {cyclePhase === "nova" ? "NOVA…" : "FORGE…"}</span>
          ) : (
            "▶ Run Cycle"
          )}
        </button>
        <button type="button" className="ff3d-btn ff3d-secondary" disabled={busy} onClick={onRunPixel}>
          {runningPixel ? <span className="ff3d-row"><span className="ff3d-spin" /> PIXEL…</span> : "▶ Run Pixel"}
        </button>
        <button type="button" className="ff3d-btn ff3d-ghost" disabled={busy} onClick={onResetFactory}>
          {resetting ? "Resetting…" : "⟳ Reset"}
        </button>
        <button
          type="button"
          className={"ff3d-btn " + (autopilot ? "ff3d-auto-on" : "ff3d-ghost")}
          onClick={onToggleAutopilot}
          title="Auto-runs research→build cycles until a review is pending. Uses LLM credits per cycle; never publishes without your approval."
        >
          {autopilot ? "◉ AUTOPILOT ON" : "○ AUTOPILOT"}
        </button>
        <div className="ff3d-ticker">
          <span className="ff3d-tl">LIVE</span>
          <span className="ff3d-tt" key={tick}>{tickerText}</span>
        </div>
      </div>

      {/* inspector */}
      {selected && (
        <>
          <div className="ff3d-scrim" onClick={() => setSelected(null)} />
          <Inspector roomId={selected} agents={agents} metrics={metrics} onClose={() => setSelected(null)} onRunCycle={onRunCycle} onRunPixel={onRunPixel} busy={busy} />
        </>
      )}

      <style>{CSS}</style>
    </div>
  );
}

/* ---------------- inspector (React) ---------------- */

const ROOM_META: Record<RoomId, { title: string; sub: string; hex: string; agent: AgentSlug | null }> = {
  research: { title: "Research Lab", sub: "Nova · Research Agent", hex: "#3ce6ff", agent: "nova" },
  forge: { title: "Design Press", sub: "Forge · Creation Agent", hex: "#ff8a3c", agent: "forge" },
  review: { title: "Review Gate", sub: "Logan · human checkpoint", hex: "#ffc24a", agent: null },
  pixel: { title: "Media Studio", sub: "Pixel · Marketing Agent", hex: "#34e0d8", agent: "pixel" },
  store: { title: "Storefront", sub: "Live listings", hex: "#5cf2a8", agent: null },
  operator: { title: "Operator", sub: "Logan Alvarez · Owner", hex: "#4d8cff", agent: null },
};

const ASSIGN: Record<RoomId, string> = {
  research: "Scans trends, demand signals, and niche gaps, then queues structured product ideas.",
  forge: "Turns each idea into listing copy, a mockup, and a print-ready PDF — quality over volume.",
  review: "Mandatory human checkpoint. Logan approves or rejects every draft before anything ships.",
  pixel: "Creates and schedules short-form promo content once a listing is approved.",
  store: "Approved drafts staged as listings — draft-only until you publish.",
  operator: "Full oversight of the floor. Nothing publishes without your approval.",
};

function Inspector({
  roomId,
  agents,
  metrics,
  onClose,
  onRunCycle,
  onRunPixel,
  busy,
}: {
  roomId: RoomId;
  agents: VisAgent[];
  metrics: VisMetrics;
  onClose: () => void;
  onRunCycle: () => void;
  onRunPixel: () => void;
  busy: boolean;
}) {
  const m = ROOM_META[roomId];
  const agent = m.agent ? agents.find((a) => a.slug === m.agent) : undefined;
  const status = agent?.status ?? "idle";
  const statusLabel = status === "working" || status === "thinking" ? "Working" : status === "waiting_review" ? "Waiting" : status === "error" ? "Error" : "Idle";

  const stat = (l: string, v: string | number) => (
    <div className="ff3d-cell">
      <div className="ff3d-cl">{l}</div>
      <div className="ff3d-cv">{v}</div>
    </div>
  );

  return (
    <aside className="ff3d-inspector" style={{ "--ic": m.hex } as CSSProperties}>
      <div className="ff3d-ihead">
        <span className="ff3d-iic" style={{ background: m.hex, color: m.hex }} />
        <div>
          <div className="ff3d-ititle">{m.title}</div>
          <div className="ff3d-isub">{m.sub}</div>
        </div>
        {m.agent && <span className={"ff3d-ipill" + (status === "working" || status === "thinking" ? " work" : status === "waiting_review" ? " wait" : "")}>{statusLabel}</span>}
        <button type="button" className="ff3d-ix" onClick={onClose}>✕</button>
      </div>

      <div className="ff3d-ibody">
        <div className="ff3d-isec">
          <h4>Assignment</h4>
          <p className="ff3d-assign">{ASSIGN[roomId]}</p>
        </div>

        <div className="ff3d-isec">
          <h4>Live Telemetry</h4>
          <div className="ff3d-stat">
            {m.agent ? (
              <>
                {stat("Status", statusLabel)}
                {stat("Room", m.sub.split("·")[0].trim())}
              </>
            ) : null}
            {roomId === "research" && stat("Ideas", metrics.productIdeas)}
            {roomId === "review" && stat("Pending", metrics.pendingReviews)}
            {roomId === "pixel" && stat("Scheduled", metrics.scheduledContent)}
            {roomId === "store" && stat("Published", metrics.publishedListings)}
            {roomId === "operator" && (
              <>
                {stat("Clearance", "OWNER")}
                {stat("Handle", "@lilchulo")}
                {stat("Ideas", metrics.productIdeas)}
                {stat("Published", metrics.publishedListings)}
              </>
            )}
          </div>
        </div>

        {roomId === "review" && (
          <div className="ff3d-isec">
            <h4>Compliance</h4>
            <div className="ff3d-row2"><span className="ff3d-sw" style={{ background: "rgba(92,242,168,.3)" }} /><div><div className="ff3d-rt">Blocked-product rules</div><div className="ff3d-rs">medical · legal · financial · IP</div></div><span className="ff3d-pr">PASS</span></div>
          </div>
        )}
      </div>

      <div className="ff3d-iact">
        {(roomId === "research" || roomId === "operator") && (
          <button type="button" className="ff3d-btn ff3d-primary" style={{ flex: 1 }} disabled={busy} onClick={() => { onClose(); onRunCycle(); }}>▶ Run Cycle</button>
        )}
        {roomId === "pixel" && (
          <button type="button" className="ff3d-btn ff3d-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => { onClose(); onRunPixel(); }}>▶ Run Pixel</button>
        )}
        {roomId === "review" && (
          <Link href="/review" className="ff3d-btn ff3d-approve" style={{ flex: 1, textAlign: "center", textDecoration: "none" }}>Open Review →</Link>
        )}
        {roomId === "store" && (
          <Link href="/store" className="ff3d-btn ff3d-ghost" style={{ flex: 1, textAlign: "center", textDecoration: "none" }}>Open Store →</Link>
        )}
        {roomId === "forge" && (
          <button type="button" className="ff3d-btn ff3d-ghost" style={{ flex: 1 }} disabled>Auto · runs in cycle</button>
        )}
      </div>
    </aside>
  );
}

/* ---------------- props helper ---------------- */

function addProps(
  def: RoomDef,
  color: THREE.Color,
  grp: THREE.Group,
  screens: THREE.MeshStandardMaterial[],
  makeBox: (w: number, h: number, d: number, c: number, e: number, ei: number, m: number, r: number) => THREE.Mesh,
  makeGlow: (c: number, s: number, o: number) => THREE.Sprite,
  track: <T extends { dispose: () => void }>(o: T) => T,
  setHolo: (h: THREE.Mesh) => void,
) {
  const screen = (x: number, y: number, z: number, w: number, h: number) => {
    const mat = track(new THREE.MeshStandardMaterial({ color: 0x06121e, emissive: def.hex, emissiveIntensity: 0.5, metalness: 0.2, roughness: 0.4 }));
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, 0.06)), mat);
    m.position.set(x, y, z);
    grp.add(m);
    screens.push(mat);
  };
  const rack = (x: number, z: number, h: number) => {
    const m = makeBox(0.4, h, 0.4, 0x101a30, def.hex, 0.25, 0.4, 0.5);
    m.position.set(x, 0.52 + h / 2, z);
    grp.add(m);
  };

  if (def.id === "research") {
    rack(-1.0, -0.5, 0.9);
    rack(-0.5, -0.6, 1.2);
    screen(0.8, 0.95, -0.4, 1.0, 0.7);
  } else if (def.id === "forge") {
    screen(-0.9, 0.85, -0.3, 0.9, 0.6);
    const press = makeBox(1.6, 0.8, 1.0, 0x14110a, def.hex, 0.3, 0.5, 0.5);
    press.position.set(0.6, 0.95, 0.2);
    grp.add(press);
  } else if (def.id === "review") {
    const ped = makeBox(0.7, 0.5, 0.7, 0x141d30, def.hex, 0.2, 0.4, 0.5);
    ped.position.set(0, 0.75, 0.2);
    grp.add(ped);
    const holoMat = track(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: def.hex, emissiveIntensity: 0.7, transparent: true, opacity: 0.5, metalness: 0.1, roughness: 0.3 }));
    const holo = new THREE.Mesh(track(new THREE.BoxGeometry(0.7, 0.5, 0.04)), holoMat);
    holo.position.set(0, 1.25, 0.2);
    grp.add(holo);
    setHolo(holo);
    const gs = makeGlow(def.hex, 1.6, 0.5);
    gs.position.set(0, 1.2, 0.2);
    grp.add(gs);
  } else if (def.id === "pixel") {
    screen(0.7, 0.9, -0.4, 1.1, 0.7);
    const con = makeBox(1.4, 0.4, 0.7, 0x101a30, def.hex, 0.35, 0.4, 0.5);
    con.position.set(-0.6, 0.72, 0.3);
    grp.add(con);
  } else if (def.id === "store") {
    for (let i = 0; i < 6; i++) {
      const cc = [0x234a7a, 0x5a3a22, 0x235a40, 0x3a2356, 0x5a2340, 0x23405a][i % 6];
      const fr = makeBox(0.42, 0.5, 0.06, 0x0d1426, cc, 0.4, 0.3, 0.5);
      const col = i % 3;
      const row = (i / 3) | 0;
      fr.position.set(-0.6 + col * 0.56, 0.85 + row * 0.6, -0.7);
      grp.add(fr);
    }
  } else if (def.id === "operator") {
    const desk = makeBox(1.6, 0.35, 0.7, 0x16223e, def.hex, 0.25, 0.5, 0.5);
    desk.position.set(0, 0.7, 0.4);
    grp.add(desk);
    for (let i = -1; i <= 1; i++) {
      screen(i * 0.55, 0.95, 0.2, 0.5, 0.4);
    }
    const body = makeBox(0.5, 0.6, 0.4, 0x1f3a86, 0x3a6dff, 0.4, 0.3, 0.5);
    body.position.set(0, 0.82, 0.9);
    grp.add(body);
    const headMat = track(new THREE.MeshStandardMaterial({ color: 0xf0c9a8, roughness: 0.6 }));
    const head = new THREE.Mesh(track(new THREE.SphereGeometry(0.22, 16, 16)), headMat);
    head.position.set(0, 1.3, 0.9);
    grp.add(head);
    const halo = makeGlow(0x4d8cff, 1.0, 0.5);
    halo.position.set(0, 1.3, 0.9);
    grp.add(halo);
  }
  void color;
}

/* ---------------- styles ---------------- */

const CSS = `
.ff3d-wrap{ position:relative; border-radius:14px; overflow:hidden; aspect-ratio:1180/620; min-height:420px;
  background:radial-gradient(120% 90% at 50% 8%, #11183a 0%, #080d20 45%, #04060e 100%);
  border:1px solid rgba(120,180,255,.16); box-shadow:0 0 0 1px rgba(77,140,255,.05), 0 40px 110px -45px #000, 0 0 90px -40px rgba(77,140,255,.4); font-family:'Space Grotesk',system-ui,sans-serif; }
.ff3d-wrap::after{ content:""; position:absolute; inset:0; pointer-events:none; z-index:6; background:radial-gradient(130% 120% at 50% 0%, transparent 58%, rgba(0,0,0,.5) 100%); }
.ff3d-canvas{ position:absolute; inset:0; z-index:1; cursor:grab; }
.ff3d-overlay{ position:absolute; inset:0; pointer-events:none; z-index:5; }
.ff3d-lbl{ position:absolute; transform:translate(-50%,-130%); font-family:'Orbitron','Space Grotesk',sans-serif; font-weight:700; font-size:10px; letter-spacing:.16em; text-transform:uppercase; padding:3px 9px; border-radius:7px; white-space:nowrap; background:rgba(6,10,20,.45); backdrop-filter:blur(3px); border:1px solid currentColor; text-shadow:0 0 10px currentColor; box-shadow:0 0 14px -3px currentColor; transition:opacity .2s; }
.ff3d-lbl small{ display:block; font-family:'JetBrains Mono',ui-monospace,monospace; font-weight:400; font-size:7px; letter-spacing:.1em; color:#93a4c4; text-shadow:none; margin-top:1px; }
.ff3d-aglbl{ position:absolute; transform:translate(-50%,-120%); font-family:'JetBrains Mono',ui-monospace,monospace; font-size:9px; letter-spacing:.04em; color:#cfe6ff; background:rgba(6,10,20,.5); border:1px solid rgba(120,180,255,.25); padding:2px 7px; border-radius:6px; white-space:nowrap; backdrop-filter:blur(2px); transition:opacity .2s; box-shadow:0 0 10px -4px currentColor; }
.ff3d-aglbl b{ color:currentColor; font-family:'Orbitron',sans-serif; font-weight:700; }
.ff3d-aglbl.work{ border-color:currentColor; box-shadow:0 0 14px -3px currentColor; }
.ff3d-hud-top{ position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; gap:10px; padding:10px 12px; z-index:8; pointer-events:none; flex-wrap:wrap; }
.ff3d-glass{ pointer-events:auto; background:rgba(9,13,24,.55); backdrop-filter:blur(8px); border:1px solid rgba(120,180,255,.18); border-radius:10px; }
.ff3d-brand{ display:flex; align-items:center; gap:12px; padding:7px 13px; }
.ff3d-logo{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:14px; letter-spacing:.12em; color:#e7f4ff; text-shadow:0 0 16px rgba(60,230,255,.5); }
.ff3d-op{ font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:.1em; color:#93a4c4; text-transform:uppercase; }
.ff3d-op b{ color:#3ce6ff; }
.ff3d-eco{ font-family:'JetBrains Mono',monospace; font-size:8px; font-weight:700; letter-spacing:.2em; color:#5cf2a8; text-transform:uppercase; padding:2px 7px; border:1px solid rgba(92,242,168,.35); border-radius:6px; background:rgba(92,242,168,.08); text-shadow:0 0 10px rgba(92,242,168,.4); }
.ff3d-online{ width:8px; height:8px; border-radius:50%; background:#5cf2a8; box-shadow:0 0 10px #5cf2a8; animation:ff3dblink 1.8s infinite; }
.ff3d-onlbl{ color:#5cf2a8 !important; font-weight:700; }
.ff3d-biz{ font-family:'JetBrains Mono',monospace; font-size:8px; font-weight:700; letter-spacing:.14em; color:#93a4c4; text-transform:uppercase; padding:2px 7px; border:1px solid rgba(120,180,255,.2); border-radius:6px; background:rgba(0,0,0,.25); }
.ff3d-auto{ color:#5cf2a8 !important; font-weight:700; text-shadow:0 0 10px rgba(92,242,168,.6); animation:ff3dblink 1.1s infinite; }
.ff3d-auto-on{ border-color:rgba(92,242,168,.7) !important; color:#08160f !important; background:linear-gradient(180deg,#7ef0b0,#2fbf7a) !important; box-shadow:0 0 18px -4px rgba(92,242,168,.6); }
.ff3d-stats{ display:flex; align-items:center; gap:11px; padding:7px 13px; font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:.1em; color:#93a4c4; text-transform:uppercase; }
.ff3d-stats b{ color:#eaf2ff; font-size:11px; }
.ff3d-light{ width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,.2); }
.ff3d-light[data-on="true"]{ background:#3ce6ff; box-shadow:0 0 10px #3ce6ff; animation:ff3dblink 1.4s infinite; }
.ff3d-phase{ color:#ff8a3c !important; text-shadow:0 0 10px rgba(255,138,60,.6); animation:ff3dblink 1s infinite; }
.ff3d-hint{ position:absolute; left:12px; top:54px; z-index:7; font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:.04em; color:#3ce6ff; background:rgba(6,12,24,.55); border:1px solid rgba(120,180,255,.16); padding:5px 10px; border-radius:8px; backdrop-filter:blur(3px); pointer-events:none; }
.ff3d-controls{ position:absolute; bottom:0; left:0; right:0; display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:10px 12px; z-index:8; background:linear-gradient(0deg, rgba(4,6,14,.65), transparent); }
.ff3d-btn{ font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; padding:9px 15px; border-radius:9px; cursor:pointer; border:1px solid; background:transparent; color:#fff; display:inline-flex; align-items:center; gap:7px; transition:filter .15s, transform .08s; }
.ff3d-btn:active:not(:disabled){ transform:translateY(1px); }
.ff3d-btn:disabled{ opacity:.45; cursor:not-allowed; }
.ff3d-primary{ border-color:rgba(255,138,60,.7); color:#160a04; background:linear-gradient(180deg,#ffae6a,#e0590f); box-shadow:0 0 20px -4px rgba(255,138,60,.55); }
.ff3d-secondary{ border-color:rgba(60,230,255,.45); color:#3ce6ff; background:rgba(60,230,255,.08); }
.ff3d-ghost{ border-color:rgba(120,180,255,.2); color:#93a4c4; }
.ff3d-approve{ border-color:rgba(92,242,168,.55); color:#c4f7dc; background:rgba(92,242,168,.12); }
.ff3d-row{ display:inline-flex; align-items:center; gap:7px; }
.ff3d-spin{ width:11px; height:11px; border:1.7px solid currentColor; border-top-color:transparent; border-radius:50%; animation:ff3dspin .7s linear infinite; }
.ff3d-ticker{ margin-left:auto; display:flex; align-items:center; gap:8px; min-width:0; flex:1 1 200px; }
.ff3d-tl{ font-family:'JetBrains Mono',monospace; font-size:8.5px; font-weight:700; letter-spacing:.14em; color:#3ce6ff; opacity:.7; flex:0 0 auto; }
.ff3d-tt{ font-family:'JetBrains Mono',monospace; font-size:10px; color:#93a4c4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; animation:ff3dfade .5s ease; }
@keyframes ff3dfade{ from{ opacity:0; transform:translateX(6px); } to{ opacity:1; transform:none; } }
.ff3d-scrim{ position:absolute; inset:0; z-index:16; background:rgba(3,6,14,.45); backdrop-filter:blur(2px); }
.ff3d-inspector{ position:absolute; top:0; right:0; bottom:0; width:min(340px,90%); z-index:17; background:linear-gradient(160deg,rgba(12,18,34,.98),rgba(7,10,20,.99)); border-left:1px solid rgba(120,180,255,.16); box-shadow:-34px 0 64px -34px #000; display:flex; flex-direction:column; overflow:hidden; animation:ff3dslide .28s cubic-bezier(.4,0,.2,1); }
@keyframes ff3dslide{ from{ transform:translateX(102%);} to{ transform:translateX(0);} }
.ff3d-ihead{ padding:14px 16px; border-bottom:1px solid rgba(120,180,255,.16); display:flex; align-items:center; gap:11px; background:linear-gradient(90deg, color-mix(in srgb, var(--ic) 16%, transparent), transparent); }
.ff3d-iic{ width:30px; height:30px; border-radius:8px; flex:0 0 auto; box-shadow:0 0 14px currentColor; }
.ff3d-ititle{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:14px; letter-spacing:.04em; color:#eaf2ff; }
.ff3d-isub{ font-family:'JetBrains Mono',monospace; font-size:8.5px; letter-spacing:.1em; text-transform:uppercase; color:#5d6b88; margin-top:3px; }
.ff3d-ipill{ font-family:'JetBrains Mono',monospace; font-size:8px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; padding:4px 9px; border-radius:999px; border:1px solid rgba(120,180,255,.16); color:#93a4c4; }
.ff3d-ipill.work{ color:#3ce6ff; border-color:rgba(60,230,255,.4); background:rgba(60,230,255,.1); }
.ff3d-ipill.wait{ color:#ffc24a; border-color:rgba(255,194,74,.4); background:rgba(255,194,74,.1); }
.ff3d-ix{ margin-left:auto; width:26px; height:26px; border-radius:7px; border:1px solid rgba(120,180,255,.16); background:rgba(0,0,0,.3); color:#93a4c4; cursor:pointer; font-size:13px; }
.ff3d-ibody{ flex:1; overflow-y:auto; padding:14px 16px; display:flex; flex-direction:column; gap:14px; }
.ff3d-isec h4{ margin:0 0 7px; font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:#3ce6ff; }
.ff3d-assign{ margin:0; font-size:12.5px; line-height:1.5; color:#eaf2ff; }
.ff3d-stat{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.ff3d-cell{ border:1px solid rgba(120,180,255,.16); border-radius:9px; background:rgba(0,0,0,.25); padding:8px 10px; }
.ff3d-cl{ font-family:'JetBrains Mono',monospace; font-size:8px; letter-spacing:.1em; text-transform:uppercase; color:#5d6b88; }
.ff3d-cv{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:15px; margin-top:3px; color:#eaf6ff; }
.ff3d-row2{ display:flex; align-items:center; gap:9px; border:1px solid rgba(120,180,255,.16); border-radius:9px; background:rgba(0,0,0,.22); padding:7px 9px; }
.ff3d-sw{ width:22px; height:22px; border-radius:5px; flex:0 0 auto; }
.ff3d-rt{ font-size:11.5px; font-weight:600; color:#eaf2ff; }
.ff3d-rs{ font-family:'JetBrains Mono',monospace; font-size:8.5px; color:#5d6b88; }
.ff3d-pr{ margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:10px; color:#5cf2a8; }
.ff3d-iact{ display:flex; gap:8px; padding:12px 16px; border-top:1px solid rgba(120,180,255,.16); background:rgba(0,0,0,.3); }
@keyframes ff3dblink{ 0%,100%{ opacity:1; } 50%{ opacity:.35; } }
@keyframes ff3dspin{ to{ transform:rotate(360deg); } }
`;
