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
  ExternalLink,
  Smartphone,
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
  getSupportedVideoMimeType,
  getSavedFolderName,
  setSavedFolderName,
} from '../services/storage';

interface StudioRecorderProps {
  onVideoSaved: (record: VideoRecord) => void;
  directoryHandle: FileSystemDirectoryHandle | null;
  onSelectDirectory: () => Promise<void>;
  onNavigateToGallery: () => void;
}

export const StudioRecorder: React.FC<StudioRecorderProps> = ({
  onVideoSaved,
  directoryHandle,
  onSelectDirectory,
  onNavigateToGallery,
}) => {
  const isMobileDevice = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
  const [sourceType, setSourceType] = useState<CaptureSourceType>(
    isMobileDevice ? 'camera-rear' : 'screen-full'
  );
  const [resolution, setResolution] = useState<ResolutionKey>('4K');
  const [includeAudio, setIncludeAudio] = useState<boolean>(true);
  const [autoSaveToDisk, setAutoSaveToDisk] = useState<boolean>(false);
  const [customFolderLabel, setCustomFolderLabel] = useState<string>('');
  const [showFolderModal, setShowFolderModal] = useState<boolean>(false);

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
  const nativeMobileCameraInputRef = useRef<HTMLInputElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const rafCropRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const thumbnailRef = useRef<string>('');

  useEffect(() => {
    getSavedFolderName().then(setCustomFolderLabel);
  }, []);

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

  const acquireCameraStreamWithFallback = async (
    facing: 'environment' | 'user',
    resConfig: { width: number; height: number }
  ): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: resConfig.width },
          height: { ideal: resConfig.height },
        },
        audio: includeAudio,
      });
    } catch {
      // iOS Safari fallback if 4K constraints are rejected by a specific lens
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: includeAudio,
      });
    }
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    const resConfig = RESOLUTIONS[resolution];

    try {
      let rawStream: MediaStream;

      if (sourceType === 'screen-full' || sourceType === 'screen-region') {
        // Try getDisplayMedia first; if running on iPhone / iOS or mobile browser that lacks getDisplayMedia,
        // automatically switch to live camera stream instead of throwing an error!
        if (navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices) {
          try {
            rawStream = await navigator.mediaDevices.getDisplayMedia({
              video: {
                width: { ideal: resConfig.width, max: 3840 },
                height: { ideal: resConfig.height, max: 2160 },
                frameRate: { ideal: 60, max: 60 },
              },
              audio: includeAudio,
            });
          } catch {
            // Automatic seamless fallback to mobile camera on iPhone / Mobile
            rawStream = await acquireCameraStreamWithFallback('environment', resConfig);
            setStatusMsg('تم تفعيل التصوير المباشر عبر كاميرا الهاتف تلقائياً (متوافق مع iPhone / iOS).');
          }
        } else {
          // Seamless fallback on iOS Safari where getDisplayMedia is not exposed
          rawStream = await acquireCameraStreamWithFallback('environment', resConfig);
          setStatusMsg('تم بدء التسجيل الفعلي عبر كاميرا الهاتف تلقائياً (نظام iPhone iOS).');
        }
      } else {
        const facing = sourceType === 'camera-rear' ? 'environment' : 'user';
        rawStream = await acquireCameraStreamWithFallback(facing, resConfig);
      }

      mediaStreamRef.current = rawStream;

      const videoEl = previewVideoRef.current;
      if (videoEl) {
        videoEl.srcObject = rawStream;
        await videoEl.play().catch(() => {});
      }

      const vTrack = rawStream.getVideoTracks()[0];
      const settings = vTrack?.getSettings();
      const realW = settings?.width || videoEl?.videoWidth || resConfig.width;
      const realH = settings?.height || videoEl?.videoHeight || resConfig.height;
      setActualStreamDims({ width: realW, height: realH });

      if (vTrack) {
        vTrack.onended = () => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
        };
      }

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
            const vWidth = videoEl.videoWidth || realW;
            const vHeight = videoEl.videoHeight || realH;
            const sx = Math.round((vWidth * cropRegion.x) / 100);
            const sy = Math.round((vHeight * cropRegion.y) / 100);
            const sw = Math.round((vWidth * cropRegion.width) / 100);
            const sh = Math.round((vHeight * cropRegion.height) / 100);
            ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, cropW, cropH);
          }
          rafCropRef.current = requestAnimationFrame(renderCroppedLoop);
        };
        renderCroppedLoop();

        const canvasStream = canvas.captureStream(30);
        rawStream.getAudioTracks().forEach((at) => canvasStream.addTrack(at));
        targetStream = canvasStream;
      }

      const { mimeType, ext } = getSupportedVideoMimeType();

      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(
        targetStream,
        mimeType
          ? { mimeType, videoBitsPerSecond: resConfig.bitrate }
          : { videoBitsPerSecond: resConfig.bitrate }
      );

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      setTimeout(() => {
        if (videoEl) {
          thumbnailRef.current = captureThumbnailFromVideo(videoEl);
        }
      }, 600);

      recorder.onstop = async () => {
        const durationSec = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        const finalMime = mimeType || (ext === 'mp4' ? 'video/mp4' : 'video/webm');
        const finalBlob = new Blob(recordedChunksRef.current, { type: finalMime });
        const title = `AmirRec_${resolution}_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}`;

        const newRecord: VideoRecord = {
          id: `rec_${Date.now()}`,
          title,
          blob: finalBlob,
          mimeType: finalMime,
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
          const diskRes = await saveBlobToDiskWithPicker(
            finalBlob,
            `${title}.${ext}`,
            directoryHandle,
            true
          );
          setStatusMsg(`تم حفظ الفيديو في البرنامج وفي مسار الجهاز: ${diskRes.savedPath}`);
        } else {
          setStatusMsg(`تم حفظ الفيديو بنجاح في الاستوديو وفي مسار: ${customFolderLabel}`);
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
      // If browser camera permission was denied on iOS, trigger native iOS 4K hardware camera input as instant backup
      if (nativeMobileCameraInputRef.current) {
        nativeMobileCameraInputRef.current.click();
        return;
      }
      const message =
        err instanceof Error ? err.message : 'يرجى السماح بصلاحية الكاميرا والمايكروفون لبدء التسجيل.';
      setErrorMsg(message);
    }
  };

  // Handler when user records or picks via native iOS/Mobile hardware camera input
  const handleNativeMobileCameraFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);

    const url = URL.createObjectURL(file);
    const tempVid = document.createElement('video');
    tempVid.src = url;
    tempVid.muted = true;
    tempVid.playsInline = true;

    await new Promise<void>((res) => {
      tempVid.onloadedmetadata = () => res();
      tempVid.onerror = () => res();
    });

    const dur = Number.isFinite(tempVid.duration) && tempVid.duration > 0 ? Math.round(tempVid.duration) : 5;
    const w = tempVid.videoWidth || 1920;
    const h = tempVid.videoHeight || 1080;
    URL.revokeObjectURL(url);

    const newRecord: VideoRecord = {
      id: `ios_cam_${Date.now()}`,
      title: file.name.replace(/\.[^/.]+$/, '') || `تسجيل_آيفون_${new Date().toLocaleTimeString('ar-EG')}`,
      blob: file,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size,
      durationSec: dur,
      width: w,
      height: h,
      resolutionLabel: `${w}×${h} (iOS Native)`,
      sourceType: 'camera-rear',
      createdAt: Date.now(),
      isLocked: false,
    };

    await saveVideoRecord(newRecord);
    onVideoSaved(newRecord);
    setStatusMsg('تم تسجيل وحفظ فيديو كاميرا الآيفون بنجاح داخل استوديو البرنامج!');
    e.target.value = '';
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
      setStatusMsg('تم توليد وحفظ فيديو اختباري حقيقي داخل الاستوديو لتجربة القص والتدوير والنقل الفوري!');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'حدث خطأ أثناء توليد الفيديو التجريبي');
    } finally {
      setIsGeneratingDemo(false);
    }
  };

  const handleChooseSaveLocation = async () => {
    if ('showDirectoryPicker' in window) {
      await onSelectDirectory();
    } else {
      // On iPhone / iOS or browsers without showDirectoryPicker, open the custom save location modal
      setShowFolderModal(true);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      {/* Hidden Native iOS 4K Camera Input for direct hardware capture on iPhone */}
      <input
        ref={nativeMobileCameraInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        onChange={handleNativeMobileCameraFile}
        className="hidden"
      />

      {/* Left / Main Column: Live Studio Viewport */}
      <div className="lg:col-span-8 studio-glass rounded-2xl p-6 flex flex-col justify-between glow-edge-cyan">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800/80">
          <div>
            <h2 className="text-lg font-bold text-white">شاشة الالتقاط والمعاينة المباشرة (كمبيوتر & iPhone iOS)</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              يدعم تسجيل الشاشة أو جزء منها، وتصوير الكاميرا بدقة تصل إلى 4K UHD (3840×2160) بصيغة MP4/WebM
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
            <div className="text-center p-6 max-w-lg">
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
                متوافق بالكامل مع متصفح الآيفون (iOS Safari MP4) وأجهزة الأندرويد والكمبيوتر مع حفظ مباشر محلياً بدون أي سحابة.
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
                  type="button"
                  onClick={() => nativeMobileCameraInputRef.current?.click()}
                  className="px-4 py-3 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 font-bold text-xs flex items-center gap-2 border border-sky-400/40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Smartphone className="w-4 h-4" />
                  كاميرا الآيفون / الموبايل الأصلية (4K)
                </button>
                <button
                  onClick={handleCreateQuickDemo}
                  disabled={isGeneratingDemo}
                  className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-2 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  {isGeneratingDemo ? 'جاري التوليد...' : 'توليد فيديو تجريبي'}
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

          <button
            type="button"
            onClick={onNavigateToGallery}
            className="text-xs text-sky-400 hover:text-sky-300 font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            التوجه إلى مكان الحفظ والفيديوهات المسجلة
          </button>
        </div>

        {statusMsg && (
          <div className="mt-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMsg}</span>
            </div>
            <button
              type="button"
              onClick={onNavigateToGallery}
              className="px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 font-bold text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
            >
              فتح الاستوديو
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Right Column: Capture Controls, True Resolutions & Local Save Path (Mobile + PC) */}
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
                onClick={() => setSourceType('camera-rear')}
                className={`p-3 rounded-xl border text-right transition-all cursor-pointer ${
                  sourceType === 'camera-rear'
                    ? 'bg-sky-500/15 border-sky-400 text-white'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Camera className="w-4 h-4 text-sky-400 mb-1.5" />
                <div className="text-xs font-bold">الكاميرا الخلفية</div>
                <div className="text-[11px] text-slate-400">Rear 4K Camera</div>
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
                <div className="text-[11px] text-slate-400">Front FaceCam</div>
              </button>

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
                <div className="text-[11px] text-slate-400">Full Screen / Mobile</div>
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
            </div>
          </div>

          {/* Region Crop Sliders when screen-region is active */}
          {sourceType === 'screen-region' && (
            <div className="p-4 rounded-xl bg-slate-900/90 border border-sky-500/30 space-y-3">
              <div className="text-xs font-bold text-sky-300">إحداثيات قص جزء الشاشة أو الكاميرا (%)</div>
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

          {/* 3. Audio & Local Directory Path Picker (Works on Mobile iOS/Android & Desktop PC) */}
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
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-sky-400" />
                  مكان الحفظ (للهاتف والكمبيوتر)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleChooseSaveLocation}
                    className="px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300 hover:bg-sky-500/25 text-[11px] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    تحديد مكان الحفظ
                  </button>
                  <button
                    type="button"
                    onClick={onNavigateToGallery}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    التوجه للملفات
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-300 font-mono-tabular truncate">
                {directoryHandle
                  ? `المجلد المحدد: ${directoryHandle.name}/`
                  : `المسار النشط: ${customFolderLabel}`}
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={autoSaveToDisk}
                  onChange={(e) => setAutoSaveToDisk(e.target.checked)}
                  className="rounded accent-sky-400"
                />
                <span>إظهار نافذة حفظ الملف في الهاتف (حفظ في الملفات / ألبوم الآيفون) أو الكمبيوتر فور الانتهاء</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Modal for Mobile / iOS / Custom Save Path Selection */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md studio-glass rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white">تحديد مكان الحفظ على الهاتف (iPhone / Android) والكمبيوتر</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              اختر وجهة الحفظ الافتراضية على جهازك، كما يمكنك تفعيل خيار الحفظ المباشر في تطبيق <strong>الملفات (Files)</strong> أو <strong>ألبوم صور الآيفون (Photos)</strong>:
            </p>
            <div className="space-y-2">
              {[
                'تطبيق الملفات في الآيفون (On My iPhone / Files)',
                'ألبوم الكاميرا والاستوديو (iPhone Photos & Videos)',
                'مجلد التنزيلات المحلي (Downloads / Amir_Recorder_Pro)',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCustomFolderLabel(preset)}
                  className={`w-full p-3 rounded-xl border text-right text-xs font-semibold cursor-pointer ${
                    customFolderLabel === preset
                      ? 'bg-sky-500/20 border-sky-400 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={customFolderLabel}
              onChange={(e) => setCustomFolderLabel(e.target.value)}
              placeholder="أو اكتب اسم مجلد الحفظ المخصص..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
            />
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={async () => {
                  await setSavedFolderName(customFolderLabel);
                  setAutoSaveToDisk(true);
                  setShowFolderModal(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs cursor-pointer"
              >
                اعتماد مكان الحفظ
              </button>
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
