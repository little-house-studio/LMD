import type { RenderBatch } from './rendertree';

export interface WebGLStats {
  drawCalls: number;
  triangles: number;
  vertices: number;
  fps: number;
}

export class WebGLEngine {
  private gl: WebGL2RenderingContext;
  private programs: Map<string, WebGLProgram> = new Map();
  private vertexBuffers: Map<string, WebGLBuffer> = new Map();
  private indexBuffers: Map<string, WebGLBuffer> = new Map();
  private colorBuffers: Map<string, WebGLBuffer> = new Map();
  private projectionMatrix = new Float32Array(16);
  private viewMatrix = new Float32Array(16);
  private modelMatrix = new Float32Array(16);
  private mvpMatrix = new Float32Array(16);
  private lastTime = performance.now();
  private frameCount = 0;
  private fps = 0;
  private canvasWidth = 0;
  private canvasHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL 2 is not supported');
    }
    this.gl = gl;
    this.initShaders();
    this.resize(canvas.width, canvas.height);
  }

  private initShaders(): void {
    const vertexShaderSource = `
      #version 300 es
      precision highp float;
      
      in vec4 a_position;
      in vec4 a_color;
      
      uniform mat4 u_mvp;
      
      out vec4 v_color;
      
      void main() {
        gl_Position = u_mvp * a_position;
        v_color = a_color;
      }
    `;

    const fragmentShaderSource = `
      #version 300 es
      precision highp float;
      
      in vec4 v_color;
      
      out vec4 fragColor;
      
      void main() {
        fragColor = v_color;
      }
    `;

    const program = this.createProgram(vertexShaderSource, fragmentShaderSource);
    this.programs.set('basic', program);
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
    }

    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error: ' + gl.getShaderInfoLog(shader));
    }

    return shader;
  }

  resize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.gl.viewport(0, 0, width, height);
    this.updateProjection();
  }

  private updateProjection(): void {
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    const near = 0.1;
    const far = 1000;
    const left = -width / 2;
    const right = width / 2;
    const bottom = -height / 2;
    const top = height / 2;

    this.projectionMatrix.set([
      2 / (right - left), 0, 0, 0,
      0, 2 / (top - bottom), 0, 0,
      0, 0, -2 / (far - near), 0,
      -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1,
    ]);
  }

  setView(x: number, y: number, zoom: number): void {
    this.viewMatrix.set([
      zoom, 0, 0, 0,
      0, zoom, 0, 0,
      0, 0, 1, 0,
      x, y, 0, 1,
    ]);
    this.updateMVP();
  }

  private updateMVP(): void {
    this.multiplyMatrices(this.projectionMatrix, this.viewMatrix, this.mvpMatrix);
  }

  private multiplyMatrices(a: Float32Array, b: Float32Array, result: Float32Array): void {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
    const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
    const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
    const b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];

    result[0] = a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30;
    result[1] = a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31;
    result[2] = a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32;
    result[3] = a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33;

    result[4] = a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30;
    result[5] = a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31;
    result[6] = a10 * b02 + a11 * b12 + a12 * b22 + a13 * b23;
    result[7] = a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33;

    result[8] = a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30;
    result[9] = a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31;
    result[10] = a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32;
    result[11] = a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33;

    result[12] = a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30;
    result[13] = a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31;
    result[14] = a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32;
    result[15] = a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33;
  }

  uploadBatch(batch: RenderBatch): void {
    const gl = this.gl;
    const program = this.programs.get('basic')!;

    let vertexBuffer = this.vertexBuffers.get(batch.id);
    if (!vertexBuffer) {
      vertexBuffer = gl.createBuffer()!;
      this.vertexBuffers.set(batch.id, vertexBuffer);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.vertices, gl.STATIC_DRAW);

    if (batch.indices.length > 0) {
      let indexBuffer = this.indexBuffers.get(batch.id);
      if (!indexBuffer) {
        indexBuffer = gl.createBuffer()!;
        this.indexBuffers.set(batch.id, indexBuffer);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.STATIC_DRAW);
    }

    let colorBuffer = this.colorBuffers.get(batch.id);
    if (!colorBuffer) {
      colorBuffer = gl.createBuffer()!;
      this.colorBuffers.set(batch.id, colorBuffer);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.colors, gl.STATIC_DRAW);
  }

  renderBatch(batch: RenderBatch): void {
    const gl = this.gl;
    const program = this.programs.get('basic')!;

    gl.useProgram(program);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const colorLocation = gl.getAttribLocation(program, 'a_color');
    const mvpLocation = gl.getUniformLocation(program, 'u_mvp');

    const vertexBuffer = this.vertexBuffers.get(batch.id);
    const indexBuffer = this.indexBuffers.get(batch.id);
    const colorBuffer = this.colorBuffers.get(batch.id);

    if (!vertexBuffer || !colorBuffer) return;

    gl.uniformMatrix4fv(mvpLocation, false, this.mvpMatrix);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0);

    if (batch.type === 'nodes' && indexBuffer) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.drawElements(gl.TRIANGLES, batch.indices.length, gl.UNSIGNED_INT, 0);
    } else if (batch.type === 'edges') {
      gl.drawArrays(gl.LINES, 0, batch.vertices.length / 4);
    }

    gl.disableVertexAttribArray(positionLocation);
    gl.disableVertexAttribArray(colorLocation);
  }

  clear(color: string = '#f8fafc'): void {
    const gl = this.gl;
    const rgb = this.hexToRGB(color);
    gl.clearColor(rgb.r, rgb.g, rgb.b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  private hexToRGB(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      };
    }
    return { r: 0.97, g: 0.98, b: 1 };
  }

  beginFrame(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastTime = now;
    }
  }

  endFrame(): void {
    this.gl.flush();
  }

  getStats(): WebGLStats {
    return {
      drawCalls: 0,
      triangles: 0,
      vertices: 0,
      fps: this.fps,
    };
  }

  deleteBatch(batchId: string): void {
    const gl = this.gl;
    const vertexBuffer = this.vertexBuffers.get(batchId);
    if (vertexBuffer) {
      gl.deleteBuffer(vertexBuffer);
      this.vertexBuffers.delete(batchId);
    }
    const indexBuffer = this.indexBuffers.get(batchId);
    if (indexBuffer) {
      gl.deleteBuffer(indexBuffer);
      this.indexBuffers.delete(batchId);
    }
    const colorBuffer = this.colorBuffers.get(batchId);
    if (colorBuffer) {
      gl.deleteBuffer(colorBuffer);
      this.colorBuffers.delete(batchId);
    }
  }

  destroy(): void {
    const gl = this.gl;
    this.programs.forEach(program => gl.deleteProgram(program));
    this.vertexBuffers.forEach(buffer => gl.deleteBuffer(buffer));
    this.indexBuffers.forEach(buffer => gl.deleteBuffer(buffer));
    this.colorBuffers.forEach(buffer => gl.deleteBuffer(buffer));
    this.programs.clear();
    this.vertexBuffers.clear();
    this.indexBuffers.clear();
    this.colorBuffers.clear();
  }
}