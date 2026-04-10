const MAX_PIXELS_MOBILE = 500_000;
const MAX_PIXELS_DESKTOP = 2_000_000;

export const DEFAULT_INPUT_WINDOW_WIDTH = 200;
export const DEFAULT_INPUT_WINDOW_HEIGHT = 174;

type Viewport = {
  width: number;
};

export const getAutoScale = (
  width: number,
  height: number,
  viewport: Viewport = {
    width: typeof window === "undefined" ? 0 : window.innerWidth,
  }
): number => {
  if (width <= 0 || height <= 0) return 1;

  const isMobile = viewport.width <= 768;
  const maxPixels = isMobile ? MAX_PIXELS_MOBILE : MAX_PIXELS_DESKTOP;
  const sidebarWidth = isMobile ? 16 : 240;
  const availableWidth = Math.max(
    DEFAULT_INPUT_WINDOW_WIDTH,
    viewport.width - sidebarWidth
  );
  const fitScale = availableWidth / width;
  const pixelScale = Math.sqrt(maxPixels / (width * height));
  const minWindowScale = Math.max(
    DEFAULT_INPUT_WINDOW_WIDTH / width,
    DEFAULT_INPUT_WINDOW_HEIGHT / height,
    1
  );

  return Math.min(Math.min(fitScale, pixelScale), minWindowScale);
};

export const roundScale = (scale: number) =>
  Math.round(scale * 10) / 10 || 0.1;
