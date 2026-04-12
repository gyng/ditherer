import type { ArrayBufferTarget, Muxer } from "webm-muxer";

const TARGET_AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_CHUNK_FRAMES = 960;

type SourceVideoWithObjectUrl = HTMLVideoElement & { __objectUrl?: string };

type AudioMuxer = Muxer<ArrayBufferTarget> & {
  addAudioChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void;
};

export type PreparedOfflineAudioTrack = {
  numberOfChannels: number;
  sampleRate: number;
  totalFrames: number;
  encodeInto: (
    muxer: AudioMuxer,
    onProgress?: (message: string) => void,
    isAborted?: () => boolean,
  ) => Promise<void>;
};

export const reconcileAudioFrameCount = (sourceFrames: number, targetFrames: number) => {
  if (!Number.isFinite(sourceFrames) || sourceFrames < 0) {
    return Math.max(0, targetFrames);
  }
  return Math.max(0, targetFrames);
};

const fetchVideoBytes = async (video: HTMLVideoElement): Promise<ArrayBuffer> => {
  const source = (video as SourceVideoWithObjectUrl).__objectUrl || video.currentSrc || video.src;
  if (!source) {
    throw new Error("Reliable audio export requires a readable video source.");
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to read source media for audio export (${response.status}).`);
  }

  return response.arrayBuffer();
};

const createDecodeContext = () => {
  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("This browser does not support AudioContext decoding.");
  }
  return new AudioContextCtor({ sampleRate: TARGET_AUDIO_SAMPLE_RATE });
};

const resampleAudioBuffer = async (buffer: AudioBuffer, sampleRate: number) => {
  if (buffer.sampleRate === sampleRate) return buffer;

  const frameCount = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const offlineContext = new OfflineAudioContext(buffer.numberOfChannels, frameCount, sampleRate);
  const source = offlineContext.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineContext.destination);
  source.start(0);
  return offlineContext.startRendering();
};

const extractPlanarChunk = (
  audioBuffer: AudioBuffer,
  startFrame: number,
  chunkFrames: number,
  channelCount: number,
): Float32Array => {
  const planar = new Float32Array(channelCount * chunkFrames);
  const availableFrames = Math.max(0, Math.min(chunkFrames, audioBuffer.length - startFrame));

  for (let channel = 0; channel < channelCount; channel += 1) {
    const sourceChannel = audioBuffer.getChannelData(Math.min(channel, audioBuffer.numberOfChannels - 1));
    const slice = sourceChannel.subarray(startFrame, startFrame + availableFrames);
    planar.set(slice, channel * chunkFrames);
  }

  return planar;
};

export const prepareOfflineAudioTrack = async (
  video: HTMLVideoElement,
  durationUs: number,
): Promise<PreparedOfflineAudioTrack | null> => {
  const bytes = await fetchVideoBytes(video);
  const decodeContext = createDecodeContext();

  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(bytes.slice(0));
  } catch {
    await decodeContext.close().catch(() => {});
    return null;
  }
  await decodeContext.close().catch(() => {});

  if (!decoded.numberOfChannels || !decoded.length || !decoded.duration) {
    return null;
  }

  const resampled = await resampleAudioBuffer(decoded, TARGET_AUDIO_SAMPLE_RATE);
  const numberOfChannels = Math.max(1, Math.min(2, resampled.numberOfChannels));
  const targetFrames = Math.max(1, Math.round((durationUs / 1_000_000) * TARGET_AUDIO_SAMPLE_RATE));
  const totalFrames = reconcileAudioFrameCount(resampled.length, targetFrames);

  const support = await AudioEncoder.isConfigSupported({
    codec: "opus",
    numberOfChannels,
    sampleRate: TARGET_AUDIO_SAMPLE_RATE,
    bitrate: numberOfChannels === 1 ? 96_000 : 128_000,
  });

  if (!support.supported) {
    throw new Error("This browser cannot encode Opus audio for reliable video export.");
  }

  return {
    numberOfChannels,
    sampleRate: TARGET_AUDIO_SAMPLE_RATE,
    totalFrames,
    encodeInto: async (muxer, onProgress, isAborted) => {
      const bitrate = numberOfChannels === 1 ? 96_000 : 128_000;

      const encoder = new AudioEncoder({
        output: (chunk, meta) => {
          muxer.addAudioChunk(chunk, meta);
        },
        error: (error) => {
          throw error;
        },
      });

      encoder.configure({
        codec: "opus",
        numberOfChannels,
        sampleRate: TARGET_AUDIO_SAMPLE_RATE,
        bitrate,
      });

      try {
        for (let startFrame = 0; startFrame < totalFrames; startFrame += AUDIO_CHUNK_FRAMES) {
          if (isAborted?.()) {
            break;
          }

          const chunkFrames = Math.min(AUDIO_CHUNK_FRAMES, totalFrames - startFrame);
          onProgress?.(`Encoding audio ${(Math.floor(startFrame / AUDIO_CHUNK_FRAMES)) + 1}/${Math.ceil(totalFrames / AUDIO_CHUNK_FRAMES)}`);

          const planar = extractPlanarChunk(resampled, startFrame, chunkFrames, numberOfChannels);
          const audioData = new AudioData({
            format: "f32-planar",
            sampleRate: TARGET_AUDIO_SAMPLE_RATE,
            numberOfFrames: chunkFrames,
            numberOfChannels,
            timestamp: Math.round((startFrame / TARGET_AUDIO_SAMPLE_RATE) * 1_000_000),
            data: new Float32Array(planar),
          });

          encoder.encode(audioData);
          audioData.close();
        }

        await encoder.flush();
      } finally {
        encoder.close();
      }
    },
  };
};
