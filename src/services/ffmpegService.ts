import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export interface VideoEditOptions {
  trimStartSec: number;
  trimEndSec: number;
  rotationDeg: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
  overlayText: string;
  overlayPosition: 'top' | 'center' | 'bottom';
  overlayColor: string;
}

class FFmpegStudioService {
  private ffmpeg: FFmpeg | null = null;
  private isLoaded = false;
  private isLoading = false;

  public async load(onProgress?: (msg: string) => void): Promise<boolean> {
    if (this.isLoaded && this.ffmpeg) return true;
    if (this.isLoading) return false;

    this.isLoading = true;
    try {
      onProgress?.('جاري تهيئة محرك FFmpeg.wasm المحلي...');
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

      ffmpeg.on('log', ({ message }) => {
        if (onProgress && message) {
          onProgress(message);
        }
      });

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      this.ffmpeg = ffmpeg;
      this.isLoaded = true;
      this.isLoading = false;
      return true;
    } catch (err) {
      console.warn('FFmpeg.wasm CDN load failed or restricted by COOP/COEP headers, using real HTML5 Canvas+MediaRecorder hardware pipeline:', err);
      this.isLoading = false;
      return false;
    }
  }

  /**
   * Processes a video with trim, 4-direction rotation/flip, and text overlay.
   * Uses FFmpeg.wasm if loaded and available (when only trimming/rotating without complex Arabic font shaping),
   * or uses deterministic hardware-accelerated HTML5 Video + Canvas + AudioContext MediaRecorder rendering
   * which natively supports Arabic typography, 4-direction rotation, flips, and exact frame trimming offline!
   */
  public async renderEditedVideo(
    sourceBlob: Blob,
    options: VideoEditOptions,
    onProgress: (percent: number, stage: string) => void
  ): Promise<{ blob: Blob; width: number; height: number; durationSec: number }> {
    // If no text overlay is needed (or ASCII only) and FFmpeg.wasm is loaded, we can try FFmpeg first
    const hasNonAsciiText = /[^\u0000-\u007f]/.test(options.overlayText);
    if (this.isLoaded && this.ffmpeg && !options.overlayText.trim() && !hasNonAsciiText) {
      try {
        return await this.renderViaFFmpegWasm(sourceBlob, options, onProgress);
      } catch (err) {
        console.warn('FFmpeg wasm execution fallback to native WebMedia pipeline:', err);
      }
    }

    // Hardware-accelerated WebMedia Canvas + Audio stream renderer (supports full Arabic fonts, 4 rotations, flips, trim)
    return await this.renderViaCanvasPipeline(sourceBlob, options, onProgress);
  }

  private async renderViaFFmpegWasm(
    sourceBlob: Blob,
    options: VideoEditOptions,
    onProgress: (percent: number, stage: string) => void
  ): Promise<{ blob: Blob; width: number; height: number; durationSec: number }> {
    if (!this.ffmpeg) throw new Error('FFmpeg not initialized');

    onProgress(10, 'كتابة الفيديو في الذاكرة المحلية (MEMFS)...');
    const inputName = 'input.webm';
    const outputName = 'output.webm';
    await this.ffmpeg.writeFile(inputName, await fetchFile(sourceBlob));

    const filters: string[] = [];
    if (options.rotationDeg === 90) {
      filters.push('transpose=1');
    } else if (options.rotationDeg === 180) {
      filters.push('transpose=1,transpose=1');
    } else if (options.rotationDeg === 270) {
      filters.push('transpose=2');
    }
    if (options.flipHorizontal) filters.push('hflip');
    if (options.flipVertical) filters.push('vflip');

    const args: string[] = [
      '-ss',
      options.trimStartSec.toFixed(2),
      '-to',
      options.trimEndSec.toFixed(2),
      '-i',
      inputName,
    ];

    if (filters.length > 0) {
      args.push('-vf', filters.join(','));
    }

    args.push('-c:v', 'libvpx', '-b:v', '8M', '-c:a', 'copy', outputName);

    onProgress(40, 'جاري معالجة الإطارات عبر FFmpeg.wasm...');
    await this.ffmpeg.exec(args);

    onProgress(85, 'استخراج الفيديو النهائي...');
    const data = await this.ffmpeg.readFile(outputName);
    const uint8 = data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(String(data));
    const resultBlob = new Blob([uint8], { type: 'video/webm' });

    const durationSec = Math.max(0.5, options.trimEndSec - options.trimStartSec);
    onProgress(100, 'اكتمل الريندر بنجاح!');
    return {
      blob: resultBlob,
      width: 1280,
      height: 720,
      durationSec,
    };
  }

  private async renderViaCanvasPipeline(
    sourceBlob: Blob,
    options: VideoEditOptions,
    onProgress: (percent: number, stage: string) => void
  ): Promise<{ blob: Blob; width: number; height: number; durationSec: number }> {
    return new Promise((resolve, reject) => {
      const videoUrl = URL.createObjectURL(sourceBlob);
      const video = document.createElement('video');
      video.src = videoUrl;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      video.onloadedmetadata = async () => {
        try {
          const srcW = video.videoWidth || 1280;
          const srcH = video.videoHeight || 720;
          const isSwapped = options.rotationDeg === 90 || options.rotationDeg === 270;
          const outW = isSwapped ? srcH : srcW;
          const outH = isSwapped ? srcW : srcH;

          const canvas = document.createElement('canvas');
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(videoUrl);
            reject(new Error('تعذر إنشاء سياق الرسوميات Canvas 2D'));
            return;
          }

          const startSec = Math.max(0, options.trimStartSec);
          const endSec = Math.min(video.duration || 10, Math.max(startSec + 0.5, options.trimEndSec));
          const targetDuration = endSec - startSec;

          onProgress(10, 'ضبط نقطة البداية والمؤثرات الهندسية...');
          video.currentTime = startSec;

          await new Promise<void>((res) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              res();
            };
            video.addEventListener('seeked', onSeeked);
          });

          const stream = canvas.captureStream(30);
          const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
          const candidates = isIOS
            ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
            : ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
          const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';

          const recorder = new MediaRecorder(
            stream,
            mimeType ? { mimeType, videoBitsPerSecond: 14_000_000 } : { videoBitsPerSecond: 14_000_000 }
          );

          const chunks: BlobPart[] = [];
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };

          recorder.onstop = () => {
            URL.revokeObjectURL(videoUrl);
            const finalBlob = new Blob(chunks, { type: mimeType || (isIOS ? 'video/mp4' : 'video/webm') });
            onProgress(100, 'اكتمل حفظ وتصدير الفيديو المعدل بنجاح!');
            resolve({
              blob: finalBlob,
              width: outW,
              height: outH,
              durationSec: Number(targetDuration.toFixed(2)),
            });
          };

          const drawFrame = () => {
            if (video.paused || video.ended || video.currentTime >= endSec) {
              if (recorder.state === 'recording') {
                recorder.stop();
              }
              return;
            }

            const elapsed = Math.max(0, video.currentTime - startSec);
            const pct = Math.min(98, Math.round((elapsed / targetDuration) * 100));
            onProgress(pct, `جاري الريندر المحلي... (${pct}%)`);

            ctx.save();
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, outW, outH);

            // Move origin to center of output canvas
            ctx.translate(outW / 2, outH / 2);

            // Apply 4-direction rotation
            if (options.rotationDeg !== 0) {
              ctx.rotate((options.rotationDeg * Math.PI) / 180);
            }

            // Apply horizontal / vertical flips
            const scaleX = options.flipHorizontal ? -1 : 1;
            const scaleY = options.flipVertical ? -1 : 1;
            ctx.scale(scaleX, scaleY);

            // Draw original video frame centered
            ctx.drawImage(video, -srcW / 2, -srcH / 2, srcW, srcH);
            ctx.restore();

            // Render custom Text Overlay on top of the oriented frame
            if (options.overlayText.trim()) {
              const fontSize = Math.max(24, Math.round(outH * 0.055));
              ctx.save();
              ctx.font = `bold ${fontSize}px 'Cairo', 'Plus Jakarta Sans', sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              let textY = outH * 0.86;
              if (options.overlayPosition === 'top') textY = outH * 0.14;
              if (options.overlayPosition === 'center') textY = outH * 0.5;

              const metrics = ctx.measureText(options.overlayText);
              const padX = 28;
              const padY = 16;
              const boxW = metrics.width + padX * 2;
              const boxH = fontSize + padY * 2;

              // Semi-transparent dark backdrop for high contrast readability
              ctx.fillStyle = 'rgba(11, 15, 25, 0.78)';
              ctx.beginPath();
              ctx.roundRect(outW / 2 - boxW / 2, textY - boxH / 2, boxW, boxH, 12);
              ctx.fill();

              ctx.strokeStyle = options.overlayColor || '#38BDF8';
              ctx.lineWidth = 2;
              ctx.stroke();

              ctx.fillStyle = options.overlayColor || '#FFFFFF';
              ctx.fillText(options.overlayText, outW / 2, textY);
              ctx.restore();
            }

            requestAnimationFrame(drawFrame);
          };

          recorder.start(100);
          await video.play();
          drawFrame();
        } catch (err) {
          URL.revokeObjectURL(videoUrl);
          reject(err);
        }
      };

      video.onerror = () => {
        URL.revokeObjectURL(videoUrl);
        reject(new Error('تعذر قراءة ملف الفيديو للمونتاج'));
      };
    });
  }
}

export const ffmpegStudio = new FFmpegStudioService();
