// Plays the instrumental and vocals stems as buffer sources on one context clock, so they stay sample aligned.
import {
  clockPosition,
  isRunning,
  nextFrameTime,
  pauseClock,
  pausedClock,
  seekClock,
  snapToFrame,
  startClock,
  type StemClock,
} from "./stemClock";

export const START_LEAD_SECONDS = 0.05;
const GAIN_SMOOTHING_SECONDS = 0.03;

function createGain(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  node.connect(ctx.destination);
  return node;
}

function stopSource(source: AudioBufferSourceNode | null): void {
  if (!source) return;
  source.onended = null;
  source.stop();
  source.disconnect();
}

export class StemPlayer {
  private clock: StemClock = pausedClock(0);
  private instrumental: AudioBuffer | null = null;
  private vocals: AudioBuffer | null = null;
  private instrumentalSource: AudioBufferSourceNode | null = null;
  private vocalsSource: AudioBufferSourceNode | null = null;
  private readonly instrumentalGain: GainNode;
  private readonly vocalsGain: GainNode;
  private ended = false;
  onEnded: (() => void) | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    vocalsGain = 0,
  ) {
    this.instrumentalGain = createGain(ctx, 1);
    this.vocalsGain = createGain(ctx, vocalsGain);
  }

  load(instrumental: AudioBuffer): void {
    this.unload();
    this.instrumental = instrumental;
    this.clock = pausedClock(instrumental.duration);
  }

  addVocals(vocals: AudioBuffer): void {
    this.vocals = vocals;
    if (!this.isPlaying() || this.vocalsSource) return;
    const when = this.startTime();
    this.vocalsSource = this.startStem(vocals, this.vocalsGain, when, clockPosition(this.clock, when));
  }

  unload(): void {
    this.stopSources();
    this.instrumental = null;
    this.vocals = null;
    this.clock = pausedClock(0);
    this.ended = false;
  }

  isLoaded(): boolean {
    return this.instrumental !== null;
  }

  isPlaying(): boolean {
    return isRunning(this.clock);
  }

  hasEnded(): boolean {
    return this.ended;
  }

  position(): number {
    return clockPosition(this.clock, this.ctx.currentTime);
  }

  play(): boolean {
    if (!this.instrumental || this.ended) return false;
    if (this.isPlaying()) return true;
    const when = this.startTime();
    this.clock = startClock(this.clock, when);
    this.startSources(when);
    return true;
  }

  pause(): void {
    if (!this.isPlaying()) return;
    this.stopSources();
    this.clock = pauseClock(this.clock, this.ctx.currentTime);
  }

  seek(seconds: number): void {
    if (!this.instrumental) return;
    const wasPlaying = this.isPlaying();
    this.stopSources();
    this.ended = false;
    const when = this.startTime();
    this.clock = seekClock(this.clock, snapToFrame(seconds, this.ctx.sampleRate), when);
    if (wasPlaying) this.startSources(when);
  }

  setVocalsGain(gain: number): void {
    this.vocalsGain.gain.setTargetAtTime(gain, this.ctx.currentTime, GAIN_SMOOTHING_SECONDS);
  }

  dispose(): void {
    this.onEnded = null;
    this.unload();
    this.instrumentalGain.disconnect();
    this.vocalsGain.disconnect();
  }

  private startTime(): number {
    return nextFrameTime(this.ctx.currentTime + START_LEAD_SECONDS, this.ctx.sampleRate);
  }

  private startSources(when: number): void {
    if (!this.instrumental) return;
    const offset = clockPosition(this.clock, when);
    this.instrumentalSource = this.startStem(this.instrumental, this.instrumentalGain, when, offset);
    this.instrumentalSource.onended = () => this.finish();
    if (this.vocals) this.vocalsSource = this.startStem(this.vocals, this.vocalsGain, when, offset);
  }

  private startStem(buffer: AudioBuffer, output: GainNode, when: number, offset: number): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    source.start(when, snapToFrame(offset, this.ctx.sampleRate));
    return source;
  }

  private stopSources(): void {
    stopSource(this.instrumentalSource);
    stopSource(this.vocalsSource);
    this.instrumentalSource = null;
    this.vocalsSource = null;
  }

  private finish(): void {
    this.stopSources();
    this.clock = pausedClock(this.clock.durationSeconds, this.clock.durationSeconds);
    this.ended = true;
    this.onEnded?.();
  }
}

export async function fetchStem(ctx: BaseAudioContext, url: string, signal: AbortSignal): Promise<AudioBuffer> {
  const res = await fetch(url, { credentials: "include", signal });
  if (!res.ok) throw new Error(`stem request failed with ${res.status}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

type AudioContextClass = typeof AudioContext;

function audioContextClass(): AudioContextClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let shared: AudioContext | null = null;

export function sharedAudioContext(): AudioContext | null {
  if (shared) return shared;
  const Ctx = audioContextClass();
  shared = Ctx ? new Ctx() : null;
  return shared;
}
