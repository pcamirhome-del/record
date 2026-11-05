import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Monitor,
  Crop,
  Camera,
  Mic,
  MicOff,
  Square,
  Play,
  Pause,
  FolderOpen,
  HardDrive,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  ResolutionKey,
  RESOLUTIONS,
  CaptureSourceType,
  CropRegion,
  VideoRecord,
} from '../types/recorder';
import {
  saveVideoRecord,
  saveBlobToDiskWithPicker,
  generateDemoStudioVideo,
} from '../services/storage';

interface StudioRecorderProps {
  onVideoSaved: (record: VideoRecord) => void;
  directoryHandle: FileSystemDirectoryHandle | null;
  onSelectDirectory: () => Promise<void>;
}

export const StudioRecorder: React.FC<StudioRecorderProps> = ({
  onVideoSaved,
  directoryHandle,
  onSelectDirectory,
}) => {
  const [sourceType, setSourceType] = useState<CaptureSourceType>('screen-full');
  const [resolution, setResolution] = useState<ResolutionKey>('4K');
  const [includeAudio, setIncludeAudio] = useState<boolean>(true);
  const [autoSaveToDisk, setAutoSaveToDisk] = useState<boolean>(false);

  // Region Crop state (percentage of source video)
  const [cropRegion, setCropRegion] = useState<CropRegion>({
    x: 10,
    y: 10,
    width: 80,
    height: 80,
  });

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [actualStreamDims, setActualStreamDims] = useState<{ width: number; height: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isGeneratingDemo, setIsGeneratingDemo] = useState<boolean>(false);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const rafCropRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const thumbnailRef = useRef<string>('');

  const stopAllStreams = useCallback(() => {
    if (rafCropRef.current) {
      cancelAnimationFrame(rafCropRef.current);
      rafCropRef.current = null;
    }
    if (timerIntervalRef.current) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopAllStreams();
    };
  }, [stopAllStreams]);

  const formatTime = (sec: number) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [hrs, mins, s].map((v) => String(v).padStart(2, '0')).join(':');
  };

  const captureThumbnailFromVideo = (videoEl: HTMLVideoElement): string => {
    try {
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 270;
      const ctx = c.getContext('2d');
      if (ctx && videoEl.videoWidth > 0) {
        ctx.drawImage(videoEl, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.75);
      }
    } catch {
      // ignore
    }
    return '';
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    const resConfig = RESOLUTIONS[resolution];

    try {
      let rawStream: MediaStream;

      if (sourceType === 'screen-full' || sourceType === 'screen-region') {
        if (!navigator.mediaDevices || !('getDisplayMedia' in navigator.mediaDevices)) {
          throw new Error('متصفحك الحالي أو بيئة العرض لا تدعم getDisplayMedia، جرب تسجيل الكاميرا أو افتح التطبيق في نافذة مستقلة.');
        }

        rawStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: resConfig.width, max: 3840 },
            height: { ideal: resConfig.height, max: 2160 },
            frameRate: { ideal: 60, max: 60 },
          },
          audio: includeAudio,
        });

        // If user also wants microphone mixed in when screen recording
        if (includeAudio && rawStream.getAudioTracks().length === 0) {
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStream.getAudioTracks().forEach((t) => rawStream.addTrack(t));
          } catch {
            // Mic optional if denied
          }
        }
      } else {
        // Camera recording (Rear or Front) with real hardware MediaStreamConstraints up to 4K
        const facingMode = sourceType === 'camera-rear' ? { ideal: 'environment' } : { ideal: 'user' };
        rawStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: resConfig.width },
            height: { ideal: resConfig.height },
            frameRate: { ideal: 60 },
          },
          audio: includeAudio,
        });
      }

      mediaStreamRef.current = rawStream;

      // Connect stream to live preview
      const videoEl = previewVideoRef.current;
      if (videoEl) {
        videoEl.srcObject = rawStream;
        await videoEl.play();
      }

      const vTrack = rawStream.getVideoTracks()[0];
      const settings = vTrack?.getSettings();
      const realW = settings?.width || videoEl?.videoWidth || resConfig.width;
      const realH = settings?.height || videoEl?.videoHeight || resConfig.height;
      setActualStreamDims({ width: realW, height: realH });

      // Handle stream ending via native browser "Stop sharing" button
      vTrack.onended = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      };

      // Determine final stream to record (Full stream vs Cropped Region Canvas stream)
      let targetStream: MediaStream = rawStream;
      let recordedW = realW;
      let recordedH = realH;

      if (sourceType === 'screen-region' && videoEl && cropCanvasRef.current) {
        const canvas = cropCanvasRef.current;
        const cropW = Math.max(120, Math.round((realW * cropRegion.width) / 100));
        const cropH = Math.max(120, Math.round((realH * cropRegion.height) / 100));
        canvas.width = cropW;
        canvas.height = cropH;
        recordedW = cropW;
        recordedH = cropH;

        const ctx = canvas.getContext('2d');
        const renderCroppedLoop = () => {
          if (ctx && videoEl.readyState >= 2) {
            const sx = Math.round((videoEl.videoWidth * cropRegion.x) / 100);
            const sy = Math.round((videoEl.videoHeight * cropRegion.y) / 100);
            const sw = Math.round((videoEl.videoWidth * cropRegion.width) / 100);
            const sh = Math.round((videoEl.videoHeight * cropRegion.height) / 100);
            ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, cropW, cropH);
          }
          rafCropRef.current = requestAnimationFrame(renderCroppedLoop);
        };
        renderCroppedLoop();

        const canvasStream = canvas.captureStream(60);
        rawStream.getAudioTracks().forEach((at) => canvasStream.addTrack(at));
        targetStream = canvasStream;
      }

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';

      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(targetStream, {
        mimeType,
        videoBitsPerSecond: resConfig.bitrate,
      });

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      // Capture thumbnail after 600ms
      setTimeout(() => {
        if (videoEl) {
          thumbnailRef.current = captureThumbnailFromVideo(videoEl);
        }
      }, 600);

      recorder.onstop = async () => {
        const durationSec = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        const finalBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        const title = `AmirRec_${resolution}_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}`;

        const newRecord: VideoRecord = {
          id: `rec_${Date.now()}`,
          title,
          blob: finalBlob,
          mimeType,
          sizeBytes: finalBlob.size,
          durationSec,
          width: recordedW,
          height: recordedH,
          resolutionLabel: `${resConfig.label} (${recordedW}×${recordedH})`,
          sourceType,
          createdAt: Date.now(),
          isLocked: false,
          thumbnailDataUrl: thumbnailRef.current,
        };

        await saveVideoRecord(newRecord);
        onVideoSaved(newRecord);

        if (autoSaveToDisk || directoryHandle) {
          const diskRes = await saveBlobToDiskWithPicker(finalBlob, `${title}.webm`, directoryHandle);
          setStatusMsg(`تم حفظ الفيديو محلياً في الاستوديو وفي المسار: ${diskRes.savedPath}`);
        } else {
          setStatusMsg('تم حفظ الفيديو بنجاح داخل استوديو التطبيق المحلي (IndexedDB 100% Offline).');
        }

        setIsRecording(false);
        setIsPaused(false);
        stopAllStreams();
      };

      mediaRecorderRef.current = recorder;
      startTimeRef.current = Date.now();
      setElapsedSec(0);
      recorder.start(250);
      setIsRecording(true);
      setIsPaused(false);

      timerIntervalRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      stopAllStreams();
      const message = err instanceof Error ? err.message : 'تعذر بدء التسجيل، تأكد من منح صلاحيات الشاشة أو الكاميرا.';
      setErrorMsg(message);
    }
  };

  const togglePause = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      setIsPaused(true);
      if (timerIntervalRef.current) window.clearInterval(timerIntervalRef.current);
    } else if (rec.state === 'paused') {
      rec.resume();
      setIsPaused(false);
      timerIntervalRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleCreateQuickDemo = async () => {
    setIsGeneratingDemo(true);
    setErrorMsg(null);
    try {
      const demo = await generateDemoStudioVideo();
      onVideoSaved(demo);
      setStatusMsg('تم توليد وحفظ فيديو اختباري حقيقي بدقة HD داخل الاستوديو لتجربة القص والتدوير والنقل الفوري!');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'حدث خطأ أثناء توليد الفيديو التجريبي');
    } finally {
      setIsGeneratingDemo(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      {/* Left / Main Column: Live Studio Viewport */}
      <div className="lg:col-span-8 studio-glass rounded-2xl p-6 flex flex-col justify-between glow-edge-cyan">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800/80">
          <div>
            <h2 className="text-lg font-bold text-white">شاشة الالتقاط والمعاينة المباشرة</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              دعم كامل لـ MediaStreamConstraints بدقة فعلية تصل إلى 4K UHD (3840×2160) بدون ضغط سحابي
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-300 font-mono-tabular">
            <span>العداد: {formatTime(elapsedSec)}</span>
            <span aria-hidden="true">·</span>
            <span>
              الأبعاد الفعلية:{' '}
              {actualStreamDims
                ? `${actualStreamDims.width}×${actualStreamDims.height}`
                : `${RESOLUTIONS[resolution].width}×${RESOLUTIONS[resolution].height}`}
            </span>
          </div>
        </div>

        {/* Viewport Box */}
        <div className="relative w-full aspect-video rounded-xl bg-slate-950 border border-slate-800/90 overflow-hidden flex items-center justify-center">
          <video
            ref={previewVideoRef}
            className={`w-full h-full object-contain ${isRecording ? 'block' : 'hidden'}`}
            muted
            playsInline
          />
          <canvas ref={cropCanvasRef} className="hidden" />

          {/* Interactive Region Crop Overlay when 'screen-region' is selected */}
          {sourceType === 'screen-region' && (
            <div
              className="absolute border-2 border-dashed border-sky-400 bg-sky-500/10 pointer-events-none transition-all"
              style={{
                left: `${cropRegion.x}%`,
                top: `${cropRegion.y}%`,
                width: `${cropRegion.width}%`,
                height: `${cropRegion.height}%`,
              }}
            >
              <div className="bg-sky-500 text-slate-950 text-[11px] font-bold px-2 py-0.5 inline-block rounded-br">
                منطقة القص المحددة ({cropRegion.width}% × {cropRegion.height}%)
              </div>
            </div>
          )}

          {!isRecording && (
            <div className="text-center p-6 max-w-md">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4 text-sky-400">
                {sourceType.startsWith('screen') ? (
                  <Monitor className="w-8 h-8" />
                ) : (
                  <Camera className="w-8 h-8" />
                )}
              </div>
              <h3 className="text-base font-bold text-slate-200 mb-1">
                جاهز لبدء التسجيل المحلي بجودة {RESOLUTIONS[resolution].label}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-5">
                جميع الفيديوهات تُسجل محلياً عبر MediaRecorder API بترميز VP9 عالي البت ريت وتُحفظ مباشرة على جهازك دون أي خادم خارجي.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={startRecording}
                  className="px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-rose-600/25 transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Play className="w-4 h-4 fill-current" />
                  بدء التسجيل الفعلي الآن
                </button>
                <button
                  onClick={handleCreateQuickDemo}
                  disabled={isGeneratingDemo}
                  className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-2 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  {isGeneratingDemo ? 'جاري التوليد (3 ثوانٍ)...' : 'توليد فيديو تجريبي للمونتاج'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Recording Action Bar */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {!isRecording ? (
              <button
                onClick={startRecording}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4 fill-current" />
                بدء التقاط {sourceType === 'screen-region' ? 'المنطقة المحددة' : 'الفيديو'}
              </button>
            ) : (
              <>
                <button
                  onClick={togglePause}
                  className="px-4 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Pause className="w-4 h-4" />
                  {isPaused ? 'استئناف التسجيل' : 'إيقاف مؤقت'}
                </button>
                <button
                  onClick={stopRecording}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Square className="w-4 h-4 fill-current" />
                  إنهاء وحفظ الفيديو
                </button>
              </>
            )}
          </div>

          <div className="text-xs text-slate-400 font-mono-tabular">
            معدل البت المستهدف: {(RESOLUTIONS[resolution].bitrate / 1_000_000).toFixed(0)} Mbps · 60 FPS
          </div>
        </div>

        {statusMsg && (
          <div className="mt-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Right Column: Capture Controls, True Resolutions & Local Save Path */}
      <div className="lg:col-span-4 studio-glass rounded-2xl p-6 flex flex-col justify-between space-y-6">
        <div className="space-y-6">
          {/* 1. Source Type Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2.5">
              1. مصدر التصوير (شاشة كاملة / جزء مخصص / كاميرا)
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isRecording}
                onClick={() => setSourceType('screen-full')}
                className={`p-3 rounded-xl border text-right transition-all cursor-pointer ${
                  sourceType === 'screen-full'
                    ? 'bg-sky-500/15 border-sky-400 text-white'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Monitor className="w-4 h-4 text-sky-400 mb-1.5" />
                <div className="text-xs font-bold">شاشة كاملة</div>
                <div className="text-[11px] text-slate-400">Full Screen / Tab</div>
              </button>

              <button
                type="button"
                disabled={isRecording}
                onClick={() => setSourceType('screen-region')}
                className={`p-3 rounded-xl border text-right transition-all cursor-pointer ${
                  sourceType === 'screen-region'
                    ? 'bg-sky-500/15 border-sky-400 text-white'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Crop className="w-4 h-4 text-sky-400 mb-1.5" />
                <div className="text-xs font-bold">جزء معين من الشاشة</div>
                <div className="text-[11px] text-slate-400">Custom Crop Region</div>
              </button>

              <button
                type="button"
                disabled={isRecording}
                onClick={() => setSourceType('camera-rear')}
                className={`p-3 rounded-xl border text-right transition-all cursor-pointer ${
                  sourceType === 'camera-rear'
                    ? 'bg-sky-500/15 border-sky-400 text-white'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Camera className="w-4 h-4 text-sky-400 mb-1.5" />
                <div className="text-xs font-bold">الكاميرا الخلفية</div>
                <div className="text-[11px] text-slate-400">Rear Environment</div>
              </button>

              <button
                type="button"
                disabled={isRecording}
                onClick={() => setSourceType('camera-front')}
                className={`p-3 rounded-xl border text-right transition-all cursor-pointer ${
                  sourceType === 'camera-front'
                    ? 'bg-sky-500/15 border-sky-400 text-white'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Camera className="w-4 h-4 text-indigo-400 mb-1.5" />
                <div className="text-xs font-bold">الكاميرا الأمامية</div>
                <div className="text-[11px] text-slate-400">Studio FaceCam</div>
              </button>
            </div>
          </div>

          {/* Region Crop Sliders when screen-region is active */}
          {sourceType === 'screen-region' && (
            <div className="p-4 rounded-xl bg-slate-900/90 border border-sky-500/30 space-y-3">
              <div className="text-xs font-bold text-sky-300">إحداثيات قص جزء الشاشة (%)</div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1 font-mono-tabular">
                    إزاحة أفقية X: {cropRegion.x}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    value={cropRegion.x}
                    onChange={(e) => setCropRegion({ ...cropRegion, x: Number(e.target.value) })}
                    className="w-full accent-sky-400"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1 font-mono-tabular">
                    إزاحة عمودية Y: {cropRegion.y}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    value={cropRegion.y}
                    onChange={(e) => setCropRegion({ ...cropRegion, y: Number(e.target.value) })}
                    className="w-full accent-sky-400"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1 font-mono-tabular">
                    العرض W: {cropRegion.width}%
                  </label>
                  <input
                    type="range"
                    min={20}
                    max={100 - cropRegion.x}
                    value={cropRegion.width}
                    onChange={(e) => setCropRegion({ ...cropRegion, width: Number(e.target.value) })}
                    className="w-full accent-sky-400"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1 font-mono-tabular">
                    الارتفاع H: {cropRegion.height}%
                  </label>
                  <input
                    type="range"
                    min={20}
                    max={100 - cropRegion.y}
                    value={cropRegion.height}
                    onChange={(e) => setCropRegion({ ...cropRegion, height: Number(e.target.value) })}
                    className="w-full accent-sky-400"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 2. Resolution Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2.5">
              2. الدقة الفعلية للتسجيل (Hardware Stream Constraints)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(RESOLUTIONS) as ResolutionKey[]).map((key) => {
                const item = RESOLUTIONS[key];
                const active = resolution === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={isRecording}
                    onClick={() => setResolution(key)}
                    className={`px-3 py-2.5 rounded-xl border text-right transition-all cursor-pointer ${
                      active
                        ? 'bg-indigo-500/20 border-indigo-400 text-white'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-bold">{item.label}</div>
                    <div className="text-[11px] font-mono-tabular text-slate-400">{item.badge}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Audio & Local Directory Path Picker */}
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => setIncludeAudio(!includeAudio)}
              className="w-full p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex items-center justify-between text-xs cursor-pointer hover:border-slate-700"
            >
              <span className="flex items-center gap-2 font-semibold text-slate-200">
                {includeAudio ? (
                  <Mic className="w-4 h-4 text-emerald-400" />
                ) : (
                  <MicOff className="w-4 h-4 text-rose-400" />
                )}
                تسجيل الصوت المدمج (المايكروفون والنظام)
              </span>
              <span className="font-mono-tabular text-slate-400">
                {includeAudio ? 'مفعل' : 'صامت'}
              </span>
            </button>

            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-sky-400" />
                  مسار الحفظ المحلي على الجهاز
                </span>
                <button
                  type="button"
                  onClick={onSelectDirectory}
                  className="px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300 hover:bg-sky-500/25 text-[11px] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  اختيار مجلد
                </button>
              </div>
              <p className="text-[11px] text-slate-400 font-mono-tabular truncate">
                {directoryHandle
                  ? `المجلد النشط: ${directoryHandle.name}/ (File System API)`
                  : 'الحفظ الافتراضي: IndexedDB + نافذة اختيار مكان الحفظ'}
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={autoSaveToDisk}
                  onChange={(e) => setAutoSaveToDisk(e.target.checked)}
                  className="rounded accent-sky-400"
                />
                <span>فتح نافذة اختيار مسار الحفظ على القرص فور انتهاء التسجيل</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
