export interface AudioControllerOptions {
  onTimeUpdate?: (seconds: number) => void;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onError?: (err: Event) => void;
}

export class AudioController {
  private el: HTMLAudioElement | null = null;
  private opts: AudioControllerOptions;

  constructor(opts: AudioControllerOptions = {}) {
    this.opts = opts;
  }

  attach(el: HTMLAudioElement): void {
    this.detach();
    this.el = el;
    el.addEventListener("timeupdate", this.handleTimeUpdate);
    el.addEventListener("ended", this.handleEnded);
    el.addEventListener("play", this.handlePlay);
    el.addEventListener("pause", this.handlePause);
    el.addEventListener("error", this.handleError);
  }

  detach(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener("timeupdate", this.handleTimeUpdate);
    el.removeEventListener("ended", this.handleEnded);
    el.removeEventListener("play", this.handlePlay);
    el.removeEventListener("pause", this.handlePause);
    el.removeEventListener("error", this.handleError);
    this.el = null;
  }

  async play(): Promise<void> {
    await this.el?.play();
  }

  pause(): void {
    this.el?.pause();
  }

  seek(seconds: number): void {
    if (this.el) this.el.currentTime = seconds;
  }

  get currentTime(): number {
    return this.el?.currentTime ?? 0;
  }

  get duration(): number {
    return this.el?.duration ?? 0;
  }

  private handleTimeUpdate = () => {
    this.opts.onTimeUpdate?.(this.el?.currentTime ?? 0);
  };
  private handleEnded = () => {
    this.opts.onEnded?.();
  };
  private handlePlay = () => {
    this.opts.onPlay?.();
  };
  private handlePause = () => {
    this.opts.onPause?.();
  };
  private handleError = (evt: Event) => {
    this.opts.onError?.(evt);
  };
}
