import React, { useState, useRef, useEffect, useCallback } from "react";
import useDraggable from "./useDraggable";

import Controls from "components/controls";
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
  const { state, actions, filterList, grayscale } = useFilter();
  const [dropping, setDropping] = useState(false);
  const [canvasDropping, setCanvasDropping] = useState(false);
  const [capturing, setCapturing] = useState(false);
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
  const inputDrag = useDraggable(inputDragRef);
  const outputDrag = useDraggable(outputDragRef, { defaultPosition: { x: 80, y: 200 } });
  const captureDrag = useDraggable(captureDragRef);

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
  const prevPropsRef = useRef({});
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

      if (captureVideoRef.current) {
        captureVideoRef.current.srcObject = stream;
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
      };
      setCapturing(true);
      setHasCapture(true);
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

        {/* Load image section */}
        <div>
          <h2>Load image or video</h2>
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
            <select
              className={controls.enum}
              onChange={e => {
                const name = e.target.value;
                const filter = filterList.find(f => f && f.displayName === name);
                actions.selectFilter(name, filter);
              }}
              value={state.selected && (state.selected.displayName || state.selected.name)}
            >
              {filterList.map(f => (
                <option key={f && f.displayName} value={f && f.displayName}>
                  {f && f.displayName}
                </option>
              ))}
            </select>
            <div className={controls.group}>
              <span className={controls.name}>Options</span>
              <Controls inputCanvas={inputCanvasRef.current} />
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
                  Linearize (gamma-correct)
                </span>
              </div>
            </div>
            <Exporter />
          </div>
        </CollapsibleSection>

        {/* Filter + video section */}
        <CollapsibleSection title="Filter">
          <button
            className={[s.filterButton, s.waitButton].join(" ")}
            onClick={() => {
              const filterFunc = state.convertGrayscale
                ? (i, o) => state.selected.filter.func(grayscale.func(i), o)
                : state.selected.filter.func;
              actions.filterImageAsync(inputCanvasRef.current, filterFunc, state.selected.filter.options);
            }}
          >
            Filter
          </button>

          <button
            style={{ marginLeft: "auto" }}
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

          <CollapsibleSection title="Video">
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
              <label className={controls.label} htmlFor="realtimeFiltering">
                <input
                  id="realtimeFiltering"
                  type="checkbox"
                  onChange={e => actions.setRealtimeFiltering(e.target.checked)}
                  checked={state.realtimeFiltering}
                />
                Realtime filtering (videos)
              </label>
            </div>
            <div>
              <Range
                name="Video Playback Rate"
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
              <div className={controls.unselectable}>Audio capture requires Chrome</div>
            </div>

            <CollapsibleSection title="Others">
              <Enum
                name="Scaling algorithm"
                onSetFilterOption={(_, algorithm) => actions.setScalingAlgorithm(algorithm)}
                value={state.scalingAlgorithm}
                types={SCALING_ALGORITHM_OPTIONS}
              />
              <Range
                name="Output Scale"
                types={{ range: [0.1, 4] }}
                step={0.1}
                onSetFilterOption={(_, value) => actions.setOutputScale(value)}
                value={state.outputScale}
              />
            </CollapsibleSection>
          </CollapsibleSection>
        </CollapsibleSection>

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
          onDragOver={e => { e.preventDefault(); setCanvasDropping(true); }}
          onDragLeave={() => setCanvasDropping(false)}
          onDrop={e => {
            e.preventDefault();
            setCanvasDropping(false);
            const file = e.dataTransfer.files[0];
            if (file) actions.loadMediaAsync(file, state.videoVolume, state.videoPlaybackRate);
          }}
        >
          <div className={[controls.window, s.inputWindow, canvasDropping ? s.dropping : ""].join(" ")}>
            <div className={["handle", controls.titleBar].join(" ")}>Input</div>
            <div className={s.canvasArea}>
              {(!state.inputImage || canvasDropping) && (
                <div className={s.dropPlaceholder}>
                  <span>{canvasDropping ? "Drop to load" : "Drop image or video here"}</span>
                </div>
              )}
              <canvas
                className={[s.canvas, s[state.scalingAlgorithm]].join(" ")}
                ref={inputCanvasRef}
              />
            </div>
          </div>
        </div>

        <div ref={outputDragRef} role="presentation" onMouseDown={outputDrag.onMouseDown} onMouseDownCapture={bringToTop}>
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
