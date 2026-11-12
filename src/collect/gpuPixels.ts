// The GPU image: a fixed 160x160 WebGL scene whose exact pixels depend on the
// GPU and its driver, not on the browser. Canvas size, context attributes,
// clear colour, shader text and vertex data are all part of recipe 1.

const SIZE = 160;
const BUDGET_MS = 1500;
const KNOWN_COLOUR = [17, 83, 149, 255] as const;

const VERTEX_SHADER =
  'attribute vec2 p; varying vec2 v; void main(){ v=p; gl_Position=vec4(p,0.0,1.0); }';
const FRAGMENT_SHADER =
  'precision highp float; varying vec2 v; void main(){ float a=sin(v.x*37.0)*cos(v.y*29.0); float b=fract(sin(dot(v,vec2(12.9898,78.233)))*43758.5453); gl_FragColor=vec4(0.5+0.5*a, b, 0.5+0.5*sin(a*b*91.0), 1.0); }';

// One context, reused across reads (see gl.ts for why).
let shared: WebGLRenderingContext | null = null;

function sceneContext(): WebGLRenderingContext | null {
  if (shared === null || shared.isContextLost()) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    shared = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  }
  return shared;
}

/**
 * Draws the scene and returns the raw RGBA bytes, or `undefined` when the
 * result cannot be trusted:
 *
 * - a solid colour does not read back exactly (the browser adds noise to reads),
 * - two draws of the same scene differ,
 * - the work takes longer than 1500 ms, or
 * - the context is unavailable, lost or reports an error.
 *
 * An untrusted result is "no information", never "a different device".
 */
export function drawGpuPixels(): Uint8Array<ArrayBuffer> | undefined {
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  const shaders: WebGLShader[] = [];
  try {
    const started = performance.now();
    const overBudget = () => performance.now() - started > BUDGET_MS;
    const context = sceneContext();
    if (!context || context.isContextLost()) return undefined;
    gl = context;
    // An error left over from an earlier read must not fail this one.
    for (let cleared = 0; cleared < 8 && context.getError() !== context.NO_ERROR; cleared++);

    context.clearColor(17 / 255, 83 / 255, 149 / 255, 1);
    context.clear(context.COLOR_BUFFER_BIT);
    const known = new Uint8Array(4 * 4 * 4);
    context.readPixels(0, 0, 4, 4, context.RGBA, context.UNSIGNED_BYTE, known);
    if (known.some((byte, index) => byte !== KNOWN_COLOUR[index % 4])) return undefined;
    if (overBudget()) return undefined;

    const compile = (type: number, source: string) => {
      const shader = context.createShader(type);
      if (!shader) throw new Error('shader');
      shaders.push(shader);
      context.shaderSource(shader, source);
      context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error('compile');
      return shader;
    };
    program = context.createProgram();
    if (!program) return undefined;
    context.attachShader(program, compile(context.VERTEX_SHADER, VERTEX_SHADER));
    context.attachShader(program, compile(context.FRAGMENT_SHADER, FRAGMENT_SHADER));
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) return undefined;
    context.useProgram(program);

    buffer = context.createBuffer();
    if (!buffer) return undefined;
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      context.STATIC_DRAW,
    );
    const location = context.getAttribLocation(program, 'p');
    if (location < 0) return undefined;
    context.enableVertexAttribArray(location);
    context.vertexAttribPointer(location, 2, context.FLOAT, false, 0, 0);
    context.viewport(0, 0, SIZE, SIZE);

    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    context.readPixels(0, 0, SIZE, SIZE, context.RGBA, context.UNSIGNED_BYTE, pixels);
    if (overBudget()) return undefined;

    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
    const repeated = new Uint8Array(pixels.length);
    context.readPixels(0, 0, SIZE, SIZE, context.RGBA, context.UNSIGNED_BYTE, repeated);
    if (pixels.some((byte, index) => byte !== repeated[index])) return undefined;

    if (overBudget() || context.isContextLost() || context.getError() !== context.NO_ERROR) {
      return undefined;
    }
    return pixels;
  } catch {
    return undefined;
  } finally {
    // The context stays for the next read; what this read created is freed.
    // The context is never forced into loss: some browsers print a console
    // warning for that.
    try {
      if (gl) {
        if (program) gl.deleteProgram(program);
        for (const shader of shaders) gl.deleteShader(shader);
        if (buffer) gl.deleteBuffer(buffer);
      }
    } catch {
      // Nothing to free on a lost context.
    }
  }
}
