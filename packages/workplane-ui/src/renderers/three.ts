import { DEFAULT_SPEC_LIMITS, sanitizeSpec, type KeyTree, type SpecLimits } from "../core/index.js";
import type { RendererContract, ValidationOutcome } from "./contract.js";

/**
 * The 3D scene contract: geometry, lights, camera and a declarative timeline.
 *
 * Headless, like every contract here, and for a second reason beyond catalog
 * publication: the timeline is arithmetic, so it can be tested without a GPU.
 * `sampleTrack` is the whole animation engine, and it runs in Node.
 *
 * WHAT THIS DELIBERATELY DOES NOT ACCEPT: code, shaders, texture URLs, or model
 * files. An agent authors a scene the way it authors a chart — as data. A
 * `.glb` or an image is an artifact with an identity, a digest and a producing
 * job, and until that pipeline exists there is no honest way to reference one,
 * so the vocabulary here is primitives and colours. The envelope would refuse a
 * URL anyway; saying so in `purpose` saves the agent a rejection.
 */

export type Vec3 = [number, number, number];

export type ShapeKind = "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane";

/** Dimensions each shape expects, and what they mean in an error message. */
const SHAPE_DIMENSIONS: Record<ShapeKind, readonly string[]> = {
  box: ["width", "height", "depth"],
  sphere: ["radius"],
  cylinder: ["radius", "height"],
  cone: ["radius", "height"],
  torus: ["radius", "tube"],
  plane: ["width", "height"],
};

export interface ThreeObject {
  id: string;
  shape: ShapeKind;
  /** Positional, in the order `SHAPE_DIMENSIONS` names for that shape. */
  dimensions: number[];
  position?: Vec3;
  /** Radians. */
  rotation?: Vec3;
  scale?: Vec3;
  color?: string;
  opacity?: number;
  wireframe?: boolean;
  /** Named in the accessible description, so the scene is legible without sight. */
  label?: string;
}

export interface ThreeLight {
  kind: "ambient" | "directional" | "point";
  color?: string;
  intensity?: number;
  position?: Vec3;
}

export type TrackProperty = "position" | "rotation" | "scale" | "opacity";

export interface Keyframe {
  /** Seconds from the start of the timeline. */
  at: number;
  value: number | number[];
}

export interface ThreeTrack {
  targetId: string;
  property: TrackProperty;
  keyframes: Keyframe[];
  easing?: "linear" | "easeInOut";
}

export interface ThreeTimeline {
  /** Seconds. */
  duration: number;
  loop?: boolean;
  tracks: ThreeTrack[];
}

export interface ThreeSpec {
  /** Required: a 3D scene conveys nothing to a reader who cannot see it. */
  alt: string;
  caption?: string;
  background?: string;
  camera: { position: Vec3; lookAt?: Vec3; fov?: number };
  objects: ThreeObject[];
  lights?: ThreeLight[];
  timeline?: ThreeTimeline;
  /** Pointer-drag orbit. On by default; turn it off for a fixed diagram. */
  orbit?: boolean;
}

const THREE_ALLOW: KeyTree = {
  alt: true,
  caption: true,
  background: true,
  orbit: true,
  camera: { position: { $array: true }, lookAt: { $array: true }, fov: true },
  objects: {
    $array: {
      id: true, shape: true, dimensions: { $array: true },
      position: { $array: true }, rotation: { $array: true }, scale: { $array: true },
      color: true, opacity: true, wireframe: true, label: true,
    },
  },
  lights: { $array: { kind: true, color: true, intensity: true, position: { $array: true } } },
  timeline: {
    duration: true,
    loop: true,
    tracks: {
      $array: {
        targetId: true, property: true, easing: true,
        keyframes: { $array: { at: true, value: { $array: true, orSingle: true } } },
      },
    },
  },
};

/**
 * Bounds chosen for the reader's hardware, not ours. An unbounded object count
 * is a denial of service against whoever opens the document, and it arrives as
 * a perfectly valid-looking spec.
 */
const THREE_LIMITS: Partial<SpecLimits> = {
  maxDepth: 8,
  maxNodes: 6000,
  maxBytes: 512 * 1024,
  maxArrayLength: 400,
  maxStringLength: 512,
};

const MAX_OBJECTS = 200;
const MAX_LIGHTS = 8;
const MAX_TRACKS = 200;
const MAX_KEYFRAMES = 400;
const MAX_DURATION = 600;
/** Beyond this a scene is off-camera anyway, and the number is probably a bug. */
const MAX_COORDINATE = 1e4;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const LIGHT_KINDS = new Set(["ambient", "directional", "point"]);
const TRACK_PROPERTIES = new Set<TrackProperty>(["position", "rotation", "scale", "opacity"]);

type Fail = { ok: false; message: string; path?: string };
const fail = (message: string, path?: string): Fail => ({ ok: false, message, ...(path ? { path } : {}) });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkNumber(value: unknown, path: string): Fail | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail("Must be a finite number", path);
  }
  if (Math.abs(value) > MAX_COORDINATE) {
    return fail(`Must be within ±${MAX_COORDINATE}`, path);
  }
  return undefined;
}

function checkVec3(value: unknown, path: string): Fail | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return fail("Must be three numbers: [x, y, z]", path);
  }
  for (const [index, entry] of value.entries()) {
    const bad = checkNumber(entry, `${path}/${index}`);
    if (bad) return bad;
  }
  return undefined;
}

function checkColor(value: unknown, path: string): Fail | undefined {
  if (value === undefined) return undefined;
  // Hex only. A colour is the one place a renderer would otherwise accept an
  // arbitrary string and hand it to a styling engine.
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    return fail('Must be a hex colour such as "#3b82f6"', path);
  }
  return undefined;
}

function validateObject(raw: unknown, index: number): Fail | { ok: true; value: ThreeObject } {
  const at = `/objects/${index}`;
  if (!isObject(raw)) return fail("Must be an object", at);
  if (typeof raw.id !== "string" || raw.id.length === 0) return fail('"id" is required', `${at}/id`);

  const shape = raw.shape;
  if (typeof shape !== "string" || !(shape in SHAPE_DIMENSIONS)) {
    return fail(
      `"shape" must be one of: ${Object.keys(SHAPE_DIMENSIONS).join(", ")}`,
      `${at}/shape`,
    );
  }
  const expected = SHAPE_DIMENSIONS[shape as ShapeKind];
  if (!Array.isArray(raw.dimensions) || raw.dimensions.length !== expected.length) {
    return fail(
      `"${shape}" expects dimensions [${expected.join(", ")}]`,
      `${at}/dimensions`,
    );
  }
  for (const [i, entry] of raw.dimensions.entries()) {
    const bad = checkNumber(entry, `${at}/dimensions/${i}`);
    if (bad) return bad;
    if ((entry as number) <= 0) return fail(`"${expected[i]}" must be greater than zero`, `${at}/dimensions/${i}`);
  }

  for (const key of ["position", "rotation", "scale"] as const) {
    if (raw[key] !== undefined) {
      const bad = checkVec3(raw[key], `${at}/${key}`);
      if (bad) return bad;
    }
  }
  const badColor = checkColor(raw.color, `${at}/color`);
  if (badColor) return badColor;
  if (raw.opacity !== undefined) {
    if (typeof raw.opacity !== "number" || raw.opacity < 0 || raw.opacity > 1) {
      return fail('"opacity" must be between 0 and 1', `${at}/opacity`);
    }
  }
  return { ok: true, value: raw as unknown as ThreeObject };
}

function validateTrack(raw: unknown, index: number, ids: Set<string>, duration: number): Fail | { ok: true } {
  const at = `/timeline/tracks/${index}`;
  if (!isObject(raw)) return fail("Must be an object", at);
  if (typeof raw.targetId !== "string" || !ids.has(raw.targetId)) {
    // A dangling target animates nothing and looks like a renderer bug from the
    // outside, so it is refused where the cause is still visible.
    return fail(
      `"targetId" must name a declared object. Known ids: ${[...ids].join(", ") || "(none)"}`,
      `${at}/targetId`,
    );
  }
  if (typeof raw.property !== "string" || !TRACK_PROPERTIES.has(raw.property as TrackProperty)) {
    return fail(`"property" must be one of: ${[...TRACK_PROPERTIES].join(", ")}`, `${at}/property`);
  }
  if (!Array.isArray(raw.keyframes) || raw.keyframes.length < 2) {
    return fail('"keyframes" needs at least two entries to interpolate between', `${at}/keyframes`);
  }
  if (raw.keyframes.length > MAX_KEYFRAMES) {
    return fail(`At most ${MAX_KEYFRAMES} keyframes`, `${at}/keyframes`);
  }

  const scalar = raw.property === "opacity";
  let previous = -Infinity;
  for (const [i, frame] of raw.keyframes.entries()) {
    const framePath = `${at}/keyframes/${i}`;
    if (!isObject(frame)) return fail("Must be an object", framePath);
    const badAt = checkNumber(frame.at, `${framePath}/at`);
    if (badAt) return badAt;
    const seconds = frame.at as number;
    if (seconds < 0 || seconds > duration) {
      return fail(`"at" must be between 0 and the timeline duration (${duration})`, `${framePath}/at`);
    }
    // Ordered, because interpolation walks them in order and unordered frames
    // would silently play backwards through part of the animation.
    if (seconds < previous) return fail('"at" must not go backwards', `${framePath}/at`);
    previous = seconds;

    if (scalar) {
      const bad = checkNumber(frame.value, `${framePath}/value`);
      if (bad) return bad;
    } else {
      const bad = checkVec3(frame.value, `${framePath}/value`);
      if (bad) return bad;
    }
  }
  return { ok: true };
}

function validateThreeSpec(spec: unknown): ValidationOutcome<ThreeSpec> {
  const sanitized = sanitizeSpec<ThreeSpec>(spec, {
    allow: THREE_ALLOW,
    limits: { ...DEFAULT_SPEC_LIMITS, ...THREE_LIMITS },
  });
  if (!sanitized.ok) {
    const first = sanitized.violations[0]!;
    return fail(first.message, first.path);
  }
  const value = sanitized.value;
  if (!isObject(value)) return fail("Spec must be an object");

  if (typeof value.alt !== "string" || value.alt.trim().length === 0) {
    return fail(
      '"alt" is REQUIRED: describe what the scene shows, for readers who cannot see it.',
      "/alt",
    );
  }
  const badBackground = checkColor(value.background, "/background");
  if (badBackground) return badBackground;

  if (!isObject(value.camera)) return fail('"camera" is required', "/camera");
  const badPosition = checkVec3(value.camera.position, "/camera/position");
  if (badPosition) return badPosition;
  if (value.camera.lookAt !== undefined) {
    const bad = checkVec3(value.camera.lookAt, "/camera/lookAt");
    if (bad) return bad;
  }
  if (value.camera.fov !== undefined) {
    if (typeof value.camera.fov !== "number" || value.camera.fov < 10 || value.camera.fov > 120) {
      return fail('"fov" must be between 10 and 120 degrees', "/camera/fov");
    }
  }

  if (!Array.isArray(value.objects) || value.objects.length === 0) {
    return fail('"objects" must be a non-empty array', "/objects");
  }
  if (value.objects.length > MAX_OBJECTS) {
    return fail(`At most ${MAX_OBJECTS} objects — a larger scene is a burden on the reader's hardware`, "/objects");
  }
  const ids = new Set<string>();
  for (const [index, raw] of value.objects.entries()) {
    const outcome = validateObject(raw, index);
    if (!outcome.ok) return outcome;
    if (ids.has(outcome.value.id)) {
      return fail(`Duplicate object id "${outcome.value.id}"`, `/objects/${index}/id`);
    }
    ids.add(outcome.value.id);
  }

  if (value.lights !== undefined) {
    if (!Array.isArray(value.lights) || value.lights.length > MAX_LIGHTS) {
      return fail(`"lights" must be an array of at most ${MAX_LIGHTS}`, "/lights");
    }
    for (const [index, raw] of value.lights.entries()) {
      const at = `/lights/${index}`;
      if (!isObject(raw)) return fail("Must be an object", at);
      if (typeof raw.kind !== "string" || !LIGHT_KINDS.has(raw.kind)) {
        return fail(`"kind" must be one of: ${[...LIGHT_KINDS].join(", ")}`, `${at}/kind`);
      }
      const badColor = checkColor(raw.color, `${at}/color`);
      if (badColor) return badColor;
      if (raw.position !== undefined) {
        const bad = checkVec3(raw.position, `${at}/position`);
        if (bad) return bad;
      }
    }
  }

  if (value.timeline !== undefined) {
    const timeline = value.timeline;
    if (!isObject(timeline)) return fail('"timeline" must be an object', "/timeline");
    if (typeof timeline.duration !== "number" || timeline.duration <= 0 || timeline.duration > MAX_DURATION) {
      return fail(`"duration" must be between 0 and ${MAX_DURATION} seconds`, "/timeline/duration");
    }
    if (!Array.isArray(timeline.tracks) || timeline.tracks.length === 0) {
      return fail('"tracks" must be a non-empty array', "/timeline/tracks");
    }
    if (timeline.tracks.length > MAX_TRACKS) {
      return fail(`At most ${MAX_TRACKS} tracks`, "/timeline/tracks");
    }
    for (const [index, raw] of timeline.tracks.entries()) {
      const outcome = validateTrack(raw, index, ids, timeline.duration);
      if (!outcome.ok) return outcome;
    }
  }

  return { ok: true, value: value as ThreeSpec };
}

// --- the animation engine, such as it is ----------------------------------

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * The value of one track at a moment in time.
 *
 * Before the first keyframe it holds the first value and after the last it holds
 * the last — clamping rather than extrapolating, because an extrapolated scale
 * runs to infinity and the reader sees a scene that destroys itself.
 */
export function sampleTrack(track: ThreeTrack, seconds: number): number | number[] {
  const frames = track.keyframes;
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (seconds <= first.at) return first.value;
  if (seconds >= last.at) return last.value;

  let index = 0;
  while (index < frames.length - 2 && frames[index + 1]!.at <= seconds) index += 1;
  const from = frames[index]!;
  const to = frames[index + 1]!;
  const span = to.at - from.at;
  // Coincident keyframes: a step change, not a division by zero.
  const raw = span <= 0 ? 1 : (seconds - from.at) / span;
  const t = track.easing === "easeInOut" ? easeInOut(raw) : raw;

  if (typeof from.value === "number" && typeof to.value === "number") {
    return from.value + (to.value - from.value) * t;
  }
  const a = from.value as number[];
  const b = to.value as number[];
  return a.map((component, i) => component + ((b[i] ?? component) - component) * t);
}

/** Where the timeline's playhead sits, honouring `loop`. */
export function timelinePosition(timeline: ThreeTimeline, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  if (!timeline.loop) return Math.min(elapsedSeconds, timeline.duration);
  return elapsedSeconds % timeline.duration;
}

export const threeContract: RendererContract<ThreeSpec> = {
  id: "workplane.three",
  specVersions: ["1"],
  trust: "host-reviewed",
  requires: "three",
  capabilities: {
    interactive: true,
    selection: false,
    // No still image without a GPU, so neither a thumbnail nor a print export
    // can be produced from the spec alone. The block's own `fallback` text and
    // required `alt` are what a reader gets instead.
    thumbnail: false,
    staticExport: false,
    suspend: true,
    requiresWebGL: true,
  },
  purpose:
    "A 3D scene built from primitives (box, sphere, cylinder, cone, torus, plane) with lights, " +
    "a camera and an optional keyframe timeline. Use it for spatial structure a diagram cannot " +
    "show. `alt` is REQUIRED. Colours are hex. There is NO code, shader, texture or model-file " +
    "field — this renderer draws declared geometry, nothing loaded from elsewhere.",
  // Trimmed to what it has to teach: alt is required, colours are hex,
  // dimensions are positional per shape, and a track interpolates between
  // keyframes. Lights are omitted on purpose — they are optional, and the
  // renderer lights an unlit scene rather than showing silhouettes.
  example: {
    alt: "Two stacked cubes, the upper one rotating, representing a service above its datastore.",
    camera: { position: [6, 5, 8], lookAt: [0, 1, 0] },
    objects: [
      { id: "store", shape: "box", dimensions: [3, 0.6, 3], color: "#1f5fd6", label: "Datastore" },
      { id: "service", shape: "box", dimensions: [2, 0.6, 2], position: [0, 1, 0], color: "#2f9e6e", label: "Service" },
    ],
    timeline: {
      duration: 8,
      loop: true,
      tracks: [{
        targetId: "service", property: "rotation",
        keyframes: [{ at: 0, value: [0, 0, 0] }, { at: 8, value: [0, 6.283, 0] }],
      }],
    },
  },
  validate: validateThreeSpec,
  summarize: (spec) => {
    const shapes = [...new Set(spec.objects.map((object) => object.shape))].join("/");
    const animated = spec.timeline ? `, ${spec.timeline.duration}s timeline` : "";
    return `3D scene: ${spec.objects.length} ${shapes} objects${animated}`;
  },
};
