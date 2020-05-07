/* eslint-disable jsx-a11y/media-has-caption */
import React from "react";

interface CaptureOptions extends MediaRecorderOptions {
  ext: string;
  weight: number;
}

// https://source.chromium.org/chromium/chromium/src/+/master:third_party/blink/web_tests/fast/mediarecorder/MediaRecorder-isTypeSupported.html?q=MediaRecorder-isTypeSupported&ss=chromium&originalUrl=https:%2F%2Fcs.chromium.org%2Fchromium%2Fsrc%2Fthird_party%2Fblink%2Fweb_tests%2Ffast%2Fmediarecorder%2FMediaRecorder-isTypeSupported.html
// https://stackoverflow.com/questions/41739837/all-mime-types-supported-by-mediarecorder-in-firefox-and-chrome
export const getSupportedMimeTypes = (): CaptureOptions[] => {
  const mimesToTry = [
    { mimeType: "video/webm;codecs=daala", ext: "webm", weight: 0 },
    { mimeType: "video/mpeg4", ext: "mp4", weight: 1 },
    { mimeType: "video/mp4", ext: "mp4", weight: 1 },
    { mimeType: "video/webm", ext: "webm", weight: 3 },
    { mimeType: "video/webm;codecs=avc1", ext: "webm", weight: 70 },
    { mimeType: "video/webm;codecs=h264,opus", ext: "webm", weight: 80 },
    { mimeType: "video/webm;codecs=vp8", ext: "webm", weight: 90 },
    { mimeType: "video/webm;codecs=vp8.0", ext: "webm", weight: 90 },
    { mimeType: "video/webm;codecs=vp8,opus", ext: "webm", weight: 91 },
    { mimeType: "video/webm;codecs=vp8,pcm", ext: "webm", weight: 0 },
    { mimeType: "video/webm;codecs=vp9", ext: "webm", weight: 100 },
    { mimeType: "video/webm;codecs=vp9.0", ext: "webm", weight: 100 },
    { mimeType: "video/webm;codecs=vp9,opus", ext: "webm", weight: 101 },
    { mimeType: "video/webm;codecs=vp8,vp9,opus", ext: "webm", weight: 0 },
    // "audio/ogg",
    // "audio/webm;codecs=vorbis",
    // "audio/webm",
    // "audio/webm;codecs=opus",
    // "audio/webm;codecs=pcm",
  ];

  return mimesToTry.filter((m) => MediaRecorder.isTypeSupported(m.mimeType));
};

const defaultCaptureOptions: CaptureOptions = {
  mimeType: "video/webm",
  ext: "webm",
  weight: 3,
};

// TODO: Should vary bitrate according to size (doesn't seem to work on chrome at least)
// export const getBestCaptureOption = (bitsPerSecond = 2500000 + 128000) => {
export const getBestCaptureOption = () =>
  getSupportedMimeTypes().sort((a, b) => b.weight - a.weight)[0] ??
  defaultCaptureOptions;

export interface VideoRecorderProps {
  captureAudio: boolean;
  srcCanvas?: HTMLCanvasElement | null;
  srcVideo?: HTMLVideoElement | null;
  captureOptions: CaptureOptions;
}

interface VideoRecorderState {
  capturing: boolean;
}

export class VideoRecorder extends React.Component<
  VideoRecorderProps,
  VideoRecorderState
> {
  private outputVideo = React.createRef<HTMLVideoElement>();

  constructor(props: VideoRecorderProps) {
    super(props);
    this.state = { capturing: false };
  }

  private stopCb: () => void = () => {
    /* noop by default*/
  };

  private startCapture(
    srcCanvas: HTMLCanvasElement,
    dstVideo: HTMLVideoElement,
    captureOptions: CaptureOptions,
    frameRate?: number,
    srcVideo?: HTMLVideoElement | null,
    bitsPerSecond?: number
  ) {
    // Getting video FPS is hard
    // https://wiki.whatwg.org/wiki/Video_Metrics#presentedFrames
    const _frameRate = frameRate ?? 25;

    // @ts-ignore
    const srcStream: MediaStream = srcCanvas.captureStream(frameRate);
    let vidStream: MediaStream | null = null;
    // @ts-ignore
    if (srcVideo.captureStream) {
      // @ts-ignore
      vidStream = srcVideo.captureStream(_frameRate);
      // @ts-ignore
    } else if (srcVideo.mozCaptureStream) {
      // @ts-ignore
      vidStream = srcVideo.mozCaptureStream(_frameRate);
    }

    // mux audio from original video into captured video, if it has audio tracks
    let muxedStream: MediaStream | null = null;
    if (
      srcStream &&
      vidStream &&
      this.props.captureAudio &&
      vidStream.getAudioTracks().length > 0
    ) {
      const newVideoTracks = srcStream.getVideoTracks().map((t) => t.clone());
      const newAudioTracks = vidStream.getAudioTracks().map((t) => t.clone());
      // Have to use new MediaStream to get audio capture to work in FF
      // instead of using addTrack
      muxedStream = new MediaStream([...newVideoTracks, ...newAudioTracks]);
    } else {
      muxedStream = srcStream;
    }

    dstVideo.srcObject = muxedStream;
    const mediaRecorder = new MediaRecorder(muxedStream, {
      mimeType: captureOptions.mimeType,
      bitsPerSecond: bitsPerSecond,
    });
    let chunks: Blob[] = [];
    // autoplay of output video controlled by HTML attributes
    mediaRecorder.start();
    mediaRecorder.ondataavailable = (e) => {
      chunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: captureOptions.mimeType });
      chunks = [];
      const dataUrl = URL.createObjectURL(blob);
      dstVideo.srcObject = null;
      dstVideo.src = dataUrl;
    };

    // todo: remove me
    const stop = () => {
      if (muxedStream) {
        // Firefox completely loses the audio from srcStream at this point
        // Maybe not necessary
        muxedStream.getTracks().forEach((track) => track.stop());
      }

      console.log(mediaRecorder.videoBitsPerSecond);
      mediaRecorder.stop();
    };
    return stop;
  }

  render() {
    const captureOptions = this.props.captureOptions ?? defaultCaptureOptions;

    return (
      <div>
        <button
          onClick={() => {
            console.log(captureOptions);

            if (
              !this.state.capturing &&
              this.outputVideo.current &&
              this.props.srcCanvas
            ) {
              this.stopCb = this.startCapture(
                this.props.srcCanvas,
                this.outputVideo.current,
                captureOptions,
                25,
                this.props.srcVideo
              );
              this.setState({ capturing: true });
            } else {
              this.stopCb();
              this.setState({ capturing: false });
            }
          }}
        >{`${this.state.capturing ? "stop" : "start"} capture`}</button>
        <video
          title={`ditherer-capture-${new Date().toISOString()}.${
            captureOptions.ext
          }`}
          controls
          loop
          autoPlay
          ref={this.outputVideo}
        ></video>
      </div>
    );
  }
}
