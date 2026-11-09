import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { RendererDefinition, RendererProps } from "../react/index.js";
import {
  sampleTrack,
  threeContract,
  timelinePosition,
  type ThreeObject,
  type ThreeSpec,
} from "../renderers/index.js";

/**
 * The 3D adapter. The only file in this package that imports `three`.
 *
 * Almost all of the care here is about giving the GPU back. A WebGL context is
 * a scarce, process-wide resource — browsers keep roughly eight alive and drop
 * the oldest without asking — so a presenter that slides through scenes will
 * silently kill earlier canvases unless blocks release their contexts when they
 * stop being looked at. Two mechanisms, for two different failures:
 *
 *   `activity`  the presenter saying this block is no longer on screen. The
 *               context is disposed and the last frame kept as a poster, so
 *               coming back is a decode rather than a rebuild.
 *   the LEASE   a cap on simultaneously live contexts, for the case the
 *               presenter cannot help with: several 3D blocks in ONE scene,
 *               which section 5.4.2 explicitly permits.
 *
 * Together they mean a document full of 3D blocks degrades to posters and a
 * stated reason, instead of to blank rectangles.
 */

/**
 * Deliberately below the browser's own ceiling. Being refused a context by us
 * produces an explanation; being refused by the browser produces a lost canvas
 * somewhere else on the page.
 */
const MAX_LIVE_CONTEXTS = 4;
let liveContexts = 0;

function acquireContext(): boolean {
  if (liveContexts >= MAX_LIVE_CONTEXTS) return false;
  liveContexts += 1;
  return true;
}

function releaseContext(): void {
  liveContexts = Math.max(0, liveContexts - 1);
}

/** For tests and diagnostics. Never used to make a rendering decision. */
export function liveWebGLContexts(): number {
  return liveContexts;
}

/**
 * Whether this environment can give us a context at all.
 *
 * Checked before touching `three`, so a server render, a jsdom test, or a
 * machine with WebGL disabled produces a stated reason rather than a thrown
 * constructor.
 */
function webGLAvailable(): boolean {
  if (typeof globalThis.document === "undefined") return false;
  try {
    const probe = globalThis.document.createElement("canvas");
    const context =
      probe.getContext("webgl2") ?? probe.getContext("webgl") ?? probe.getContext("experimental-webgl");
    if (!context) return false;
    // Give the probe's own context straight back rather than waiting for GC.
    (context as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function geometryFor(object: ThreeObject): THREE.BufferGeometry {
  const d = object.dimensions;
  switch (object.shape) {
    case "box":
      return new THREE.BoxGeometry(d[0], d[1], d[2]);
    case "sphere":
      return new THREE.SphereGeometry(d[0], 32, 16);
    case "cylinder":
      return new THREE.CylinderGeometry(d[0], d[0], d[1], 32);
    case "cone":
      return new THREE.ConeGeometry(d[0], d[1], 32);
    case "torus":
      return new THREE.TorusGeometry(d[0], d[1], 16, 48);
    case "plane":
      return new THREE.PlaneGeometry(d[0], d[1]);
  }
}

interface Built {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  meshes: Map<string, THREE.Mesh>;
}

function buildScene(spec: ThreeSpec, aspect: number): Built {
  const scene = new THREE.Scene();
  if (spec.background) scene.background = new THREE.Color(spec.background);

  const camera = new THREE.PerspectiveCamera(spec.camera.fov ?? 50, aspect, 0.1, 1000);
  camera.position.set(...spec.camera.position);
  camera.lookAt(new THREE.Vector3(...(spec.camera.lookAt ?? [0, 0, 0])));

  const meshes = new Map<string, THREE.Mesh>();
  for (const object of spec.objects) {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(object.color ?? "#9aa3b2"),
      transparent: object.opacity !== undefined && object.opacity < 1,
      opacity: object.opacity ?? 1,
      wireframe: object.wireframe === true,
    });
    const mesh = new THREE.Mesh(geometryFor(object), material);
    if (object.position) mesh.position.set(...object.position);
    if (object.rotation) mesh.rotation.set(...object.rotation);
    if (object.scale) mesh.scale.set(...object.scale);
    mesh.name = object.id;
    scene.add(mesh);
    meshes.set(object.id, mesh);
  }

  // A scene with no declared lights would render as silhouettes, which looks
  // like a broken renderer rather than an authoring omission.
  const lights = spec.lights ?? [{ kind: "ambient" as const, intensity: 0.6 }, { kind: "directional" as const, position: [5, 10, 7] as const, intensity: 1 }];
  for (const light of lights) {
    const color = new THREE.Color(light.color ?? "#ffffff");
    const intensity = light.intensity ?? 1;
    if (light.kind === "ambient") {
      scene.add(new THREE.AmbientLight(color, intensity));
    } else if (light.kind === "directional") {
      const directional = new THREE.DirectionalLight(color, intensity);
      directional.position.set(...(light.position ?? [5, 10, 7]));
      scene.add(directional);
    } else {
      const point = new THREE.PointLight(color, intensity);
      point.position.set(...(light.position ?? [0, 5, 0]));
      scene.add(point);
    }
  }

  return { scene, camera, meshes };
}

function applyTimeline(spec: ThreeSpec, meshes: Map<string, THREE.Mesh>, seconds: number): void {
  if (!spec.timeline) return;
  const at = timelinePosition(spec.timeline, seconds);
  for (const track of spec.timeline.tracks) {
    const mesh = meshes.get(track.targetId);
    if (!mesh) continue;
    const value = sampleTrack(track, at);
    if (track.property === "opacity") {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.transparent = true;
      material.opacity = value as number;
    } else {
      const [x, y, z] = value as number[];
      mesh[track.property].set(x ?? 0, y ?? 0, z ?? 0);
    }
  }
}

/** Release everything. `forceContextLoss` is the part that actually frees the GPU. */
function dispose(renderer: THREE.WebGLRenderer, built: Built): void {
  built.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (Array.isArray(material)) for (const entry of material) entry.dispose();
    else material?.dispose?.();
  });
  built.scene.clear();
  renderer.dispose();
  renderer.forceContextLoss();
}

type State =
  | { status: "idle" }
  | { status: "live" }
  /** Suspended, holding the last frame drawn. */
  | { status: "poster"; dataUrl: string }
  | { status: "unavailable"; message: string };

function ThreeComponent({ spec, block, activity }: RendererProps<ThreeSpec>): React.ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  /** Survives across suspensions, so returning to a scene is not a rebuild. */
  const posterRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Not being looked at: draw nothing and hold no context. This is the whole
    // point of the activity signal.
    if (activity !== "active") {
      setState(posterRef.current ? { status: "poster", dataUrl: posterRef.current } : { status: "idle" });
      return;
    }
    const host = hostRef.current;
    if (!host) return;

    if (!webGLAvailable()) {
      setState({
        status: "unavailable",
        message: "This view needs WebGL, which is unavailable in this browser or is turned off.",
      });
      return;
    }
    if (!acquireContext()) {
      setState({
        status: "unavailable",
        message: `Only ${MAX_LIVE_CONTEXTS} 3D views can draw at once. Scroll to this one on its own to see it.`,
      });
      return;
    }

    const width = host.clientWidth || 640;
    const height = host.clientHeight || 360;

    /**
     * Probing for WebGL and actually getting a renderer are different questions.
     * A context can be lost between the two, a driver can refuse, or the page
     * can already be at the browser's own limit — and a throw here would both
     * crash the block and strand the lease we just took, quietly shrinking the
     * budget for every 3D block after it.
     */
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (error) {
      releaseContext();
      setState({
        status: "unavailable",
        message: `This view could not start: ${(error as Error).message}`,
      });
      return;
    }
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    renderer.setSize(width, height, false);
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    // Touch orbit needs the browser to stop treating the drag as a scroll.
    canvas.style.touchAction = "none";
    host.appendChild(canvas);

    const built = buildScene(spec, width / Math.max(1, height));
    setState({ status: "live" });

    // --- orbit ------------------------------------------------------------
    // Written here rather than imported from three's examples: it is thirty
    // lines, it avoids depending on a subpath not every build exports, and it
    // lets the wheel handler be exactly as greedy as it needs to be.
    const target = new THREE.Vector3(...(spec.camera.lookAt ?? [0, 0, 0]));
    const offset = built.camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const orbitEnabled = spec.orbit !== false;

    function applyCamera(): void {
      const next = new THREE.Vector3().setFromSpherical(spherical).add(target);
      built.camera.position.copy(next);
      built.camera.lookAt(target);
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!orbitEnabled) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      spherical.theta -= (event.clientX - lastX) * 0.005;
      spherical.phi = Math.min(Math.PI - 0.01, Math.max(0.01, spherical.phi - (event.clientY - lastY) * 0.005));
      lastX = event.clientX;
      lastY = event.clientY;
      applyCamera();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    /**
     * Zoom, and the reason this listener is not passive.
     *
     * The Feed presenter deliberately never intercepts the wheel, which leaves
     * the gesture to whichever child wants it. Claiming it here is how zooming a
     * scene stops also advancing the feed — the child taking the gesture is the
     * mechanism, not a workaround.
     */
    const onWheel = (event: WheelEvent) => {
      if (!orbitEnabled) return;
      event.preventDefault();
      spherical.radius = Math.min(500, Math.max(0.5, spherical.radius * (1 + Math.sign(event.deltaY) * 0.1)));
      applyCamera();
    };

    /**
     * Arrow keys orbit while the view has focus.
     *
     * Two reasons, and both matter. A pointer-only 3D view fails WCAG 2.1.1.
     * And the Feed presenter decides whether to advance a scene by asking
     * whether the focused element has claimed the arrows — a view that is not
     * focusable can never claim them, so orbiting with the keyboard would
     * scroll the feed instead.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (!orbitEnabled) return;
      const step = event.shiftKey ? 0.2 : 0.08;
      switch (event.key) {
        case "ArrowLeft": spherical.theta += step; break;
        case "ArrowRight": spherical.theta -= step; break;
        case "ArrowUp": spherical.phi = Math.max(0.01, spherical.phi - step); break;
        case "ArrowDown": spherical.phi = Math.min(Math.PI - 0.01, spherical.phi + step); break;
        default: return;
      }
      event.preventDefault();
      applyCamera();
    };

    if (orbitEnabled) {
      host.addEventListener("keydown", onKeyDown);
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
    }

    // --- resize -----------------------------------------------------------
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            const w = host.clientWidth || width;
            const h = host.clientHeight || height;
            renderer.setSize(w, h, false);
            built.camera.aspect = w / Math.max(1, h);
            built.camera.updateProjectionMatrix();
          });
    observer?.observe(host);

    // --- the loop ---------------------------------------------------------
    const reduced = prefersReducedMotion();
    const startedAt = performance.now();
    let frame = 0;

    function draw(now: number): void {
      applyTimeline(spec, built.meshes, (now - startedAt) / 1000);
      renderer.render(built.scene, built.camera);
      frame = requestAnimationFrame(draw);
    }

    if (spec.timeline && !reduced) {
      frame = requestAnimationFrame(draw);
    } else {
      // Reduced motion, or nothing to animate: one frame, held. A still scene
      // is the required flat alternative, not a degraded one.
      applyTimeline(spec, built.meshes, 0);
      renderer.render(built.scene, built.camera);
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      if (orbitEnabled) {
        host.removeEventListener("keydown", onKeyDown);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.removeEventListener("wheel", onWheel);
      }
      // Capture the poster synchronously after a final render: the drawing
      // buffer is only guaranteed to hold anything in the same tick as the draw.
      try {
        renderer.render(built.scene, built.camera);
        posterRef.current = canvas.toDataURL("image/png");
      } catch {
        // A tainted or zero-sized canvas has no poster. The fallback text does.
      }
      dispose(renderer, built);
      releaseContext();
      canvas.remove();
    };
  }, [spec, activity]);

  const description = `${spec.alt}${
    spec.objects.some((object) => object.label)
      ? ` Parts: ${spec.objects.filter((o) => o.label).map((o) => o.label).join(", ")}.`
      : ""
  }`;

  return (
    <figure
      data-workplane="three"
      data-state={state.status}
      data-activity={activity}
      // Tells the Feed presenter's keyboard handler to leave the arrow keys
      // alone while this block has focus, so orbiting never advances the scene.
      data-workplane-claims-keys="true"
    >
      {/* Focusable: reachable by keyboard, and focus landing here is what tells
          the Feed presenter to leave the arrow keys alone. */}
      <div
        data-workplane="three-canvas"
        ref={hostRef}
        role="img"
        aria-label={description}
        tabIndex={spec.orbit === false ? undefined : 0}
        aria-describedby={spec.orbit === false ? undefined : `${block.id}-orbit-hint`}
      >
        {state.status === "poster" ? (
          <img src={state.dataUrl} alt={description} data-workplane="three-poster" />
        ) : null}
        {state.status === "unavailable" ? (
          <div data-workplane="three-unavailable" role="status">
            <p>{block.fallback}</p>
            <p data-workplane="fallback-detail">{state.message}</p>
          </div>
        ) : null}
      </div>
      <figcaption>{spec.caption ?? spec.alt}</figcaption>
      {spec.orbit === false ? null : (
        <p id={`${block.id}-orbit-hint`} data-workplane="three-hint">
          Focus this view and use the arrow keys to rotate it.
        </p>
      )}
    </figure>
  );
}

export const threeRenderer: RendererDefinition<ThreeSpec> = {
  ...threeContract,
  Component: ThreeComponent,
};
