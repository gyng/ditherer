import { describe, expect, it, vi } from "vitest";

import {
  createQuadVAO,
  ensureFloatTexture,
  ensureTexture,
  getTexPoolKeys,
  linkProgram,
  type Program,
} from "gl/index";
import { createFFTProgramCache, ensureFloatTex, getFloatPoolKeys } from "gl/fft2d";

const makeTextureGl = () => {
  let serial = 0;
  return {
    TEXTURE_2D: 0x0de1,
    RGBA8: 0x8058,
    RGBA16F: 0x881a,
    RGBA32F: 0x8814,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    HALF_FLOAT: 0x140b,
    FLOAT: 0x1406,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    createTexture: vi.fn(() => ({ id: `texture-${serial++}` }) as unknown as WebGLTexture),
    createFramebuffer: vi.fn(
      () => ({ id: `framebuffer-${serial++}` }) as unknown as WebGLFramebuffer,
    ),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5),
    getExtension: vi.fn(() => ({})),
  } as unknown as WebGL2RenderingContext;
};

type TextureAllocator = {
  label: string;
  allocate: (gl: WebGL2RenderingContext, name: string, width: number, height: number) => unknown;
  keys: () => string[];
  throwsOnMissingPair: boolean;
  hasCompletenessCheck: boolean;
};

const textureAllocators: TextureAllocator[] = [
  {
    label: "shared RGBA8",
    allocate: ensureTexture,
    keys: getTexPoolKeys,
    throwsOnMissingPair: true,
    hasCompletenessCheck: false,
  },
  {
    label: "shared RGBA16F",
    allocate: ensureFloatTexture,
    keys: getTexPoolKeys,
    throwsOnMissingPair: false,
    hasCompletenessCheck: true,
  },
  {
    label: "FFT RGBA32F",
    allocate: ensureFloatTex,
    keys: getFloatPoolKeys,
    throwsOnMissingPair: false,
    hasCompletenessCheck: true,
  },
];

describe.each(textureAllocators)(
  "$label texture ownership",
  ({ allocate, keys, throwsOnMissingPair, hasCompletenessCheck }) => {
    it("does not publish or clean handles when texture creation itself throws", () => {
      const gl = makeTextureGl();
      vi.mocked(gl.createTexture).mockImplementationOnce(() => {
        throw new Error("injected texture allocation failure");
      });
      const name = `${crypto.randomUUID()}:texture-throw`;

      expect(() => allocate(gl, name, 8, 8)).toThrow("injected texture allocation failure");
      expect(gl.createFramebuffer).not.toHaveBeenCalled();
      expect(gl.deleteTexture).not.toHaveBeenCalled();
      expect(gl.deleteFramebuffer).not.toHaveBeenCalled();
      expect(keys()).not.toContain(name);
    });

    it.each([
      { missing: "texture", texture: null, framebuffer: { id: "framebuffer" } },
      { missing: "framebuffer", texture: { id: "texture" }, framebuffer: null },
    ])(
      "cleans the surviving handle when $missing allocation fails",
      ({ missing, texture, framebuffer }) => {
        const gl = makeTextureGl();
        vi.mocked(gl.createTexture).mockReturnValueOnce(texture as unknown as WebGLTexture | null);
        vi.mocked(gl.createFramebuffer).mockReturnValueOnce(
          framebuffer as unknown as WebGLFramebuffer | null,
        );
        const name = `${crypto.randomUUID()}:partial:${missing}`;

        if (throwsOnMissingPair) {
          expect(() => allocate(gl, name, 8, 8)).toThrow("createTexture/Framebuffer failed");
        } else {
          expect(allocate(gl, name, 8, 8)).toBeNull();
        }
        if (texture) expect(gl.deleteTexture).toHaveBeenCalledWith(texture);
        if (framebuffer) expect(gl.deleteFramebuffer).toHaveBeenCalledWith(framebuffer);
        expect(keys()).not.toContain(name);
      },
    );

    it("cleans both staged handles when texture setup throws", () => {
      const gl = makeTextureGl();
      const texture = gl.createTexture()!;
      const framebuffer = gl.createFramebuffer()!;
      vi.mocked(gl.createTexture).mockReturnValueOnce(texture);
      vi.mocked(gl.createFramebuffer).mockReturnValueOnce(framebuffer);
      vi.mocked(gl.texImage2D).mockImplementationOnce(() => {
        throw new Error("injected texture setup failure");
      });
      const name = `${crypto.randomUUID()}:setup`;

      expect(() => allocate(gl, name, 8, 8)).toThrow("injected texture setup failure");
      expect(gl.deleteTexture).toHaveBeenCalledWith(texture);
      expect(gl.deleteFramebuffer).toHaveBeenCalledWith(framebuffer);
      expect(keys()).not.toContain(name);
    });

    it("cleans the texture when framebuffer creation throws", () => {
      const gl = makeTextureGl();
      const texture = gl.createTexture()!;
      vi.mocked(gl.createTexture).mockReturnValueOnce(texture);
      vi.mocked(gl.createFramebuffer).mockImplementationOnce(() => {
        throw new Error("injected framebuffer allocation failure");
      });
      const name = `${crypto.randomUUID()}:framebuffer-throw`;

      expect(() => allocate(gl, name, 8, 8)).toThrow("injected framebuffer allocation failure");
      expect(gl.deleteTexture).toHaveBeenCalledWith(texture);
      expect(keys()).not.toContain(name);
    });

    if (hasCompletenessCheck) {
      it("cleans both staged handles when framebuffer completeness fails", () => {
        const gl = makeTextureGl();
        const texture = gl.createTexture()!;
        const framebuffer = gl.createFramebuffer()!;
        vi.mocked(gl.createTexture).mockReturnValueOnce(texture);
        vi.mocked(gl.createFramebuffer).mockReturnValueOnce(framebuffer);
        vi.mocked(gl.checkFramebufferStatus).mockReturnValueOnce(0);
        const name = `${crypto.randomUUID()}:incomplete`;

        expect(allocate(gl, name, 8, 8)).toBeNull();
        expect(gl.deleteTexture).toHaveBeenCalledWith(texture);
        expect(gl.deleteFramebuffer).toHaveBeenCalledWith(framebuffer);
        expect(keys()).not.toContain(name);
      });
    }

    it("invalidates a resized entry before replacement failure and retries instead of returning deleted handles", () => {
      const gl = makeTextureGl();
      const oldTexture = { id: "old-texture" } as unknown as WebGLTexture;
      const oldFramebuffer = { id: "old-framebuffer" } as unknown as WebGLFramebuffer;
      const failedFramebuffer = { id: "failed-framebuffer" } as unknown as WebGLFramebuffer;
      const retryTexture = { id: "retry-texture" } as unknown as WebGLTexture;
      const retryFramebuffer = { id: "retry-framebuffer" } as unknown as WebGLFramebuffer;
      vi.mocked(gl.createTexture)
        .mockReturnValueOnce(oldTexture)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(retryTexture);
      vi.mocked(gl.createFramebuffer)
        .mockReturnValueOnce(oldFramebuffer)
        .mockReturnValueOnce(failedFramebuffer)
        .mockReturnValueOnce(retryFramebuffer);
      const name = `${crypto.randomUUID()}:resize`;

      const original = allocate(gl, name, 8, 8);
      if (throwsOnMissingPair) {
        expect(() => allocate(gl, name, 16, 16)).toThrow("createTexture/Framebuffer failed");
      } else {
        expect(allocate(gl, name, 16, 16)).toBeNull();
      }
      expect(gl.deleteTexture).toHaveBeenCalledWith(oldTexture);
      expect(gl.deleteFramebuffer).toHaveBeenCalledWith(oldFramebuffer);
      expect(gl.deleteFramebuffer).toHaveBeenCalledWith(failedFramebuffer);
      expect(keys()).not.toContain(name);

      const retry = allocate(gl, name, 8, 8);
      expect(retry).not.toBe(original);
      expect(retry).toMatchObject({ tex: retryTexture, fbo: retryFramebuffer });
      expect(gl.createTexture).toHaveBeenCalledTimes(3);
      expect(gl.createFramebuffer).toHaveBeenCalledTimes(3);
    });
  },
);

const makeProgramGl = () => {
  let shaderSerial = 0;
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    createShader: vi.fn(() => ({ id: `shader-${shaderSerial++}` }) as unknown as WebGLShader),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => "compile failed"),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ id: "program" }) as unknown as WebGLProgram),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    detachShader: vi.fn(),
    deleteProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => "link failed"),
    getUniformLocation: vi.fn(() => ({ id: "uniform" }) as unknown as WebGLUniformLocation),
  } as unknown as WebGL2RenderingContext;
};

describe("shader and program ownership", () => {
  it("does not attempt cleanup when the first shader cannot be allocated", () => {
    const gl = makeProgramGl();
    vi.mocked(gl.createShader).mockReturnValueOnce(null);

    expect(() => linkProgram(gl, "fragment", [])).toThrow("createShader failed");
    expect(gl.deleteShader).not.toHaveBeenCalled();
    expect(gl.createProgram).not.toHaveBeenCalled();
  });

  it("deletes a shader when shaderSource throws", () => {
    const gl = makeProgramGl();
    const shader = gl.createShader(gl.VERTEX_SHADER)!;
    vi.mocked(gl.createShader).mockReturnValueOnce(shader);
    vi.mocked(gl.shaderSource).mockImplementationOnce(() => {
      throw new Error("injected shaderSource failure");
    });

    expect(() => linkProgram(gl, "fragment", [])).toThrow("injected shaderSource failure");
    expect(gl.deleteShader).toHaveBeenCalledWith(shader);
    expect(gl.createProgram).not.toHaveBeenCalled();
  });

  it("deletes a shader when compileShader throws", () => {
    const gl = makeProgramGl();
    const shader = gl.createShader(gl.VERTEX_SHADER)!;
    vi.mocked(gl.createShader).mockReturnValueOnce(shader);
    vi.mocked(gl.compileShader).mockImplementationOnce(() => {
      throw new Error("injected compileShader failure");
    });

    expect(() => linkProgram(gl, "fragment", [])).toThrow("injected compileShader failure");
    expect(gl.deleteShader).toHaveBeenCalledWith(shader);
    expect(gl.createProgram).not.toHaveBeenCalled();
  });

  it("deletes the failed fragment and prior vertex shader on fragment compile-status failure", () => {
    const gl = makeProgramGl();
    const vertex = { id: "vertex" } as unknown as WebGLShader;
    const fragment = { id: "fragment" } as unknown as WebGLShader;
    vi.mocked(gl.createShader).mockReturnValueOnce(vertex).mockReturnValueOnce(fragment);
    vi.mocked(gl.getShaderParameter).mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(() => linkProgram(gl, "fragment", [])).toThrow("shader compile failed");
    expect(gl.deleteShader).toHaveBeenCalledWith(vertex);
    expect(gl.deleteShader).toHaveBeenCalledWith(fragment);
    expect(gl.createProgram).not.toHaveBeenCalled();
  });

  it("deletes the vertex shader on vertex compile-status failure", () => {
    const gl = makeProgramGl();
    const vertex = { id: "vertex-status" } as unknown as WebGLShader;
    vi.mocked(gl.createShader).mockReturnValueOnce(vertex);
    vi.mocked(gl.getShaderParameter).mockReturnValueOnce(false);

    expect(() => linkProgram(gl, "fragment", [])).toThrow("shader compile failed");
    expect(gl.deleteShader).toHaveBeenCalledWith(vertex);
    expect(gl.createShader).toHaveBeenCalledOnce();
    expect(gl.createProgram).not.toHaveBeenCalled();
  });

  it("deletes both shaders when program allocation fails", () => {
    const gl = makeProgramGl();
    vi.mocked(gl.createProgram).mockReturnValueOnce(null);

    expect(() => linkProgram(gl, "fragment", [])).toThrow("createProgram failed");
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });

  it.each([
    [
      "attachShader",
      (gl: WebGL2RenderingContext) =>
        vi.mocked(gl.attachShader).mockImplementationOnce(() => {
          throw new Error("injected attach failure");
        }),
    ],
    [
      "bindAttribLocation",
      (gl: WebGL2RenderingContext) =>
        vi.mocked(gl.bindAttribLocation).mockImplementationOnce(() => {
          throw new Error("injected bind failure");
        }),
    ],
    [
      "linkProgram",
      (gl: WebGL2RenderingContext) =>
        vi.mocked(gl.linkProgram).mockImplementationOnce(() => {
          throw new Error("injected link failure");
        }),
    ],
  ])("deletes the program and both shaders when %s throws", (_label, inject) => {
    const gl = makeProgramGl();
    const program = gl.createProgram()!;
    vi.mocked(gl.createProgram).mockReturnValueOnce(program);
    inject(gl);

    expect(() => linkProgram(gl, "fragment", [])).toThrow("injected");
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it("deletes the program and both shaders when the second attachment throws", () => {
    const gl = makeProgramGl();
    const program = gl.createProgram()!;
    vi.mocked(gl.createProgram).mockReturnValueOnce(program);
    vi.mocked(gl.attachShader)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("injected second attach failure");
      });

    expect(() => linkProgram(gl, "fragment", [])).toThrow("injected second attach failure");
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it("continues deleting shaders and the program when detachment itself throws", () => {
    const gl = makeProgramGl();
    const program = gl.createProgram()!;
    vi.mocked(gl.createProgram).mockReturnValueOnce(program);
    vi.mocked(gl.detachShader).mockImplementation(() => {
      throw new Error("injected detach failure");
    });

    expect(() => linkProgram(gl, "fragment", [])).toThrow("injected detach failure");
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it("deletes the failed program and both shaders when link status fails", () => {
    const gl = makeProgramGl();
    const program = gl.createProgram()!;
    vi.mocked(gl.createProgram).mockReturnValueOnce(program);
    vi.mocked(gl.getProgramParameter).mockReturnValueOnce(false);

    expect(() => linkProgram(gl, "fragment", [])).toThrow("program link failed");
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it("deletes the program and both shaders when querying link status throws", () => {
    const gl = makeProgramGl();
    const program = gl.createProgram()!;
    vi.mocked(gl.createProgram).mockReturnValueOnce(program);
    vi.mocked(gl.getProgramParameter).mockImplementationOnce(() => {
      throw new Error("injected link-status query failure");
    });

    expect(() => linkProgram(gl, "fragment", [])).toThrow("injected link-status query failure");
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it("deletes the linked program and both shaders when uniform lookup throws", () => {
    const gl = makeProgramGl();
    const program = gl.createProgram()!;
    vi.mocked(gl.createProgram).mockReturnValueOnce(program);
    vi.mocked(gl.getUniformLocation).mockImplementationOnce(() => {
      throw new Error("injected uniform failure");
    });

    expect(() => linkProgram(gl, "fragment", ["u_source"])).toThrow("injected uniform failure");
    expect(gl.deleteProgram).toHaveBeenCalledWith(program);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it("deletes shaders but transfers successful program ownership to the caller", () => {
    const gl = makeProgramGl();
    const program = gl.createProgram()!;
    vi.mocked(gl.createProgram).mockReturnValueOnce(program);

    expect(linkProgram(gl, "fragment", ["u_source"]).prog).toBe(program);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });
});

describe("FFT composite program ownership", () => {
  it.each([0, 1, 2, 3])(
    "deletes all %i earlier programs when that link position fails",
    (failureIndex) => {
      const gl = makeProgramGl();
      const created: Program[] = [];
      const linker = vi.fn((_gl: WebGL2RenderingContext) => {
        if (created.length === failureIndex) throw new Error(`injected FFT link ${failureIndex}`);
        const program = {
          prog: { id: `fft-${created.length}` } as unknown as WebGLProgram,
          uniforms: {},
        };
        created.push(program);
        return program;
      });

      expect(() => createFFTProgramCache(gl, linker)).toThrow(`injected FFT link ${failureIndex}`);
      expect(gl.deleteProgram).toHaveBeenCalledTimes(failureIndex);
      for (const program of created) expect(gl.deleteProgram).toHaveBeenCalledWith(program.prog);
    },
  );

  it("transfers all four programs only after the complete bundle succeeds", () => {
    const gl = makeProgramGl();
    const linker = vi.fn(
      (_gl: WebGL2RenderingContext, _source: string, uniforms: readonly string[]) => ({
        prog: { id: `fft-${uniforms.join("-")}` } as unknown as WebGLProgram,
        uniforms: {},
      }),
    );

    const cache = createFFTProgramCache(gl, linker);
    expect(Object.keys(cache)).toEqual(["extract", "bitrev", "butterfly", "finalise"]);
    expect(linker).toHaveBeenCalledTimes(4);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });

  it("continues deleting earlier programs when one composite cleanup throws", () => {
    const gl = makeProgramGl();
    const created: Program[] = [];
    const linker = vi.fn((_gl: WebGL2RenderingContext) => {
      if (created.length === 3) throw new Error("injected final FFT link failure");
      const program = {
        prog: { id: `fft-${created.length}` } as unknown as WebGLProgram,
        uniforms: {},
      };
      created.push(program);
      return program;
    });
    vi.mocked(gl.deleteProgram).mockImplementationOnce(() => {
      throw new Error("injected program cleanup failure");
    });

    expect(() => createFFTProgramCache(gl, linker)).toThrow("injected final FFT link failure");
    expect(gl.deleteProgram).toHaveBeenCalledTimes(3);
    for (const program of created) expect(gl.deleteProgram).toHaveBeenCalledWith(program.prog);
  });
});

const makeQuadGl = () =>
  ({
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    createVertexArray: vi.fn(() => ({ id: "vao" }) as unknown as WebGLVertexArrayObject),
    deleteVertexArray: vi.fn(),
    bindVertexArray: vi.fn(),
    createBuffer: vi.fn(() => ({ id: "buffer" }) as unknown as WebGLBuffer),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
  }) as unknown as WebGL2RenderingContext;

describe("fullscreen quad composite ownership", () => {
  it("does not attempt cleanup when VAO allocation fails", () => {
    const gl = makeQuadGl();
    vi.mocked(gl.createVertexArray).mockReturnValueOnce(null);

    expect(() => createQuadVAO(gl)).toThrow("createVertexArray failed");
    expect(gl.createBuffer).not.toHaveBeenCalled();
    expect(gl.deleteVertexArray).not.toHaveBeenCalled();
  });

  it("deletes the VAO when buffer allocation fails", () => {
    const gl = makeQuadGl();
    const vao = gl.createVertexArray()!;
    vi.mocked(gl.createVertexArray).mockReturnValueOnce(vao);
    vi.mocked(gl.createBuffer).mockReturnValueOnce(null);

    expect(() => createQuadVAO(gl)).toThrow("createBuffer failed");
    expect(gl.deleteVertexArray).toHaveBeenCalledWith(vao);
    expect(gl.deleteBuffer).not.toHaveBeenCalled();
  });

  it.each([
    [
      "bindVertexArray",
      (gl: WebGL2RenderingContext) =>
        vi.mocked(gl.bindVertexArray).mockImplementationOnce(() => {
          throw new Error("injected quad bind VAO failure");
        }),
    ],
    [
      "bindBuffer",
      (gl: WebGL2RenderingContext) =>
        vi.mocked(gl.bindBuffer).mockImplementationOnce(() => {
          throw new Error("injected quad bind buffer failure");
        }),
    ],
    [
      "bufferData",
      (gl: WebGL2RenderingContext) =>
        vi.mocked(gl.bufferData).mockImplementationOnce(() => {
          throw new Error("injected quad upload failure");
        }),
    ],
    [
      "enableVertexAttribArray",
      (gl: WebGL2RenderingContext) =>
        vi.mocked(gl.enableVertexAttribArray).mockImplementationOnce(() => {
          throw new Error("injected quad enable failure");
        }),
    ],
    [
      "vertexAttribPointer",
      (gl: WebGL2RenderingContext) =>
        vi.mocked(gl.vertexAttribPointer).mockImplementationOnce(() => {
          throw new Error("injected quad pointer failure");
        }),
    ],
    [
      "final bindVertexArray",
      (gl: WebGL2RenderingContext) =>
        vi
          .mocked(gl.bindVertexArray)
          .mockImplementationOnce(() => undefined)
          .mockImplementationOnce(() => {
            throw new Error("injected quad unbind failure");
          }),
    ],
  ])("deletes both staged handles when %s throws", (_label, inject) => {
    const gl = makeQuadGl();
    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    vi.mocked(gl.createVertexArray).mockReturnValueOnce(vao);
    vi.mocked(gl.createBuffer).mockReturnValueOnce(buffer);
    inject(gl);

    expect(() => createQuadVAO(gl)).toThrow("injected quad");
    expect(gl.deleteBuffer).toHaveBeenCalledWith(buffer);
    expect(gl.deleteVertexArray).toHaveBeenCalledWith(vao);
  });

  it("transfers both staged handles only after setup succeeds", () => {
    const gl = makeQuadGl();
    const vao = gl.createVertexArray()!;
    vi.mocked(gl.createVertexArray).mockReturnValueOnce(vao);

    expect(createQuadVAO(gl)).toBe(vao);
    expect(gl.deleteBuffer).not.toHaveBeenCalled();
    expect(gl.deleteVertexArray).not.toHaveBeenCalled();
  });
});
