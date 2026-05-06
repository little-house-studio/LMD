export interface PickResult {
  id: string;
  type: 'node' | 'edge' | 'subgraph';
  x: number;
  y: number;
}

export class PickBuffer {
  private gl: WebGL2RenderingContext;
  private framebuffer: WebGLFramebuffer | null = null;
  private texture: WebGLTexture | null = null;
  private width = 0;
  private height = 0;
  private idColorMap = new Map<number, PickResult>();
  private nextId = 1;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.initShaders();
  }

  private initShaders(): void {
    const vertexShaderSource = `
      #version 300 es
      precision highp float;
      
      in vec4 a_position;
      
      uniform mat4 u_mvp;
      
      void main() {
        gl_Position = u_mvp * a_position;
      }
    `;

    const fragmentShaderSource = `
      #version 300 es
      precision highp float;
      
      uniform vec3 u_idColor;
      
      out vec4 fragColor;
      
      void main() {
        fragColor = vec4(u_idColor, 1.0);
      }
    `;

    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

    const program = this.gl.createProgram()!;
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error('Pick buffer program link error: ' + this.gl.getProgramInfoLog(program));
    }

    this.program = program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error: ' + this.gl.getShaderInfoLog(shader));
    }

    return shader;
  }

  resize(width: number, height: number): void {
    const gl = this.gl;

    if (this.width === width && this.height === height) {
      return;
    }

    this.width = width;
    this.height = height;

    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
    }
    if (this.texture) {
      gl.deleteTexture(this.texture);
    }

    this.framebuffer = gl.createFramebuffer()!;
    this.texture = gl.createTexture()!;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Framebuffer is not complete');
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private idToColor(id: number): [number, number, number] {
    return [
      ((id >> 16) & 0xff) / 255,
      ((id >> 8) & 0xff) / 255,
      (id & 0xff) / 255,
    ];
  }

  private colorToId(r: number, g: number, b: number): number {
    return (r << 16) | (g << 8) | b;
  }

  registerObject(id: string, type: 'node' | 'edge' | 'subgraph'): number {
    const colorId = this.nextId++;
    this.idColorMap.set(colorId, { id, type, x: 0, y: 0 });
    return colorId;
  }

  unregisterObject(colorId: number): void {
    this.idColorMap.delete(colorId);
  }

  clearRegistry(): void {
    this.idColorMap.clear();
    this.nextId = 1;
  }

  beginPicking(mvpMatrix: Float32Array): void {
    const gl = this.gl;
    const program = this.program!;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    const mvpLocation = gl.getUniformLocation(program, 'u_mvp');
    gl.uniformMatrix4fv(mvpLocation, false, mvpMatrix);

    if (!this.vertexBuffer) {
      this.vertexBuffer = gl.createBuffer()!;
    }
    if (!this.indexBuffer) {
      this.indexBuffer = gl.createBuffer()!;
    }
  }

  drawRect(x: number, y: number, width: number, height: number, colorId: number): void {
    const gl = this.gl;
    const program = this.program!;

    const hw = width / 2;
    const hh = height / 2;

    const vertices = new Float32Array([
      x - hw, y - hh, 0, 1,
      x + hw, y - hh, 0, 1,
      x + hw, y + hh, 0, 1,
      x - hw, y + hh, 0, 1,
    ]);

    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer!);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer!);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STREAM_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 4, gl.FLOAT, false, 0, 0);

    const color = this.idToColor(colorId);
    const colorLocation = gl.getUniformLocation(program, 'u_idColor');
    gl.uniform3fv(colorLocation, color);

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);

    gl.disableVertexAttribArray(positionLocation);
  }

  endPicking(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(null);
  }

  pick(x: number, y: number): PickResult | null {
    const gl = this.gl;

    if (!this.framebuffer) {
      return null;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

    const pixel = new Uint8Array(4);
    gl.readPixels(x, this.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];

    if (r === 0 && g === 0 && b === 0) {
      return null;
    }

    const colorId = this.colorToId(r, g, b);
    const result = this.idColorMap.get(colorId);

    if (result) {
      return { ...result, x, y };
    }

    return null;
  }

  destroy(): void {
    const gl = this.gl;

    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
      this.framebuffer = null;
    }
    if (this.texture) {
      gl.deleteTexture(this.texture);
      this.texture = null;
    }
    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
    if (this.vertexBuffer) {
      gl.deleteBuffer(this.vertexBuffer);
      this.vertexBuffer = null;
    }
    if (this.indexBuffer) {
      gl.deleteBuffer(this.indexBuffer);
      this.indexBuffer = null;
    }

    this.idColorMap.clear();
  }
}