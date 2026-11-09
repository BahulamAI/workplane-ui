/** 3D scene adapter. Requires the optional `three` peer dependency.
 *  Kept on its own entry point so a host that never uses 3D never loads it. */
export * from "./renderer-three/index.js";
