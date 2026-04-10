import { RANGE, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";

export const optionTypes = {
  zoom: { type: RANGE, range: [1.01, 1.2], step: 0.01, default: 1.05, desc: "Scale factor per feedback iteration" },
  rotation: { type: RANGE, range: [-10, 10], step: 0.5, default: 1, desc: "Rotation degrees per iteration" },
  offsetX: { type: RANGE, range: [-0.2, 0.2], step: 0.01, default: 0, desc: "Horizontal drift as fraction of width" },
  offsetY: { type: RANGE, range: [-0.2, 0.2], step: 0.01, default: 0, desc: "Vertical drift as fraction of height" },
  mix: { type: RANGE, range: [0.3, 0.95], step: 0.05, default: 0.7, desc: "Blend ratio of feedback vs fresh input" },
  colorShift: { type: RANGE, range: [0, 30], step: 1, default: 5, desc: "Hue rotation degrees per iteration" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  zoom: optionTypes.zoom.default,
  rotation: optionTypes.rotation.default,
  offsetX: optionTypes.offsetX.default,
  offsetY: optionTypes.offsetY.default,
  mix: optionTypes.mix.default,
  colorShift: optionTypes.colorShift.default,
  animSpeed: optionTypes.animSpeed.default,
};

const videoFeedback = (input, options: any = defaults) => {
  const { zoom, rotation, offsetX, offsetY, mix, colorShift } = options;
  const prevOutput: Uint8ClampedArray | null = (options as any)._prevOutput || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  if (!prevOutput || prevOutput.length !== buf.length) {
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  // Put prevOutput on a temp canvas, then draw it transformed onto scratch
  const temp = cloneCanvas(input, false);
  const tCtx = temp.getContext("2d");
  const scratch = cloneCanvas(input, false);
  const sCtx = scratch.getContext("2d");
  if (!tCtx || !sCtx) {
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  tCtx.putImageData(new ImageData(new Uint8ClampedArray(prevOutput), W, H), 0, 0);

  const cx = W / 2, cy = H / 2;
  const rad = rotation * Math.PI / 180;
  const cos = Math.cos(rad) * zoom;
  const sin = Math.sin(rad) * zoom;

  sCtx.save();
  sCtx.translate(cx + offsetX * W, cy + offsetY * H);
  sCtx.transform(cos, sin, -sin, cos, 0, 0);
  sCtx.translate(-cx, -cy);
  sCtx.drawImage(temp, 0, 0);
  sCtx.restore();

  const fbData = sCtx.getImageData(0, 0, W, H).data;

  // Blend feedback with current input, apply hue shift to feedback
  const currentWeight = 1 - mix;
  for (let i = 0; i < buf.length; i += 4) {
    let fR = fbData[i], fG = fbData[i + 1], fB = fbData[i + 2];

    // Simple hue rotation via channel cycling approximation
    if (colorShift > 0) {
      const shift = colorShift / 120;
      const r = fR, g = fG, b = fB;
      fR = Math.min(255, Math.max(0, Math.round(r * (1 - shift) + g * shift)));
      fG = Math.min(255, Math.max(0, Math.round(g * (1 - shift) + b * shift)));
      fB = Math.min(255, Math.max(0, Math.round(b * (1 - shift) + r * shift)));
    }

    outBuf[i]     = Math.round(fR * mix + buf[i] * currentWeight);
    outBuf[i + 1] = Math.round(fG * mix + buf[i + 1] * currentWeight);
    outBuf[i + 2] = Math.round(fB * mix + buf[i + 2] * currentWeight);
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Video Feedback", func: videoFeedback, optionTypes, options: defaults, defaults, mainThread: true, description: "Camera-pointing-at-monitor effect — infinite recursive tunnels and fractal patterns" };
