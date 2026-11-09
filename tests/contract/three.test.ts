/**
 * The 3D contract, tested where it lives: headless.
 *
 * Putting the timeline arithmetic in the contract rather than the component is
 * what makes this possible — the animation engine is a pure function, so the
 * part most likely to be subtly wrong is the part that needs no GPU to check.
 */
import { describe, expect, it } from "vitest";
import { sampleTrack, threeContract, timelinePosition, type ThreeTrack } from "@bahulam/workplane-ui";

const valid = threeContract.example as Record<string, unknown>;

function accepts(patch: Record<string, unknown>) {
  return threeContract.validate({ ...valid, ...patch });
}

/**
 * Replace the objects without keeping the example's timeline, which targets
 * them by id. Leaving it in makes every object-level case fail for the
 * unrelated reason that its track now points at nothing.
 */
function withObjects(objects: unknown) {
  const { timeline: _timeline, ...rest } = valid;
  return threeContract.validate({ ...rest, objects });
}

describe("the 3D spec refuses what it cannot draw safely", () => {
  it("accepts its own advertised example", () => {
    const outcome = threeContract.validate(valid);
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("requires alt text, because a 3D scene shows a blind reader nothing", () => {
    for (const alt of [undefined, "", "   "]) {
      const outcome = accepts({ alt });
      expect(outcome.ok, `alt ${JSON.stringify(alt)} was accepted`).toBe(false);
      if (!outcome.ok) expect(outcome.path).toBe("/alt");
    }
  });

  it("takes colours as hex and nothing else", () => {
    // A colour is the one string field that would otherwise be handed to a
    // styling engine, so it is the one field worth constraining by shape.
    for (const color of ["red", "url(#x)", "var(--wp-accent)", "rgb(0,0,0)", "#12345", "javascript:1"]) {
      const outcome = withObjects([{ id: "a", shape: "box", dimensions: [1, 1, 1], color }]);
      expect(outcome.ok, `${color} was accepted as a colour`).toBe(false);
    }
    expect(withObjects([{ id: "a", shape: "box", dimensions: [1, 1, 1], color: "#3b82f6" }]).ok).toBe(true);
    expect(withObjects([{ id: "a", shape: "box", dimensions: [1, 1, 1], color: "#abc" }]).ok).toBe(true);
  });

  it("names the dimensions a shape expects when the count is wrong", () => {
    const outcome = withObjects([{ id: "a", shape: "torus", dimensions: [1] }]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // The message has to say what the shape wanted. "Invalid dimensions"
      // leaves an agent guessing between radius, tube, and segment counts.
      expect(outcome.message).toContain("radius");
      expect(outcome.message).toContain("tube");
    }
  });

  it("refuses a zero or negative dimension", () => {
    for (const dimensions of [[0, 1, 1], [1, -2, 1]]) {
      expect(withObjects([{ id: "a", shape: "box", dimensions }]).ok).toBe(false);
    }
  });

  it("refuses a track pointing at an object that does not exist", () => {
    const outcome = accepts({
      objects: [{ id: "real", shape: "box", dimensions: [1, 1, 1] }],
      timeline: {
        duration: 2,
        tracks: [{
          targetId: "ghost", property: "position",
          keyframes: [{ at: 0, value: [0, 0, 0] }, { at: 2, value: [1, 0, 0] }],
        }],
      },
    });
    expect(outcome.ok).toBe(false);
    // A dangling target animates nothing and looks like a renderer bug from the
    // outside, so the message lists what it could have meant.
    if (!outcome.ok) expect(outcome.message).toContain("real");
  });

  it("refuses keyframes that go backwards or past the duration", () => {
    const track = (keyframes: unknown[]) => accepts({
      objects: [{ id: "a", shape: "box", dimensions: [1, 1, 1] }],
      timeline: { duration: 4, tracks: [{ targetId: "a", property: "position", keyframes }] },
    });
    expect(track([{ at: 0, value: [0, 0, 0] }, { at: 3, value: [1, 0, 0] }]).ok).toBe(true);
    expect(track([{ at: 3, value: [0, 0, 0] }, { at: 1, value: [1, 0, 0] }]).ok).toBe(false);
    expect(track([{ at: 0, value: [0, 0, 0] }, { at: 9, value: [1, 0, 0] }]).ok).toBe(false);
    // One keyframe interpolates between nothing.
    expect(track([{ at: 0, value: [0, 0, 0] }]).ok).toBe(false);
  });

  it("matches the value shape to the property being animated", () => {
    const track = (property: string, value: unknown) => accepts({
      objects: [{ id: "a", shape: "box", dimensions: [1, 1, 1] }],
      timeline: {
        duration: 2,
        tracks: [{ targetId: "a", property, keyframes: [{ at: 0, value }, { at: 2, value }] }],
      },
    });
    expect(track("opacity", 0.5).ok).toBe(true);
    expect(track("opacity", [0.5, 0, 0]).ok).toBe(false);
    expect(track("position", [1, 2, 3]).ok).toBe(true);
    expect(track("position", 1).ok).toBe(false);
  });

  it("refuses non-finite numbers wherever they appear", () => {
    // NaN and Infinity survive a JSON round-trip as null, so the guard has to
    // reject the null too or a camera ends up at an undefined position.
    expect(accepts({ camera: { position: [0, null, 5] } }).ok).toBe(false);
    expect(accepts({ camera: { position: [0, 1] } }).ok).toBe(false);
    expect(accepts({ camera: { position: [0, 1, 2, 3] } }).ok).toBe(false);
  });

  it("bounds the scene so a valid-looking spec cannot exhaust the reader's GPU", () => {
    const objects = Array.from({ length: 300 }, (_, i) => ({
      id: `o${i}`, shape: "box", dimensions: [1, 1, 1],
    }));
    const outcome = withObjects(objects);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/at most 200/i);
  });

  it("refuses duplicate object ids, which a track could not disambiguate", () => {
    expect(withObjects([
      { id: "same", shape: "box", dimensions: [1, 1, 1] },
      { id: "same", shape: "sphere", dimensions: [1] },
    ]).ok).toBe(false);
  });

  it("carries no field that could name code, a shader, or a file to load", () => {
    // The envelope drops unknown keys rather than failing, so the assertion is
    // that they do not survive into the validated spec.
    const outcome = threeContract.validate({
      ...valid,
      script: "while(true){}",
      shader: "void main(){}",
      modelUrl: "https://example.com/scene.glb",
      texture: "data:image/png;base64,AAAA",
    });
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    if (outcome.ok) {
      const keys = Object.keys(outcome.value as Record<string, unknown>);
      expect(keys).not.toContain("script");
      expect(keys).not.toContain("shader");
      expect(keys).not.toContain("modelUrl");
      expect(keys).not.toContain("texture");
    }
  });

  it("declares that it needs a GPU and cannot be exported statically", () => {
    expect(threeContract.capabilities.requiresWebGL).toBe(true);
    expect(threeContract.capabilities.suspend).toBe(true);
    // Honest capability flags are what let a presenter and a print path do the
    // right thing without asking the renderer to try and fail.
    expect(threeContract.capabilities.staticExport).toBe(false);
    expect(threeContract.capabilities.thumbnail).toBe(false);
    expect(threeContract.requires).toBe("three");
  });
});

describe("the timeline is arithmetic, so it is checked without a GPU", () => {
  const track: ThreeTrack = {
    targetId: "a", property: "position",
    keyframes: [
      { at: 0, value: [0, 0, 0] },
      { at: 2, value: [10, 0, 0] },
      { at: 4, value: [10, 10, 0] },
    ],
  };

  it("interpolates between the surrounding keyframes", () => {
    expect(sampleTrack(track, 1)).toEqual([5, 0, 0]);
    expect(sampleTrack(track, 3)).toEqual([10, 5, 0]);
  });

  it("lands exactly on a keyframe", () => {
    expect(sampleTrack(track, 0)).toEqual([0, 0, 0]);
    expect(sampleTrack(track, 2)).toEqual([10, 0, 0]);
    expect(sampleTrack(track, 4)).toEqual([10, 10, 0]);
  });

  it("clamps outside the range instead of extrapolating", () => {
    // Extrapolation is the failure that destroys a scene: a scale track run
    // past its last keyframe grows without bound.
    expect(sampleTrack(track, -5)).toEqual([0, 0, 0]);
    expect(sampleTrack(track, 99)).toEqual([10, 10, 0]);
  });

  it("interpolates a scalar property", () => {
    const fade: ThreeTrack = {
      targetId: "a", property: "opacity",
      keyframes: [{ at: 0, value: 0 }, { at: 1, value: 1 }],
    };
    expect(sampleTrack(fade, 0.25)).toBeCloseTo(0.25);
  });

  it("eases when asked, and only then", () => {
    const frames = [{ at: 0, value: 0 }, { at: 1, value: 1 }];
    const linear: ThreeTrack = { targetId: "a", property: "opacity", keyframes: frames };
    const eased: ThreeTrack = { ...linear, easing: "easeInOut" };
    expect(sampleTrack(linear, 0.25)).toBeCloseTo(0.25);
    expect(sampleTrack(eased, 0.25)).toBeCloseTo(0.125);
    // Both agree at the ends, or the animation would jump on the first frame.
    expect(sampleTrack(eased, 0)).toBe(0);
    expect(sampleTrack(eased, 1)).toBe(1);
  });

  it("steps rather than dividing by zero on coincident keyframes", () => {
    const step: ThreeTrack = {
      targetId: "a", property: "opacity",
      keyframes: [{ at: 0, value: 0 }, { at: 1, value: 0 }, { at: 1, value: 1 }],
    };
    expect(Number.isFinite(sampleTrack(step, 1) as number)).toBe(true);
  });

  it("loops or holds, as the timeline says", () => {
    expect(timelinePosition({ duration: 4, loop: true, tracks: [] }, 9)).toBe(1);
    expect(timelinePosition({ duration: 4, tracks: [] }, 9)).toBe(4);
    expect(timelinePosition({ duration: 4, loop: true, tracks: [] }, 0)).toBe(0);
  });
});
