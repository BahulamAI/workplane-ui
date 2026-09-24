import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Block, Scene, WorkplaneController } from "../core/index.js";
import type { RendererRegistry } from "./registry.js";

export interface WorkplaneContextValue {
  controller: WorkplaneController;
  renderers: RendererRegistry;
}

const WorkplaneContext = createContext<WorkplaneContextValue | null>(null);
const SceneContext = createContext<Scene | null>(null);
const BlockContext = createContext<Block | null>(null);

export function useWorkplaneContext(): WorkplaneContextValue {
  const value = useContext(WorkplaneContext);
  if (!value) {
    throw new Error("Workplane components must be rendered inside <WorkplaneProvider>.");
  }
  return value;
}

export function useSceneContext(): Scene {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error("This component must be rendered inside a Scene primitive.");
  return scene;
}

export function useBlockContext(): Block {
  const block = useContext(BlockContext);
  if (!block) throw new Error("This component must be rendered inside a Block primitive.");
  return block;
}

export function WorkplaneProvider(props: {
  controller: WorkplaneController;
  renderers: RendererRegistry;
  children: ReactNode;
}): ReactNode {
  const value = useMemo(
    () => ({ controller: props.controller, renderers: props.renderers }),
    [props.controller, props.renderers],
  );
  return <WorkplaneContext.Provider value={value}>{props.children}</WorkplaneContext.Provider>;
}

export const SceneProvider = SceneContext.Provider;
export const BlockProvider = BlockContext.Provider;
