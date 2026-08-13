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
  /** Fired on a plain click/tap: a single pointer, released with negligible movement (not a drag, not part of a pinch). */
  onTap?: (xPx: number, yPx: number) => void;
}

const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const TAP_MOVEMENT_THRESHOLD_PX = 4;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 30;

export function attachViewportInteraction(element: HTMLElement, options: ViewportInteractionOptions): void {
  element.style.touchAction = 'none';

  const pointers = new Map<number, { x: number; y: number }>();
  let lastPinchDistance: number | null = null;
  let lastPinchMid: { x: number; y: number } | null = null;
  let interacting = false;
  // Non-null only while the current gesture is still a candidate for onTap: a single pointer
  // that hasn't moved past the threshold and hasn't been joined by a second pointer.
  let tapCandidate: { x: number; y: number } | null = null;

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
    const point = localPoint(e);
    pointers.set(e.pointerId, point);
    if (pointers.size === 1) {
      tapCandidate = point;
    } else {
      tapCandidate = null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastPinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        lastPinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }
  });

  element.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    const next = localPoint(e);
    pointers.set(e.pointerId, next);

    if (pointers.size === 2) {
      tapCandidate = null;
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
      if (tapCandidate && Math.hypot(next.x - tapCandidate.x, next.y - tapCandidate.y) > TAP_MOVEMENT_THRESHOLD_PX) {
        tapCandidate = null;
      }
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      if (dx !== 0 || dy !== 0) {
        beginInteraction();
        options.onPan(dx, dy);
      }
    }
  });

  // Double-tap/double-click detection is done here (not via the native `dblclick` event) so it's
  // coordinated with tap resolution: without that, a double-click would fire onTap twice (once per
  // click) *before* the browser's dblclick fires, e.g. relocating a picked point right before
  // resetting the view around it. Detected via pointer events, this also works consistently for
  // touch, which native dblclick synthesis from double-tap doesn't reliably provide everywhere.
  let pendingTapTimer: number | undefined;
  let lastTapTime = 0;
  let lastTapPoint: { x: number; y: number } | null = null;

  const resolveTap = (point: { x: number; y: number }) => {
    const now = performance.now();
    const isDoubleTap =
      now - lastTapTime < DOUBLE_TAP_MS &&
      lastTapPoint !== null &&
      Math.hypot(point.x - lastTapPoint.x, point.y - lastTapPoint.y) < DOUBLE_TAP_DISTANCE_PX;

    if (isDoubleTap) {
      window.clearTimeout(pendingTapTimer);
      lastTapTime = 0;
      lastTapPoint = null;
      options.onReset?.();
      return;
    }

    lastTapTime = now;
    lastTapPoint = point;
    if (options.onTap) {
      // Deferred so a following second tap can cancel it and resolve as a double-tap instead.
      pendingTapTimer = window.setTimeout(() => options.onTap?.(point.x, point.y), DOUBLE_TAP_MS);
    }
  };

  const endPointer = (e: PointerEvent, allowTap: boolean) => {
    const wasOnlyPointer = pointers.size === 1 && pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      lastPinchDistance = null;
      lastPinchMid = null;
    }
    if (pointers.size === 0) {
      interacting = false;
      if (allowTap && wasOnlyPointer && tapCandidate) {
        resolveTap(tapCandidate);
      }
      tapCandidate = null;
    }
  };
  element.addEventListener('pointerup', (e) => endPointer(e, true));
  element.addEventListener('pointercancel', (e) => endPointer(e, false));
  element.addEventListener('pointerleave', (e) => endPointer(e, false));

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
}
