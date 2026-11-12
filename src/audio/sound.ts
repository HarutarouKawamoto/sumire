/**
 * Web Audio API によるシンセサイズ打鍵サウンドエンジン
 *
 * 特徴：
 * - 外部の .mp3 / .wav ファイルを一切使用せず、完全にローカルの波形合成のみで
 *   落ち着いたメカニカルキーボード風のアコースティック打鍵音を生成する。
 * - ゲームっぽ い派手なピコピコ音ではなく、思考を邪魔しない「コトッ」「カタッ」という質感。
 */

import { KeyActionResult } from '../core/session';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * 打鍵結果に応じたサウンドを鳴らす
   */
  public playForAction(action: KeyActionResult): void {
    if (!this.enabled) return;

    switch (action) {
      case 'correct':
        this.playMechanicalClick(850, 0.035, 0.08);
        break;
      case 'backspace':
        this.playMechanicalClick(620, 0.035, 0.07);
        break;
      case 'line_advance':
        // Enter 改行時は少し深みのあるタクタイル音
        this.playMechanicalClick(520, 0.055, 0.11);
        break;
      case 'typo':
      case 'blocked_enter':
        // タイプミス時は耳障りにならない低く短い「コツッ」という鈍い警告音
        this.playThud(190, 0.08, 0.12);
        break;
      case 'completed':
        this.playChime();
        break;
      default:
        break;
    }
  }

  /**
   * 落ち着いたメカニカルスイッチ風のクリック音（ノイズバースト＋減衰サイン波）
   */
  private playMechanicalClick(freq: number, duration: number, volume: number): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. 短く柔らかいトーン成分（スイッチの底打ち感）
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    // わずかなランダム揺らぎを加えて機械的な単調さを消す
    const jitter = 0.96 + Math.random() * 0.08;
    osc.frequency.setValueAtTime(freq * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + duration);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * ミスタイプ時の低く短い打撃音
   */
  private playThud(freq: number, duration: number, volume: number): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + duration);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * 1ファイル写経完了時の静かな和音
   */
  private playChime(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.45);
    });
  }
}
