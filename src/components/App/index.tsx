import React, { useState, useRef, useEffect, useCallback } from "react";
import useDraggable from "./useDraggable";

import Controls from "components/controls";
import ChainList from "components/ChainList";
import Exporter from "components/App/Exporter";
import SaveAs from "components/SaveAs";
import Range from "components/controls/Range";
import Enum from "components/controls/Enum";
import CollapsibleSection from "components/CollapsibleSection";

import { useFilter } from "context/useFilter";
import { SCALING_ALGORITHM } from "constants/optionTypes";
import { SCALING_ALGORITHM_OPTIONS } from "constants/controlTypes";

import controls from "components/controls/styles.module.css";
import s from "./styles.module.css";

const App = () => {
  const { state, actions, filterList } = useFilter();
  const [dropping, setDropping] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("ditherer-theme") || "default");
  const [canvasDropping, setCanvasDropping] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [videoPaused, setVideoPaused] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [playPauseIndicator, setPlayPauseIndicator] = useState<"play" | "pause" | null>(null);
  const playPauseTimerRef = useRef<number | null>(null);

  const flashPlayPause = (kind: "play" | "pause") => {
    setPlayPauseIndicator(kind);
    if (playPauseTimerRef.current) window.clearTimeout(playPauseTimerRef.current);
    playPauseTimerRef.current = window.setTimeout(() => setPlayPauseIndicator(null), 600);
  };

  const inputCanvasRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const zIndexRef = useRef(0);
  const inputDragRef = useRef(null);
  const outputDragRef = useRef(null);
  const saveAsDragRef = useRef(null);
  const dragScaleStart = useRef({ input: 1, output: 1 });

  const inputDrag = useDraggable(inputDragRef, {
    onScale: (delta) => {
      const newScale = Math.round(Math.max(0.05, Math.min(16, state.scale + delta)) * 10) / 10;
      actions.setScale(newScale);
    },
    onScaleAbsolute: (ratio) => {
      // ratio=1.0 at start → capture; subsequent calls use captured start
      if (Math.abs(ratio - 1) < 0.005) dragScaleStart.current.input = state.scale;
      const newScale = Math.max(0.05, Math.min(16, dragScaleStart.current.input * ratio));
      actions.setScale(Math.round(newScale * 100) / 100);
    }
  });
  const outputDrag = useDraggable(outputDragRef, {
    defaultPosition: { x: 320, y: 20 },
    onScale: (delta) => {
      const newScale = Math.round(Math.max(0.05, Math.min(16, state.outputScale + delta)) * 10) / 10;
      actions.setOutputScale(newScale);
    },
    onScaleAbsolute: (ratio) => {
      if (Math.abs(ratio - 1) < 0.005) dragScaleStart.current.output = state.outputScale;
      const newScale = Math.max(0.05, Math.min(16, dragScaleStart.current.output * ratio));
      actions.setOutputScale(Math.round(newScale * 100) / 100);
    }
  });
  const saveAsDrag = useDraggable(saveAsDragRef, { defaultPosition: { x: 160, y: 400 } });

  // Apply saved theme on mount
  useEffect(() => {
    if (theme === "rainy-day") {
      document.documentElement.setAttribute("data-theme", "rainy-day");
    }
  }, []);

  // Register input canvas with state
  useEffect(() => {
    if (inputCanvasRef.current) {
      actions.setInputCanvas(inputCanvasRef.current);
    }
  }, []);

  // Draw to canvas when input/output changes
  const prevPropsRef = useRef<any>({});
  useEffect(() => {
    const prev = prevPropsRef.current;

    const drawToCanvas = (canvas, image, scale) => {
      const finalWidth = image.width * scale;
      const finalHeight = image.height * scale;
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = state.scalingAlgorithm === SCALING_ALGORITHM.AUTO;
      if (ctx) {
        ctx.drawImage(image, 0, 0, finalWidth, finalHeight);
      }
    };

    const newInput = state.inputImage !== prev.inputImage;
    const newScale = state.scale !== prev.scale;
    const newTime = state.time !== prev.time;

    if (inputCanvasRef.current && state.inputImage && (newTime || newInput || newScale)) {
      drawToCanvas(inputCanvasRef.current, state.inputImage, state.scale);
    }

    if (outputCanvasRef.current && state.outputImage && state.outputImage !== prev.outputImage) {
      drawToCanvas(outputCanvasRef.current, state.outputImage, state.outputScale);
    }

    prevPropsRef.current = {
      inputImage: state.inputImage,
      outputImage: state.outputImage,
      scale: state.scale,
      time: state.time,
    };
  }, [state.inputImage, state.outputImage, state.scale, state.outputScale, state.time, state.scalingAlgorithm]);

  // Auto-filter when settings change and realtimeFiltering is on
  useEffect(() => {
    if (!state.realtimeFiltering || !inputCanvasRef.current || !state.inputImage) return;
    requestAnimationFrame(() => {
      actions.filterImageAsync(inputCanvasRef.current);
    });
  }, [
    state.chain, state.linearize, state.wasmAcceleration,
    state.convertGrayscale, state.realtimeFiltering, state.inputImage,
    state.scale, state.outputScale, state.time,
  ]);

  const bringToTop = useCallback(e => {
    zIndexRef.current += 1;
    e.currentTarget.style.zIndex = `${zIndexRef.current}`;
  }, []);

  return (
    <div className={s.app}>
      <div className={s.chrome}>
        <h1>ＤＩＴＨＥＲＥＲ ▓▒░</h1>

        {/* Input section */}
        <div>
          <h2>Input</h2>
          <input
            className={[controls.file, dropping ? controls.dropping : null].join(" ")}
            type="file"
            accept="image/*,video/*"
            id="imageLoader"
            name="imageLoader"
            onChange={e => actions.loadMediaAsync(e.target.files[0], state.videoVolume, state.videoPlaybackRate)}
            onDragLeave={() => setDropping(false)}
            onDragOver={() => setDropping(true)}
            onDragEnter={() => setDropping(true)}
            onDrop={() => setDropping(false)}
          />
          <button
            onClick={() => {
              const img = new Image();
              img.src = "pepper.png";
              img.onload = () => actions.loadImage(img);
            }}
          >
            Load test image
          </button>
          <button
            onClick={() => {
              fetch("akiyo.mp4")
                .then(r => r.blob())
                .then(blob => {
                  const file = new File([blob], "akiyo.mp4", { type: "video/mp4" });
                  actions.loadMediaAsync(file, state.videoVolume, state.videoPlaybackRate);
                });
            }}
          >
            Load test video
          </button>
          <Range
            name="Input Scale"
            types={{ range: [0.05, 16] }}
            step={0.05}
            onSetFilterOption={(_, value) => actions.setScale(value)}
            value={state.scale}
          />
          {state.video && (<>
            <div className={controls.separator} />
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              <button onClick={() => { actions.toggleVideo(); const np = !videoPaused; setVideoPaused(np); flashPlayPause(np ? "pause" : "play"); }}>
                {videoPaused ? "\u25B6 Play" : "\u23F8 Pause"}
              </button>
              <label className={controls.label} htmlFor="mute">
                <input
                  id="mute"
                  type="checkbox"
                  checked={state.videoVolume === 0}
                  onChange={() => {
                    const newVol = state.videoVolume > 0 ? 0 : 1;
                    actions.setInputVolume(newVol);
                    localStorage.setItem("ditherer-mute", newVol === 0 ? "1" : "0");
                  }}
                />
                Mute
              </label>
            </div>
            <Range
              name="Playback rate"
              types={{ range: [0, 2] }}
              step={0.05}
              onSetFilterOption={(_, value) => actions.setInputPlaybackRate(value)}
              value={state.videoPlaybackRate}
            />
          </>)}
        </div>

        {/* Algorithm section */}
        <CollapsibleSection title="Algorithm" defaultOpen>
          <div className={["filterOptions", s.filterOptions].join(" ")}>
            <ChainList />
            <div className={controls.group}>
              <span className={controls.name}>
                {state.chain[state.activeIndex]?.displayName ?? "Options"}
              </span>
              <Controls inputCanvas={inputCanvasRef.current} />
              {state.selected?.filter?.defaults && (
                <button
                  onClick={() => {
                    const name = state.selected.displayName || state.selected.name;
                    const filter = filterList.find(f => f && f.displayName === name);
                    if (filter) {
                      const entry = state.chain[state.activeIndex];
                      if (entry) actions.chainReplace(entry.id, name, filter.filter);
                    }
                  }}
                >
                  Reset defaults
                </button>
              )}
            </div>
            <div className={controls.separator} />
            <div className={controls.checkbox}>
              <input
                name="convertGrayscale"
                type="checkbox"
                checked={state.convertGrayscale}
                onChange={e => actions.setConvertGrayscale(e.target.checked)}
              />
              <span
                role="presentation"
                onClick={() => actions.setConvertGrayscale(!state.convertGrayscale)}
                className={controls.label}
              >
                Pre-convert to grayscale
              </span>
            </div>
            <div className={controls.checkbox}>
              <input
                name="linearize"
                type="checkbox"
                checked={state.linearize}
                onChange={e => actions.setLinearize(e.target.checked)}
              />
              <span
                role="presentation"
                onClick={() => actions.setLinearize(!state.linearize)}
                className={controls.label}
              >
                Gamma-correct input
              </span>
            </div>
          </div>
        </CollapsibleSection>

        {/* Filter button — always visible, sticky on mobile */}
        <div className={s.filterBar}>
          <button
            className={[s.filterButton, s.waitButton].join(" ")}
            disabled={filtering}
            onClick={() => {
              setFiltering(true);
              document.body.style.cursor = "wait";
              requestAnimationFrame(() => {
                actions.filterImageAsync(inputCanvasRef.current);
                setFiltering(false);
                document.body.style.cursor = "";
              });
            }}
          >
            {filtering ? "▓░ Processing…" : "Filter"}
          </button>
        </div>

        {/* Output section */}
        <CollapsibleSection title="Output" defaultOpen>
          <Range
            name="Output Scale"
            types={{ range: [0.05, 16] }}
            step={0.05}
            onSetFilterOption={(_, value) => actions.setOutputScale(value)}
            value={state.outputScale}
          />
          <Enum
            name="Scaling algorithm"
            onSetFilterOption={(_, algorithm) => actions.setScalingAlgorithm(algorithm)}
            value={state.scalingAlgorithm}
            types={SCALING_ALGORITHM_OPTIONS}
          />
          <button
            className={s.copyButton}
            onClick={async () => {
              // For video sources: record the filtered output canvas for one full
              // loop of the source video, then load it back as a new video input.
              // This bakes the current filter chain into the video.
              if (state.video && outputCanvasRef.current) {
                const canvas = outputCanvasRef.current;
                const stream = canvas.captureStream(30);
                // Pick a supported mime type
                const mimeCandidates = [
                  "video/webm;codecs=vp9",
                  "video/webm;codecs=vp8",
                  "video/webm",
                ];
                const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";
                const chunks: BlobPart[] = [];
                const recorder = new MediaRecorder(stream, { mimeType });
                recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
                recorder.onstop = () => {
                  const blob = new Blob(chunks, { type: mimeType });
                  const file = new File([blob], "filtered.webm", { type: mimeType });
                  actions.loadMediaAsync(file, state.videoVolume, state.videoPlaybackRate);
                };

                // Restart video from beginning so we capture a full loop
                const v = state.video;
                const wasPaused = v.paused;
                try { v.currentTime = 0; } catch { /* ignore */ }
                if (wasPaused) await v.play().catch(() => {});

                const duration = isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
                recorder.start();
                window.setTimeout(() => {
                  if (recorder.state !== "inactive") recorder.stop();
                  stream.getTracks().forEach(t => t.stop());
                }, duration * 1000 + 100);
                return;
              }

              // For static images: copy the current filtered frame
              if (outputCanvasRef.current) {
                const image = new Image();
                image.src = outputCanvasRef.current.toDataURL("image/png");
                image.onload = () => {
                  actions.loadImage(image);
                  actions.setScale(1);
                };
              }
            }}
          >
            {"<< Copy output to input"}
          </button>
        </CollapsibleSection>

        {/* Settings section */}
        <CollapsibleSection title="Settings" collapsible>
          <div className={controls.checkbox}>
            <input
              name="realtimeFiltering"
              type="checkbox"
              checked={state.realtimeFiltering}
              onChange={e => actions.setRealtimeFiltering(e.target.checked)}
            />
            <span
              role="presentation"
              onClick={() => actions.setRealtimeFiltering(!state.realtimeFiltering)}
              className={controls.label}
            >
              Apply automatically
            </span>
          </div>
          <div className={controls.checkbox}>
            <input
              name="wasmAcceleration"
              type="checkbox"
              checked={state.wasmAcceleration}
              onChange={e => actions.setWasmAcceleration(e.target.checked)}
            />
            <span
              role="presentation"
              onClick={() => actions.setWasmAcceleration(!state.wasmAcceleration)}
              className={controls.label}
            >
              WASM acceleration
            </span>
          </div>
          <div className={controls.separator} />
          <div className={controls.checkbox}>
            <input
              name="theme"
              type="checkbox"
              checked={theme === "rainy-day"}
              onChange={e => {
                const newTheme = e.target.checked ? "rainy-day" : "default";
                setTheme(newTheme);
                localStorage.setItem("ditherer-theme", newTheme);
                if (newTheme === "rainy-day") {
                  document.documentElement.setAttribute("data-theme", "rainy-day");
                } else {
                  document.documentElement.removeAttribute("data-theme");
                }
              }}
            />
            <span
              role="presentation"
              onClick={() => {
                const newTheme = theme === "rainy-day" ? "default" : "rainy-day";
                setTheme(newTheme);
                localStorage.setItem("ditherer-theme", newTheme);
                if (newTheme === "rainy-day") {
                  document.documentElement.setAttribute("data-theme", "rainy-day");
                } else {
                  document.documentElement.removeAttribute("data-theme");
                }
              }}
              className={controls.label}
            >
              Rainy Day theme
            </span>
          </div>
          <div className={controls.separator} />
          <Exporter />
        </CollapsibleSection>

        {state.frameTime != null && (
          <div className={s.perfStats}>
            {state.stepTimes && state.stepTimes.length > 1
              ? `${state.stepTimes.length} filters`
              : state.stepTimes?.[0]?.name ?? "Filter"
            } | {state.frameTime.toFixed(0)}ms | {(1000 / state.frameTime).toFixed(1)} fps
          </div>
        )}
        <div className={s.github}>
          <a href="https://github.com/gyng/ditherer/">GitHub</a>
        </div>
      </div>

      {/* Canvases */}
      <div className={s.canvases}>
        <div
          ref={inputDragRef}
          role="presentation"
          onMouseDown={inputDrag.onMouseDown}
          onMouseDownCapture={bringToTop}
          onMouseMove={inputDrag.onMouseMove}
          onDragOver={e => { e.preventDefault(); setCanvasDropping(true); }}
          onDragLeave={() => setCanvasDropping(false)}
          onDrop={e => {
            e.preventDefault();
            setCanvasDropping(false);
            const file = e.dataTransfer.files[0];
            if (file) actions.loadMediaAsync(file, state.videoVolume, state.videoPlaybackRate);
          }}
        >
          <div
            className={[controls.window, s.inputWindow, canvasDropping ? s.dropping : ""].join(" ")}
            style={!state.inputImage ? { minWidth: Math.round(200 * state.scale), minHeight: Math.round(200 * state.scale) } : undefined}
          >
            <div className={["handle", controls.titleBar].join(" ")}>Input</div>
            <div className={s.canvasArea}>
              {(!state.inputImage || canvasDropping) && (
                <div
                  className={s.dropPlaceholder}
                  onClick={() => !canvasDropping && !inputDrag.didDrag.current && document.getElementById("imageLoader")?.click()}
                  style={{ cursor: canvasDropping ? undefined : "pointer" }}
                >
                  <span>{canvasDropping ? "Drop to load" : "Drop or click to load image/video"}</span>
                </div>
              )}
              <canvas
                className={[s.canvas, s[state.scalingAlgorithm]].join(" ")}
                ref={inputCanvasRef}
                onClick={() => {
                  if (state.video && !inputDrag.didDrag.current) {
                    actions.toggleVideo();
                    const nowPaused = !videoPaused;
                    setVideoPaused(nowPaused);
                    flashPlayPause(nowPaused ? "pause" : "play");
                  }
                }}
                style={state.video ? { cursor: "pointer" } : undefined}
              />
              {playPauseIndicator && (
                <div className={s.playPauseOverlay}>
                  {playPauseIndicator === "play" ? "▶ PLAY" : "❚❚ PAUSE"}
                </div>
              )}
            </div>
          </div>
        </div>

        <div ref={outputDragRef} role="presentation" onMouseDown={outputDrag.onMouseDown} onMouseDownCapture={bringToTop} onMouseMove={outputDrag.onMouseMove}>
          <div className={controls.window}>
            <div className={["handle", controls.titleBar].join(" ")}>Output</div>
            <div className={s.menuBar}>
              <button
                className={s.menuItem}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => {
                  setShowSaveAs(true);
                  zIndexRef.current += 1;
                  if (saveAsDragRef.current) {
                    (saveAsDragRef.current as HTMLElement).style.zIndex = `${zIndexRef.current}`;
                  }
                }}
              >
                Save As...
              </button>
            </div>
            <canvas className={s.canvas} ref={outputCanvasRef} />
          </div>
        </div>

        <div
          ref={saveAsDragRef}
          role="presentation"
          onMouseDown={saveAsDrag.onMouseDown}
          onMouseDownCapture={bringToTop}
          onMouseMove={saveAsDrag.onMouseMove}
          style={showSaveAs ? undefined : { display: "none" }}
        >
          {showSaveAs && (
            <SaveAs
              outputCanvasRef={outputCanvasRef}
              onClose={() => setShowSaveAs(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
