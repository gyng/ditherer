/* eslint-disable jsx-a11y/media-has-caption */
import React from "react";

export interface VideoRecorderProps {
  captureAudio: boolean;
  srcCanvas?: HTMLCanvasElement | null;
  srcVideo?: HTMLVideoElement | null;
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

  private stopCb: any;

  private startCapture(
    srcCanvas: HTMLCanvasElement,
    dstVideo: HTMLVideoElement,
    frameRate?: number,
    srcVideo?: HTMLVideoElement | null
  ) {
    // Getting video FPS is hard
    // https://wiki.whatwg.org/wiki/Video_Metrics#presentedFrames
    const _frameRate = frameRate ?? 25;

    // @ts-ignore
    let srcStream: MediaStream = srcCanvas.captureStream(frameRate);
    console.log("os", srcStream);

    console.log(srcVideo);

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

    console.log("vs", vidStream);

    // mux audio
    let muxedStream: MediaStream | null = null;
    if (srcStream && vidStream && this.props.captureAudio) {
      const newVideoTracks = srcStream.getVideoTracks().map((t) => t.clone());
      const newAudioTracks = vidStream.getAudioTracks().map((t) => t.clone());
      // Have to use new MediaStream to get audio capture to work in FF
      // instead of using addTrack
      muxedStream = new MediaStream([...newVideoTracks, ...newAudioTracks]);
    } else {
      muxedStream = srcStream;
    }

    dstVideo.srcObject = muxedStream;
    const mediaRecorder = new MediaRecorder(muxedStream);
    let chunks: Blob[] = [];
    mediaRecorder.start();
    dstVideo.play();
    mediaRecorder.ondataavailable = (e) => {
      chunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
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
      mediaRecorder.stop();
    };
    return stop;
  }

  render() {
    return (
      <div>
        <button
          onClick={() => {
            if (
              !this.state.capturing &&
              this.outputVideo.current &&
              this.props.srcCanvas
            ) {
              this.stopCb = this.startCapture(
                this.props.srcCanvas,
                this.outputVideo.current,
                25,
                this.props.srcVideo
              );
              this.setState({ capturing: true });
            } else {
              this.stopCb?.();
              this.setState({ capturing: false });
            }
          }}
        >{`${this.state.capturing ? "stop" : "start"} capture`}</button>
        <video
          title={`ditherer-capture-${new Date().toISOString()}.webm`}
          controls
          ref={this.outputVideo}
        ></video>
      </div>
    );
  }
}
