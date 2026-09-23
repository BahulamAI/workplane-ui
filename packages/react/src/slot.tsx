import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode, type Ref } from "react";

/**
 * Minimal `asChild` implementation — merges the primitive's behaviour onto the
 * consumer's own element instead of rendering a wrapper.
 *
 * Deliberately not a Radix dependency: the shell must stay embeddable in a
 * host that already has its own component library, and one more peer
 * dependency is one more version conflict for an integrator.
 */
type AnyProps = Record<string, unknown> & { children?: ReactNode; ref?: Ref<unknown> };

function mergeProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const merged: AnyProps = { ...childProps };

  for (const [key, slotValue] of Object.entries(slotProps)) {
    const childValue = childProps[key];

    // Event handlers: the child's runs first, then the primitive's.
    if (/^on[A-Z]/.test(key)) {
      if (typeof slotValue === "function" && typeof childValue === "function") {
        merged[key] = (...args: unknown[]) => {
          (childValue as (...a: unknown[]) => void)(...args);
          (slotValue as (...a: unknown[]) => void)(...args);
        };
      } else if (typeof slotValue === "function") {
        merged[key] = slotValue;
      }
      continue;
    }

    if (key === "className") {
      merged[key] = [slotValue, childValue].filter(Boolean).join(" ");
      continue;
    }
    if (key === "style") {
      merged[key] = { ...(slotValue as object), ...(childValue as object) };
      continue;
    }
    // The child wins for everything else, so a consumer can always override.
    if (childValue === undefined) merged[key] = slotValue;
  }

  return merged;
}

export function Slot({ children, ...props }: AnyProps): ReactElement | null {
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const element = child as ReactElement<AnyProps>;
  return cloneElement(element, mergeProps(props, element.props));
}
