import React, { useState, useRef, useEffect, useCallback } from "react";
import useDraggable from "./useDraggable";

import Controls from "components/controls";
import ChainList from "components/ChainList";
import Exporter from "components/App/Exporter";
import Range from "components/controls/Range";
import Enum from "components/controls/Enum";
import CollapsibleSection from "components/CollapsibleSection";

import { useFilter } from "context/FilterContext";
import { SCALING_ALGORITHM } from "constants/optionTypes";
import { SCALING_ALGORITHM_OPTIONS } from "constants/controlTypes";

import controls from "components/controls/styles.module.css";
import s from "./styles.module.css";

const App = () => {
  const { state, actions, filterList } = useFilter();
  const [dropping, setDropping] = useState(false);
  const [canvasDropping, setCanvasDropping] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [hasCapture, setHasCapture] = useState(false);

  const inputCanvasRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const chunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const captureVideoRef = useRef(null);
  const zIndexRef = useRef(0);
  const streamRef = useRef(null);
  const inputDragRef = useRef(null);
  const outputDragRef = useRef(null);
  const captureDragRef = useRef(null);
  const dragScaleStart = useRef({ input: 1, output: 1 });

  const inputDrag = useDraggable(inputDragRef, {
    onScale: (delta) => {
      const newScale = Math.round(Math.max(0.1, Math.min(4, state.scale + delta)) * 10) / 10;
      actions.setScale(newScale);
    },
    onScaleAbsolute: (ratio) => {
      // ratio=1.0 at start → capture; subsequent calls use captured start
      if (Math.abs(ratio - 1) < 0.005) dragScaleStart.current.input = state.scale;
      const newScale = Math.max(0.1, Math.min(4, dragScaleStart.current.input * ratio));
      actions.setScale(Math.round(newScale * 100) / 100);
    }
  });
  const outputDrag = useDraggable(outputDragRef, {
    defaultPosition: { x: 320, y: 20 },
    onScale: (delta) => {
      const newScale = Math.round(Math.max(0.1, Math.min(4, state.outputScale + delta)) * 10) / 10;
      actions.setOutputScale(newScale);
    },
    onScaleAbsolute: (ratio) => {
      if (Math.abs(ratio - 1) < 0.005) dragScaleStart.current.output = state.outputScale;
      const newScale = Math.max(0.1, Math.min(4, dragScaleStart.current.output * ratio));
      actions.setOutputScale(Math.round(newScale * 100) / 100);
    }
  });
  const captureDrag = useDraggable(captureDragRef, { defaultPosition: { x: 160, y: 400 } });

  // Create capture video element once
  useEffect(() => {
    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    captureVideoRef.current = video;

    const captureOutputContainer = document.body && document.body.querySelector("#captureOutput");
    if (captureOutputContainer) {
      captureOutputContainer.appendChild(video);
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
    document.body.style.cursor = "wait";
    requestAnimationFrame(() => {
      actions.filterImageAsync(inputCanvasRef.current);
      document.body.style.cursor = "";
    });
  }, [
    state.chain, state.linearize, state.wasmAcceleration,
    state.convertGrayscale, state.realtimeFiltering, state.inputImage,
    state.scale, state.outputScale,
  ]);

  const bringToTop = useCallback(e => {
    zIndexRef.current += 1;
    e.currentTarget.style.zIndex = `${zIndexRef.current}`;
  }, []);

  const handleCapture = useCallback(() => {
    if (!capturing && outputCanvasRef.current) {
      const stream = outputCanvasRef.current.captureStream(25);
      streamRef.current = stream;

      if (stream && state.video) {
        const vid = state.video;
        let streams;
        if (vid.captureStream) {
          streams = vid.captureStream(25);
        }
        if (streams && stream && state.videoVolume > 0) {
          const audioTracks = streams.getAudioTracks();
          audioTracks.forEach(t => stream.addTrack(t.clone()));
        }
      }

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.start();
      recorder.ondataavailable = e => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        chunksRef.current = [];
        const dataUrl = URL.createObjectURL(blob);
        if (captureVideoRef.current) {
          captureVideoRef.current.srcObject = null;
          captureVideoRef.current.src = dataUrl;
        }
        setHasCapture(true);
      };
      setCapturing(true);
      setHasCapture(false);
    } else if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      setCapturing(false);
    }
  }, [capturing, state.video, state.videoVolume]);

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
          <Range
            name="Input Scale"
            types={{ range: [0.1, 4] }}
            step={0.1}
            onSetFilterOption={(_, value) => actions.setScale(value)}
            value={state.scale}
          />
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
            types={{ range: [0.1, 4] }}
            step={0.1}
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
            onClick={() => {
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

        {/* Video section — auto-opens when video loaded, auto-closes for images */}
        <CollapsibleSection title="Video" collapsible forceOpen={!!state.video}>
          <div>
            <label className={controls.label} htmlFor="mute">
              <input
                id="mute"
                type="checkbox"
                checked={state.videoVolume === 0}
                onChange={() => actions.setInputVolume(state.videoVolume > 0 ? 0 : 1)}
              />
              Mute video
            </label>
          </div>
          <div>
            <Range
              name="Playback rate"
              types={{ range: [0, 2] }}
              step={0.05}
              onSetFilterOption={(_, value) => actions.setInputPlaybackRate(value)}
              value={state.videoPlaybackRate}
            />
          </div>
          <div className={s.captureSection}>
            <button
              id="captureButton"
              style={{ margin: "5px 0" }}
              disabled={!state.realtimeFiltering}
              onClick={handleCapture}
            >
              {capturing ? "Stop capture" : "Capture output video"}
            </button>
          </div>
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
          <Exporter />
        </CollapsibleSection>

        {state.frameTime != null && (
          <div className={s.perfStats}>
            {state.stepTimes && state.stepTimes.length > 1
              ? <>
                  {state.stepTimes.length} filters {state.frameTime.toFixed(1)}ms ({state.stepTimes.map(st => st.ms.toFixed(0)).join(" + ")}) | {(1000 / state.frameTime).toFixed(1)} fps
                </>
              : <>
                  {state.stepTimes?.[0]?.name ?? "Filter"} {state.frameTime.toFixed(1)}ms | {(1000 / state.frameTime).toFixed(1)} fps
                </>
            }
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
                  onClick={() => !canvasDropping && document.getElementById("imageLoader")?.click()}
                  style={{ cursor: canvasDropping ? undefined : "pointer" }}
                >
                  <span>{canvasDropping ? "Drop to load" : "Drop or click to load image/video"}</span>
                </div>
              )}
              <canvas
                className={[s.canvas, s[state.scalingAlgorithm]].join(" ")}
                ref={inputCanvasRef}
              />
            </div>
          </div>
        </div>

        <div ref={outputDragRef} role="presentation" onMouseDown={outputDrag.onMouseDown} onMouseDownCapture={bringToTop} onMouseMove={outputDrag.onMouseMove}>
          <div className={controls.window}>
            <div className={["handle", controls.titleBar].join(" ")}>Output</div>
            <canvas className={s.canvas} ref={outputCanvasRef} />
          </div>
        </div>

        <div
          ref={captureDragRef}
          role="presentation"
          onMouseDown={captureDrag.onMouseDown}
          onMouseDownCapture={bringToTop}
          id="captureWindow"
          className={hasCapture ? "" : s.hide}
        >
          <div className={controls.window}>
            <div className={["handle", controls.titleBar].join(" ")}>Capture</div>
            <div id="captureOutput" />
            <div className={[s.rec, !capturing ? s.hide : ""].join(" ")}>● REC</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
