/**
 * Caches each canvas's CSS box size via ResizeObserver instead of reading
 * `clientWidth`/`clientHeight` on every draw call. During animation, canvas
 * draws are interleaved with other DOM writes (slider values, labels); if
 * every frame also reads layout-dependent properties, the browser is forced
 * into a synchronous reflow each frame ("layout thrashing"), which is the
 * main source of animation stutter — especially visible in the tightly
 * zoomed eclipse close-up. The size only actually changes on window
 * resize/layout shifts, so observing it is far cheaper than measuring it
 * every frame.
 */

const sizeCache = new WeakMap<HTMLCanvasElement, { width: number; height: number }>();
const observedCanvases = new WeakSet<HTMLCanvasElement>();

function measure(canvas: HTMLCanvasElement): { width: number; height: number } {
  return { width: Math.max(canvas.clientWidth, 1), height: Math.max(canvas.clientHeight, 1) };
}

export function getCanvasCssSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  if (!observedCanvases.has(canvas)) {
    observedCanvases.add(canvas);
    sizeCache.set(canvas, measure(canvas));
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.contentBoxSize?.[0];
        const width = box ? box.inlineSize : entry.contentRect.width;
        const height = box ? box.blockSize : entry.contentRect.height;
        // Ignore collapses to ~0 (e.g. an ancestor toggling `display: none`): keep the last
        // known real size so a canvas that's briefly hidden doesn't draw at a degenerate 1x1
        // the instant it becomes visible again, before this observer gets to re-fire.
        if (width < 2 || height < 2) continue;
        sizeCache.set(canvas, { width, height });
      }
    });
    observer.observe(canvas);
  }
  return sizeCache.get(canvas) ?? measure(canvas);
}
