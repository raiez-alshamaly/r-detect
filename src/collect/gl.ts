// WebGL reads that do not draw: the renderer string and the hardware limits.

const PARAMETERS = [
  'MAX_RENDERBUFFER_SIZE',
  'MAX_VIEWPORT_DIMS',
  'ALIASED_LINE_WIDTH_RANGE',
  'ALIASED_POINT_SIZE_RANGE',
  'MAX_VARYING_VECTORS',
  'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
  'RED_BITS',
  'GREEN_BITS',
  'BLUE_BITS',
  'ALPHA_BITS',
  'DEPTH_BITS',
  'STENCIL_BITS',
] as const;

const SHADER_TYPES = ['VERTEX_SHADER', 'FRAGMENT_SHADER'] as const;

const PRECISION_TYPES = [
  'LOW_FLOAT',
  'MEDIUM_FLOAT',
  'HIGH_FLOAT',
  'LOW_INT',
  'MEDIUM_INT',
  'HIGH_INT',
] as const;

// Browsers allow a page only a few live WebGL contexts and drop the oldest
// when the limit is passed. One context is kept and reused, so repeated reads
// never push the embedding page's own canvases out.
let shared: WebGLRenderingContext | null = null;

/**
 * A context with default attributes. Several of the limits below depend on the
 * attributes, so this must stay a plain `getContext('webgl')`; the GPU image
 * uses its own canvas.
 */
export function readContext(): WebGLRenderingContext | null {
  if (shared === null || shared.isContextLost()) {
    shared = document.createElement('canvas').getContext('webgl');
  }
  return shared;
}

/** The unmasked renderer string, or the masked one when the extension is unavailable. */
export function rendererString(gl: WebGLRenderingContext): string | undefined {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const value: unknown = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Thirteen implementation limits followed by one array of twelve shader
 * precision formats. These follow the GPU and driver; most do not change
 * between browsers on the same device.
 */
export function glHardware(gl: WebGLRenderingContext): unknown[] {
  const read = (name: number): unknown => {
    const value: unknown = gl.getParameter(name);
    return value instanceof Int32Array || value instanceof Float32Array
      ? Array.from(value)
      : value;
  };
  const precision = SHADER_TYPES.flatMap((shader) =>
    PRECISION_TYPES.map((kind) => {
      const format = gl.getShaderPrecisionFormat(gl[shader], gl[kind]);
      return format ? `${format.rangeMin}/${format.rangeMax}/${format.precision}` : null;
    }),
  );
  return [...PARAMETERS.map((name) => read(gl[name])), precision];
}
