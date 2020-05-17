/* eslint-disable jsx-a11y/media-has-caption */
import React from "react";
import classNames from "classnames";

const styles = require("./videorecorder.pcss");

interface CaptureOptions extends MediaRecorderOptions {
  ext: string;
  weight: number;
  framerate?: number;
  once?: {
    start: number;
    end: number;
  };
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
  framerate: 25,
  weight: 3,
};

// TODO: Should vary bitrate according to size (doesn't seem to work on chrome at least)
// export const getBestCaptureOption = (bitsPerSecond = 2500000 + 128000) => {
export const getBestCaptureOption = () =>
  getSupportedMimeTypes().sort((a, b) => b.weight - a.weight)[0] ??
  defaultCaptureOptions;

export interface VideoRecorderProps {
  captureAudio: boolean;
  srcVideo?: HTMLCanvasElement | HTMLMediaElement | null;
  srcAudio?: HTMLMediaElement | null;
  srcVideoRef?:
    | React.RefObject<HTMLMediaElement>
    | React.RefObject<HTMLCanvasElement>;
  srcAudioRef?: React.RefObject<HTMLMediaElement>;
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
    srcVideo: HTMLMediaElement | HTMLCanvasElement,
    dstVideo: HTMLVideoElement,
    captureOptions: CaptureOptions,
    srcAudio?: HTMLMediaElement | null,
    bitsPerSecond?: number
  ) {
    // Getting video FPS is hard
    // https://wiki.whatwg.org/wiki/Video_Metrics#presentedFrames
    const framerate = captureOptions.framerate ?? 25;

    // @ts-ignore
    let srcVideoStream: MediaStream | null = null;
    let srcAudioStream: MediaStream | null = null;

    if (srcAudio) {
      if ("captureStream" in srcAudio) {
        // @ts-ignore
        srcAudioStream = srcAudio.captureStream(framerate);
      } else if ("mozCaptureStream" in srcAudio) {
        // @ts-ignore
        srcAudioStream = srcAudio.mozCaptureStream(framerate);
      }
    }

    if (srcVideo) {
      if ("captureStream" in srcVideo) {
        // @ts-ignore
        srcVideoStream = srcVideo.captureStream(framerate);
      } else if ("mozCaptureStream" in srcVideo) {
        // @ts-ignore
        srcVideoStream = srcVideo.mozCaptureStream(framerate);
      }
    }

    if (srcVideoStream === null) {
      console.warn("cannot get capture stream");
      return () => {
        /* noop */
      };
    }

    // mux audio from original video into captured video, if it has audio tracks
    let muxedStream: MediaStream;
    if (
      srcVideoStream &&
      srcAudioStream &&
      this.props.captureAudio &&
      srcAudioStream.getAudioTracks().length > 0
    ) {
      const newVideoTracks = srcVideoStream
        .getVideoTracks()
        .map((t) => t.clone());
      const newAudioTracks = srcAudioStream
        .getAudioTracks()
        .map((t) => t.clone());
      // Have to use new MediaStream to get audio capture to work in FF
      // instead of using addTrack
      muxedStream = new MediaStream([...newVideoTracks, ...newAudioTracks]);
    } else {
      muxedStream = srcVideoStream;
    }

    dstVideo.src = "";
    dstVideo.srcObject = muxedStream;
    const mediaRecorder = new MediaRecorder(muxedStream, {
      mimeType: captureOptions.mimeType,
      bitsPerSecond: bitsPerSecond,
    });
    let chunks: Blob[] = [];

    const stop = () => {
      if (muxedStream) {
        // Firefox completely loses the audio from srcStream at this point?
        // Maybe not necessary
        muxedStream.getTracks().forEach((track) => {
          track.stop();
          muxedStream.removeTrack(track);
        });
      }
      mediaRecorder.stop();
    };

    // Support capture of a timerange
    if ("currentTime" in srcVideo && captureOptions.once) {
      const { start, end } = captureOptions.once;
      srcVideo.currentTime = start;

      if (srcAudio) {
        srcAudio.currentTime = start;
      }

      let maxTime = start;
      let updateCount = 0;

      const onTimeUpdate = (ev: any) => {
        maxTime = Math.max(maxTime, ev.currentTarget.currentTime);

        if (
          ev.currentTarget.currentTime < maxTime || // looped
          ev.currentTarget.currentTime >= end || // exceeded
          (ev.currentTarget.currentTime === start && updateCount > 0) // too short to detect
        ) {
          stop();
          ev.currentTarget.removeEventListener("timeupdate", onTimeUpdate);
          this.setState({ capturing: false });
        }

        updateCount += 1;
      };

      srcVideo.addEventListener("timeupdate", onTimeUpdate);
    }

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

    return stop;
  }

  public render() {
    return (
      <div className={styles.recorder}>
        {JSON.stringify(this.props.captureOptions)}

        <button
          onClick={() => {
            const captureOptions =
              this.props.captureOptions ?? defaultCaptureOptions;
            const srcVidEl =
              this.props.srcVideoRef?.current ?? this.props.srcVideo;
            const srcAudEl =
              this.props.srcAudioRef?.current ?? this.props.srcAudio;

            if (!this.state.capturing && this.outputVideo.current && srcVidEl) {
              this.stopCb = this.startCapture(
                srcVidEl,
                this.outputVideo.current,
                captureOptions,
                srcAudEl
              );
              this.setState({ capturing: true });
            } else {
              this.stopCb();
              this.setState({ capturing: false });
            }
          }}
        >{`${this.state.capturing ? "stop" : "start"} capture`}</button>
        <video
          className={classNames(styles.outputVideo, {
            [styles.active]: this.state.capturing,
          })}
          title={`ditherer-capture-${new Date().toISOString()}.${
            this.props.captureOptions?.ext ?? defaultCaptureOptions.ext
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
