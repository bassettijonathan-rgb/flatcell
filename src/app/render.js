// Draws the lattice: a background texture (site types plus an optional
// metabolite heatmap) and particles as instanced discs. WebGPU first, then
// WebGL2, then plain canvas 2D as a last resort.

const MAX_SPECIES = 64;
const TRAIL_SLOT = 63;

// Lattice -> clip-space transform that fits the view box into the canvas.
export function fitView(cw, ch, box) {
  const [x0, y0, x1, y1] = box;
  const pps = Math.min(cw / (x1 - x0), ch / (y1 - y0));
  const ox = (cw - pps * (x1 - x0)) / 2 - pps * x0;
  const oy = (ch - pps * (y1 - y0)) / 2 - pps * y0;
  return {
    pps, ox, oy,
    scale: [(2 * pps) / cw, (-2 * pps) / ch],
    offset: [(2 * ox) / cw - 1, 1 - (2 * oy) / ch],
    toLattice: (px, py) => [(px - ox) / pps, (py - oy) / pps],
  };
}

// Pack trail points as extra instances after the particles.
function withTrail(parts, n, trail) {
  if (!trail || trail.length < 4) return { data: parts, n };
  const k = trail.length / 2;
  const out = new Float32Array((n + k) * 4);
  out.set(parts.subarray(0, n * 4));
  for (let j = 0; j < k; j++) {
    const o = (n + j) * 4;
    out[o] = trail[2 * j];
    out[o + 1] = trail[2 * j + 1];
    out[o + 2] = TRAIL_SLOT;
    out[o + 3] = -(0.15 + 0.85 * (j / k)); // negative = trail point with alpha
  }
  return { data: out, n: n + k };
}

function speciesTable(species, trailColor) {
  const t = new Float32Array(MAX_SPECIES * 4);
  species.forEach((sp, i) => {
    if (i >= MAX_SPECIES - 1) return;
    t.set([sp.color[0], sp.color[1], sp.color[2], sp.radius], i * 4);
  });
  t.set([trailColor[0], trailColor[1], trailColor[2], 0.16], TRAIL_SLOT * 4);
  return t;
}

// ---------------------------------------------------------------- WebGPU
const WGSL = /* wgsl */ `
struct U {
  scale: vec2f, offset: vec2f,
  pps: f32, latW: f32, latH: f32, pad: f32,
  ring: vec4f,
  colors: array<vec4f, ${MAX_SPECIES}>,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var bgTex: texture_2d<f32>;

struct BOut { @builtin(position) pos: vec4f, @location(0) lat: vec2f };
@vertex fn bgVs(@builtin(vertex_index) vi: u32) -> BOut {
  var c = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: BOut;
  o.pos = vec4f(c[vi], 0.0, 1.0);
  o.lat = (c[vi] - u.offset) / u.scale;
  return o;
}
@fragment fn bgFs(i: BOut) -> @location(0) vec4f {
  if (i.lat.x < 0.0 || i.lat.y < 0.0 || i.lat.x >= u.latW || i.lat.y >= u.latH) { discard; }
  let t = textureLoad(bgTex, vec2i(i.lat), 0);
  return vec4f(t.rgb * t.a, t.a);
}

struct POut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) flags: f32,
  @location(3) rpx: f32,
};
@vertex fn pVs(@builtin(vertex_index) vi: u32, @location(0) inst: vec4f) -> POut {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                          vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let col = u.colors[u32(inst.z)];
  var r = col.w;
  let fl = inst.w;
  if (fl >= 0.0 && (u32(fl) & 2u) != 0u) { r = r * 1.5 + 0.35; }
  let pad = 1.0 + 1.5 / max(r * u.pps, 1.0);
  let p = inst.xy + c[vi] * r * pad;
  var o: POut;
  o.pos = vec4f(p * u.scale + u.offset, 0.0, 1.0);
  o.local = c[vi] * pad;
  o.color = vec4f(col.rgb, 1.0);
  o.flags = fl;
  o.rpx = r * u.pps;
  return o;
}
@fragment fn pFs(i: POut) -> @location(0) vec4f {
  let d = length(i.local);
  let aa = 1.0 / max(i.rpx, 0.5);
  var a = clamp((1.0 - d) / aa + 0.5, 0.0, 1.0);
  var col = i.color.rgb;
  if (i.flags < 0.0) {
    a = a * -i.flags * 0.8;
  } else {
    let f = u32(i.flags);
    if ((f & 1u) != 0u) {
      // busy: bright core
      let core = clamp((0.45 - d) / aa + 0.5, 0.0, 1.0);
      col = mix(col * 0.75, vec3f(1.0, 1.0, 0.92), core);
    } else {
      col = col * (0.82 + 0.18 * (1.0 - d));
    }
    if ((f & 2u) != 0u) {
      let ring = clamp((1.0 - d) / aa + 0.5, 0.0, 1.0) * clamp((d - 0.72) / aa + 0.5, 0.0, 1.0);
      col = mix(col, u.ring.rgb, ring);
    }
  }
  return vec4f(col * a, a);
}
`;

class GPURenderer {
  static async create(canvas) {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    if (!ctx) return null;
    canvas.dataset.gpu = '1';
    const r = new GPURenderer();
    r.errors = [];
    device.addEventListener('uncapturederror', (e) => { r.errors.push(e.error.message); console.error('WebGPU:', e.error.message); });
    device.pushErrorScope('validation');
    r.kind = 'WebGPU';
    r.canvas = canvas;
    r.device = device;
    r.ctx = ctx;
    r.format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format: r.format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const module = device.createShaderModule({ code: WGSL });
    const blend = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    r.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    const pl = device.createPipelineLayout({ bindGroupLayouts: [r.layout] });
    r.bgPipe = device.createRenderPipeline({
      layout: pl,
      vertex: { module, entryPoint: 'bgVs' },
      fragment: { module, entryPoint: 'bgFs', targets: [{ format: r.format, blend }] },
      primitive: { topology: 'triangle-list' },
    });
    r.pPipe = device.createRenderPipeline({
      layout: pl,
      vertex: {
        module, entryPoint: 'pVs',
        buffers: [{ arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] }],
      },
      fragment: { module, entryPoint: 'pFs', targets: [{ format: r.format, blend }] },
      primitive: { topology: 'triangle-list' },
    });
    r.ubuf = device.createBuffer({ size: 48 + MAX_SPECIES * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    r.inst = null;
    r.instCap = 0;
    r.tex = null;
    r.species = new Float32Array(MAX_SPECIES * 4);
    r.ring = [1, 1, 1, 1];
    const err = await device.popErrorScope();
    if (err) { console.warn('WebGPU pipeline error, falling back:', err.message); device.destroy(); return 'replace'; }
    return r;
  }

  setSpecies(species, trailColor, ringColor) {
    this.species = speciesTable(species, trailColor);
    this.ring = [...ringColor, 1];
  }

  setBackground(rgba, W, H) {
    if (!this.tex || this.texW !== W || this.texH !== H) {
      this.tex?.destroy();
      this.tex = this.device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      this.texW = W;
      this.texH = H;
      this.bind = this.device.createBindGroup({
        layout: this.layout,
        entries: [{ binding: 0, resource: { buffer: this.ubuf } }, { binding: 1, resource: this.tex.createView() }],
      });
    }
    this.device.queue.writeTexture({ texture: this.tex }, rgba, { bytesPerRow: W * 4 }, [W, H]);
  }

  draw({ view, parts, nParts, trail, clear }) {
    if (!this.tex) return;
    const { device } = this;
    const { data, n } = withTrail(parts, nParts, trail);
    if (n > this.instCap) {
      this.inst?.destroy();
      this.instCap = Math.max(1024, n * 2);
      this.inst = device.createBuffer({ size: this.instCap * 16, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (n > 0) device.queue.writeBuffer(this.inst, 0, data, 0, n * 4);
    const u = new Float32Array(12 + MAX_SPECIES * 4);
    u.set([view.scale[0], view.scale[1], view.offset[0], view.offset[1], view.pps * (window.devicePixelRatio || 1), this.texW, this.texH, 0]);
    u.set(this.ring, 8);
    u.set(this.species, 12);
    device.queue.writeBuffer(this.ubuf, 0, u);
    const enc = device.createCommandEncoder();
    const target = this.ctx.getCurrentTexture();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: clear[0], g: clear[1], b: clear[2], a: 1 } }],
    });
    pass.setBindGroup(0, this.bind);
    pass.setPipeline(this.bgPipe);
    pass.draw(3);
    if (n > 0) {
      pass.setPipeline(this.pPipe);
      pass.setVertexBuffer(0, this.inst);
      pass.draw(6, n);
    }
    pass.end();
    let readback = null;
    if (this.capture) {
      // Test hook: copy the frame out so headless checks can read pixels.
      const bpr = Math.ceil((target.width * 4) / 256) * 256;
      readback = device.createBuffer({ size: bpr * target.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: bpr }, [target.width, target.height]);
      const cap = this.capture;
      this.capture = null;
      const bgra = this.format === 'bgra8unorm';
      device.queue.submit([enc.finish()]);
      readback.mapAsync(GPUMapMode.READ).then(() => {
        const bytes = new Uint8Array(readback.getMappedRange());
        cap((x, y) => {
          const o = y * bpr + x * 4;
          const p = [bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]];
          return bgra ? [p[2], p[1], p[0], p[3]] : p;
        });
      });
      return;
    }
    device.queue.submit([enc.finish()]);
  }
}

// ---------------------------------------------------------------- WebGL2
const GL_BG_VS = `#version 300 es
precision highp float;
uniform vec2 uScale, uOffset;
out vec2 vLat;
void main() {
  vec2 c = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(c, 0.0, 1.0);
  vLat = (c - uOffset) / uScale;
}`;
const GL_BG_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uLat;
in vec2 vLat;
out vec4 o;
void main() {
  if (vLat.x < 0.0 || vLat.y < 0.0 || vLat.x >= uLat.x || vLat.y >= uLat.y) discard;
  vec4 t = texelFetch(uTex, ivec2(vLat), 0);
  o = vec4(t.rgb * t.a, t.a);
}`;
const GL_P_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 inst;
uniform vec2 uScale, uOffset;
uniform float uPps;
uniform vec4 uColors[${MAX_SPECIES}];
out vec2 vLocal;
out vec3 vColor;
out float vFlags, vRpx;
void main() {
  int v = gl_VertexID % 6;
  vec2 c = vec2((v == 1 || v == 4 || v == 5) ? 1.0 : -1.0, (v == 2 || v == 3 || v == 5) ? 1.0 : -1.0);
  vec4 col = uColors[int(inst.z)];
  float r = col.w;
  if (inst.w >= 0.0 && (int(inst.w) & 2) != 0) r = r * 1.5 + 0.35;
  float pad = 1.0 + 1.5 / max(r * uPps, 1.0);
  vec2 p = inst.xy + c * r * pad;
  gl_Position = vec4(p * uScale + uOffset, 0.0, 1.0);
  vLocal = c * pad;
  vColor = col.rgb;
  vFlags = inst.w;
  vRpx = r * uPps;
}`;
const GL_P_FS = `#version 300 es
precision highp float;
uniform vec3 uRing;
in vec2 vLocal;
in vec3 vColor;
in float vFlags, vRpx;
out vec4 o;
void main() {
  float d = length(vLocal);
  float aa = 1.0 / max(vRpx, 0.5);
  float a = clamp((1.0 - d) / aa + 0.5, 0.0, 1.0);
  vec3 col = vColor;
  if (vFlags < 0.0) {
    a *= -vFlags * 0.8;
  } else {
    int f = int(vFlags);
    if ((f & 1) != 0) {
      float core = clamp((0.45 - d) / aa + 0.5, 0.0, 1.0);
      col = mix(col * 0.75, vec3(1.0, 1.0, 0.92), core);
    } else {
      col = col * (0.82 + 0.18 * (1.0 - d));
    }
    if ((f & 2) != 0) {
      float ring = clamp((1.0 - d) / aa + 0.5, 0.0, 1.0) * clamp((d - 0.72) / aa + 0.5, 0.0, 1.0);
      col = mix(col, uRing, ring);
    }
  }
  o = vec4(col * a, a);
}`;

class GLRenderer {
  static create(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: false });
    if (!gl) return null;
    const r = new GLRenderer();
    r.kind = 'WebGL2';
    r.gl = gl;
    const prog = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    };
    r.bg = prog(GL_BG_VS, GL_BG_FS);
    r.pp = prog(GL_P_VS, GL_P_FS);
    r.vao = gl.createVertexArray();
    r.buf = gl.createBuffer();
    gl.bindVertexArray(r.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
    r.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, r.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    r.species = new Float32Array(MAX_SPECIES * 4);
    r.ring = [1, 1, 1];
    r.loc = (p, n) => gl.getUniformLocation(p, n);
    return r;
  }

  setSpecies(species, trailColor, ringColor) {
    this.species = speciesTable(species, trailColor);
    this.ring = ringColor;
  }

  setBackground(rgba, W, H) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    this.texW = W;
    this.texH = H;
  }

  draw({ view, parts, nParts, trail, clear }) {
    const gl = this.gl;
    const { data, n } = withTrail(parts, nParts, trail);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.texW) {
      gl.useProgram(this.bg);
      gl.uniform2f(this.loc(this.bg, 'uScale'), view.scale[0], view.scale[1]);
      gl.uniform2f(this.loc(this.bg, 'uOffset'), view.offset[0], view.offset[1]);
      gl.uniform2f(this.loc(this.bg, 'uLat'), this.texW, this.texH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(this.loc(this.bg, 'uTex'), 0);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (n > 0) {
      gl.useProgram(this.pp);
      gl.uniform2f(this.loc(this.pp, 'uScale'), view.scale[0], view.scale[1]);
      gl.uniform2f(this.loc(this.pp, 'uOffset'), view.offset[0], view.offset[1]);
      gl.uniform1f(this.loc(this.pp, 'uPps'), view.pps * (window.devicePixelRatio || 1));
      gl.uniform4fv(this.loc(this.pp, 'uColors'), this.species);
      gl.uniform3f(this.loc(this.pp, 'uRing'), this.ring[0], this.ring[1], this.ring[2]);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 4), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.bindVertexArray(null);
    }
  }
}

// ---------------------------------------------------------------- Canvas 2D
class CanvasRenderer {
  static create(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const r = new CanvasRenderer();
    r.kind = 'Canvas 2D';
    r.ctx = ctx;
    r.canvas = canvas;
    r.off = document.createElement('canvas');
    r.species = [];
    return r;
  }

  setSpecies(species, trailColor, ringColor) {
    const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
    this.species = species.map((sp) => ({ fill: css(sp.color), r: sp.radius }));
    this.trail = css(trailColor);
    this.ring = css(ringColor);
  }

  setBackground(rgba, W, H) {
    this.off.width = W;
    this.off.height = H;
    this.off.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, W * H * 4), W, H), 0, 0);
  }

  draw({ view, parts, nParts, trail, clear }) {
    const { ctx, canvas } = this;
    const dpr = canvas.width / canvas.clientWidth || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgb(${clear.map((c) => Math.round(c * 255)).join(',')})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.pps * dpr, 0, 0, view.pps * dpr, view.ox * dpr, view.oy * dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0);
    if (trail && trail.length >= 4) {
      ctx.strokeStyle = this.trail;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(trail[0], trail[1]);
      for (let j = 2; j < trail.length; j += 2) ctx.lineTo(trail[j], trail[j + 1]);
      ctx.stroke();
    }
    for (let k = 0; k < nParts; k++) {
      const sp = this.species[parts[k * 4 + 2]];
      if (!sp) continue;
      const fl = parts[k * 4 + 3];
      ctx.fillStyle = sp.fill;
      ctx.beginPath();
      ctx.arc(parts[k * 4], parts[k * 4 + 1], sp.r, 0, 6.2832);
      ctx.fill();
      if (fl & 1) {
        // busy: bright core, as in the GPU renderers
        ctx.fillStyle = '#fffbe8';
        ctx.beginPath();
        ctx.arc(parts[k * 4], parts[k * 4 + 1], sp.r * 0.45, 0, 6.2832);
        ctx.fill();
      }
      if (fl & 2) {
        ctx.strokeStyle = this.ring;
        ctx.lineWidth = 0.15;
        ctx.stroke();
      }
    }
  }
}

// Returns { renderer, canvas }: a canvas that already has a WebGPU context
// cannot fall back to WebGL, so it is swapped for a fresh one.
export async function createRenderer(canvas, prefer = 'auto') {
  if (prefer === 'auto' || prefer === 'webgpu') {
    try {
      const r = await GPURenderer.create(canvas);
      if (r && r !== 'replace') return { renderer: r, canvas };
      if (r === 'replace') canvas = replaceCanvas(canvas);
    } catch (e) {
      console.warn('WebGPU unavailable', e);
      if (canvas.dataset.gpu) canvas = replaceCanvas(canvas);
    }
  }
  if (prefer !== 'canvas') {
    try {
      const r = GLRenderer.create(canvas);
      if (r) return { renderer: r, canvas };
    } catch (e) {
      console.warn('WebGL2 unavailable', e);
      canvas = replaceCanvas(canvas);
    }
  }
  return { renderer: CanvasRenderer.create(canvas), canvas };
}

function replaceCanvas(old) {
  const c = old.cloneNode(false);
  old.replaceWith(c);
  return c;
}
