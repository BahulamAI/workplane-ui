export * from "./renderer.js";
// The spec types, validator and timeline maths live in the headless contract
// layer so a host can advertise 3D scenes without installing three.
export {
  threeContract,
  sampleTrack,
  timelinePosition,
  type Keyframe,
  type ShapeKind,
  type ThreeLight,
  type ThreeObject,
  type ThreeSpec,
  type ThreeTimeline,
  type ThreeTrack,
  type TrackProperty,
  type Vec3,
} from "../renderers/three.js";
