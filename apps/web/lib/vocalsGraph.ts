// Routes the vocals element through one shared AudioContext and GainNode, since media volume is read only on iOS.
const GAIN_SMOOTHING_SECONDS = 0.03;

type AudioContextClass = typeof AudioContext;

function audioContextClass(): AudioContextClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

class VocalsGraph {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private readonly sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private connected: MediaElementAudioSourceNode | null = null;
  private gain = 0;

  private ensureContext(): boolean {
    if (this.ctx) return true;
    const Ctx = audioContextClass();
    if (!Ctx) return false;
    this.ctx = new Ctx();
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this.gain;
    this.gainNode.connect(this.ctx.destination);
    return true;
  }

  private sourceFor(ctx: AudioContext, el: HTMLMediaElement): MediaElementAudioSourceNode {
    const existing = this.sources.get(el);
    if (existing) return existing;
    const created = ctx.createMediaElementSource(el);
    this.sources.set(el, created);
    return created;
  }

  attach(el: HTMLMediaElement): boolean {
    if (!this.ensureContext() || !this.ctx || !this.gainNode) return false;
    const source = this.sourceFor(this.ctx, el);
    if (this.connected === source) return true;
    this.connected?.disconnect();
    source.connect(this.gainNode);
    this.connected = source;
    return true;
  }

  detach(el: HTMLMediaElement): void {
    if (!this.connected || this.sources.get(el) !== this.connected) return;
    this.connected.disconnect();
    this.connected = null;
  }

  setGain(gain: number): void {
    this.gain = gain;
    if (!this.ctx || !this.gainNode) return;
    this.gainNode.gain.setTargetAtTime(gain, this.ctx.currentTime, GAIN_SMOOTHING_SECONDS);
  }

  resume(): void {
    if (!this.ensureContext() || !this.ctx || this.ctx.state === "running") return;
    void this.ctx.resume().catch(() => undefined);
  }

  isRunning(): boolean {
    return this.ctx?.state === "running";
  }
}

export const vocalsGraph = new VocalsGraph();
