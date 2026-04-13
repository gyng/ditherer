import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasToBlob, replaceObjectUrl, revokeObjectUrl } from "components/SaveAs/export/exportArtifacts";

describe("replaceObjectUrl", () => {
  const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:new-url");

  afterEach(() => {
    revokeSpy.mockClear();
    createSpy.mockClear();
  });

  it("replaces an existing object URL when a blob is provided", () => {
    const result = replaceObjectUrl("blob:old-url", new Blob(["x"], { type: "text/plain" }));

    expect(revokeSpy).toHaveBeenCalledWith("blob:old-url");
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(result).toBe("blob:new-url");
  });

  it("only revokes when clearing a blob URL", () => {
    const result = replaceObjectUrl("blob:old-url", null);

    expect(revokeSpy).toHaveBeenCalledWith("blob:old-url");
    expect(createSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("revokeObjectUrl ignores null inputs", () => {
    revokeObjectUrl(null);
    expect(revokeSpy).not.toHaveBeenCalled();
  });
});

describe("canvasToBlob", () => {
  it("resolves whatever the canvas callback returns", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const canvas = {
      toBlob: (callback: (value: Blob | null) => void) => callback(blob),
    } as unknown as HTMLCanvasElement;

    await expect(canvasToBlob(canvas, "image/png")).resolves.toBe(blob);
  });
});
