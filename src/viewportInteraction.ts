/**
 * Unifies mouse drag+wheel and touch drag+pinch into pan/zoom callbacks for
 * a canvas element, via the Pointer Events API (one code path for mouse,
 * touch, and pen). Doesn't know what "pan" or "zoom" mean semantically —
 * callers decide whether that maps to a bitmap transform, a compass
 * heading, a field of view, or something else entirely.
 */

export interface ViewportInteractionOptions {
  /** A drag delta, in element-local CSS pixels. */
  onPan: (dxPx: number, dyPx: number) => void;
  /** A zoom multiplier (>1 = zoom in) and the gesture's focal point, in element-local CSS pixels. */
  onZoom: (factor: number, centerXPx: number, centerYPx: number) => void;
  /** Fired once at the start of each drag/wheel/pinch gesture, before onPan/onZoom. */
  onInteractionStart?: () => void;
  /** Fired on double-click / double-tap. */
  onReset?: () => void;
}

const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export function attachViewportInteraction(element: HTMLElement, options: ViewportInteractionOptions): void {
  element.style.touchAction = 'none';

  const pointers = new Map<number, { x: number; y: number }>();
  let lastPinchDistance: number | null = null;
  let lastPinchMid: { x: number; y: number } | null = null;
  let interacting = false;

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const beginInteraction = () => {
    if (!interacting) {
      interacting = true;
      options.onInteractionStart?.();
    }
  };

  element.addEventListener('pointerdown', (e) => {
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a best-effort convenience (keeps a drag going if the pointer leaves the
      // element's bounds); a pointer the browser doesn't consider "active" just skips it.
    }
    pointers.set(e.pointerId, localPoint(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      lastPinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      lastPinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  });

  element.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    const next = localPoint(e);
    pointers.set(e.pointerId, next);

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (lastPinchMid !== null && (mid.x !== lastPinchMid.x || mid.y !== lastPinchMid.y)) {
        beginInteraction();
        options.onPan(mid.x - lastPinchMid.x, mid.y - lastPinchMid.y);
      }
      if (lastPinchDistance !== null && lastPinchDistance > 1) {
        beginInteraction();
        options.onZoom(distance / lastPinchDistance, mid.x, mid.y);
      }
      lastPinchDistance = distance;
      lastPinchMid = mid;
    } else if (pointers.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      if (dx !== 0 || dy !== 0) {
        beginInteraction();
        options.onPan(dx, dy);
      }
    }
  });

  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      lastPinchDistance = null;
      lastPinchMid = null;
    }
    if (pointers.size === 0) interacting = false;
  };
  element.addEventListener('pointerup', endPointer);
  element.addEventListener('pointercancel', endPointer);
  element.addEventListener('pointerleave', endPointer);

  element.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      beginInteraction();
      const { x, y } = localPoint(e);
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      options.onZoom(factor, x, y);
      interacting = false;
    },
    { passive: false },
  );

  if (options.onReset) {
    element.addEventListener('dblclick', () => options.onReset?.());
  }
}
