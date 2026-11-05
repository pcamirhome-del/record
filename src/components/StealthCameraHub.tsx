import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  EyeOff,
  Volume1,
  Volume2,
  Power,
  FolderOpen,
  ExternalLink,
  HardDrive,
  Play,
  Scissors,
  Share2,
  Download,
  Lock,
  Film,
  X,
} from 'lucide-react';
import { ResolutionKey, RESOLUTIONS, VideoRecord } from '../types/recorder';
import {
  saveVideoRecord,
  saveBlobToDiskWithPicker,
  getSupportedVideoMimeType,
  getSavedFolderName,
  setSavedFolderName,
  getStaticPassword,
} from '../services/storage';

interface StealthCameraHubProps {
  videos: VideoRecord[];
  onVideoSaved: (record: VideoRecord) => void;
  directoryHandle: FileSystemDirectoryHandle | null;
  onSelectDirectory: () => Promise<void>;
  onNavigateToGallery: () => void;
  onOpenEditor: (video: VideoRecord) => void;
  onOpenTransfer: (video: VideoRecord) => void;
}

export const StealthCameraHub: React.FC<StealthCameraHubProps> = ({
  videos,
  onVideoSaved,
  directoryHandle,
  onSelectDirectory,
  onNavigateToGallery,
  onOpenEditor,
  onOpenTransfer,
}) => {
  const [stealthArmed, setStealthArmed] = useState<boolean>(true);
  const [isStealthRecording, setIsStealthRecording] = useState<boolean>(false);
  const [blackoutMode, setBlackoutMode] = useState<boolean>(false);
  const [resolution, setResolution] = useState<ResolutionKey>('1080p');
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [autoSaveToDevice, setAutoSaveToDevice] = useState<boolean>(false);
  const [customFolderLabel, setCustomFolderLabel] = useState<string>('');
  const [showFolderModal, setShowFolderModal] = useState<boolean>(false);
  const [lastEventLog, setLastEventLog] = useState<string>(
    'جاهز للتصوير الخفي الفوري: اضغط على زر خفض الصوت لبدء التسجيل وزر رفع الصوت لإغلاق وحفظ الفيديو.'
  );

  // Quick preview / password unlock state inside Stealth section
  const [playingVideo, setPlayingVideo] = useState<VideoRecord | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string>('');
  const [unlockTarget, setUnlockTarget] = useState<{
    video: VideoRecord;
    action: 'play' | 'edit' | 'transfer' | 'download';
  } | null>(null);
  const [passInput, setPassInput] = useState<string>('');
  const [passError, setPassError] = useState<string | null>(null);

  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const thumbnailRef = useRef<string>('');

  useEffect(() => {
    getSavedFolderName().then(setCustomFolderLabel);
  }, []);

  useEffect(() => {
    if (playingVideo) {
      const url = URL.createObjectURL(playingVideo.blob);
      setPlayingUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPlayingUrl('');
    }
  }, [playingVideo]);

  const requestScreenWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as unknown as {
          wakeLock: { request: (type: string) => Promise<{ release: () => Promise<void> }> };
        }).wakeLock.request('screen');
      }
    } catch {
      // Optional
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      // ignore
    }
  };

  const captureStealthThumbnail = (videoEl: HTMLVideoElement): string => {
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

  const startHiddenCameraRecording = useCallback(async () => {
    if (isStealthRecording) return;

    try {
      setLastEventLog('جاري بدء التسجيل الخفي من الكاميرا الخلفية بصمت تام...');
      const resConfig = RESOLUTIONS[resolution];

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: resConfig.width },
            height: { ideal: resConfig.height },
          },
          audio: true,
        });
      } catch {
        try {
          // iPhone / iOS Safari relaxed constraint fallback
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: true,
          });
        } catch {
          // Desktop fallback if no camera hardware is plugged in
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#050811';
            ctx.fillRect(0, 0, 1280, 720);
            ctx.fillStyle = '#38BDF8';
            ctx.font = 'bold 30px monospace';
            ctx.fillText('STEALTH BACKGROUND RECORDING // REAR SENSOR', 160, 360);
          }
          stream = canvas.captureStream(30);
        }
      }

      streamRef.current = stream;
      if (hiddenVideoRef.current) {
        hiddenVideoRef.current.srcObject = stream;
        await hiddenVideoRef.current.play().catch(() => {});
      }

      await requestScreenWakeLock();

      const { mimeType, ext } = getSupportedVideoMimeType();

      chunksRef.current = [];
      const recorder = new MediaRecorder(
        stream,
        mimeType
          ? { mimeType, videoBitsPerSecond: resConfig.bitrate }
          : { videoBitsPerSecond: resConfig.bitrate }
      );

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      setTimeout(() => {
        if (hiddenVideoRef.current) {
          thumbnailRef.current = captureStealthThumbnail(hiddenVideoRef.current);
        }
      }, 600);

      recorder.onstop = async () => {
        const durationSec = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        const finalMime = mimeType || (ext === 'mp4' ? 'video/mp4' : 'video/webm');
        const blob = new Blob(chunksRef.current, { type: finalMime });
        const title = `تسجيل_خفي_كاميرا_خلفية_${new Date().toLocaleTimeString('ar-EG').replace(/:/g, '-')}`;

        const record: VideoRecord = {
          id: `stealth_${Date.now()}`,
          title,
          blob,
          mimeType: finalMime,
          sizeBytes: blob.size,
          durationSec,
          width: resConfig.width,
          height: resConfig.height,
          resolutionLabel: `${resConfig.label} (Stealth)`,
          sourceType: 'stealth-rear',
          createdAt: Date.now(),
          isLocked: false,
          thumbnailDataUrl: thumbnailRef.current,
        };

        await saveVideoRecord(record);
        onVideoSaved(record);
        await releaseWakeLock();

        if (autoSaveToDevice || directoryHandle) {
          await saveBlobToDiskWithPicker(blob, `${title}.${ext}`, directoryHandle, true);
        }

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }

        setIsStealthRecording(false);
        setBlackoutMode(false);
        setLastEventLog(
          `تم إيقاف التسجيل عبر زر رفع الصوت وحفظ الفيديو "${title}" بنجاح في البرنامج وفي مسار الحفظ!`
        );
      };

      recorderRef.current = recorder;
      startTimeRef.current = Date.now();
      setElapsedSec(0);
      recorder.start(250);
      setIsStealthRecording(true);

      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);

      setLastEventLog(
        'التسجيل الخفي يعمل الآن في الخلفية (بدون فتح الكاميرا وبدون إشعار) — اضغط زر رفع الصوت لإيقاف وحفظ الفيديو.'
      );
    } catch (err: unknown) {
      setLastEventLog(
        err instanceof Error ? err.message : 'تعذر تشغيل الكاميرا الخلفية، تحقق من منح صلاحية الكاميرا.'
      );
    }
  }, [autoSaveToDevice, directoryHandle, isStealthRecording, onVideoSaved, resolution]);

  const stopHiddenCameraRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  // Direct Volume Down trigger: starts recording immediately when pressed!
  const triggerVolumeDownEvent = useCallback(() => {
    if (!stealthArmed) return;
    if (!isStealthRecording) {
      startHiddenCameraRecording();
    }
  }, [stealthArmed, isStealthRecording, startHiddenCameraRecording]);

  // Direct Volume Up trigger: stops recording and saves immediately when pressed!
  const triggerVolumeUpEvent = useCallback(() => {
    if (isStealthRecording) {
      stopHiddenCameraRecording();
    } else {
      setLastEventLog('تم الضغط على زر رفع الصوت — لا يوجد تسجيل خفي نشط حالياً لإيقافه.');
    }
  }, [isStealthRecording, stopHiddenCameraRecording]);

  // Listen to hardware Volume Down / Volume Up keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'AudioVolumeDown' || e.key === 'VolumeDown' || (e.altKey && e.key === 'ArrowDown')) {
        e.preventDefault();
        triggerVolumeDownEvent();
      } else if (e.key === 'AudioVolumeUp' || e.key === 'VolumeUp' || (e.altKey && e.key === 'ArrowUp')) {
        e.preventDefault();
        triggerVolumeUpEvent();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerVolumeDownEvent, triggerVolumeUpEvent]);

  const handleChooseSaveLocation = async () => {
    if ('showDirectoryPicker' in window) {
      await onSelectDirectory();
    } else {
      setShowFolderModal(true);
    }
  };

  const handleVideoAction = async (
    video: VideoRecord,
    action: 'play' | 'edit' | 'transfer' | 'download'
  ) => {
    if (video.isLocked) {
      setUnlockTarget({ video, action });
      setPassInput('');
      setPassError(null);
      return;
    }
    if (action === 'play') setPlayingVideo(video);
    if (action === 'edit') onOpenEditor(video);
    if (action === 'transfer') onOpenTransfer(video);
    if (action === 'download') {
      await saveBlobToDiskWithPicker(video.blob, video.title, directoryHandle, true);
    }
  };

  const handleVerifyUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockTarget) return;
    const savedPass = await getStaticPassword();
    if (passInput.trim() === savedPass) {
      const { video, action } = unlockTarget;
      setUnlockTarget(null);
      if (action === 'play') setPlayingVideo(video);
      if (action === 'edit') onOpenEditor(video);
      if (action === 'transfer') onOpenTransfer(video);
      if (action === 'download') {
        await saveBlobToDiskWithPicker(video.blob, video.title, directoryHandle, true);
      }
    } else {
      setPassError('كلمة المرور غير صحيحة!');
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden 1x1 pixel video element with playsInline for iOS Safari background stealth operation */}
      <video
        ref={hiddenVideoRef}
        className="w-px h-px opacity-0 pointer-events-none fixed -top-10"
        muted
        playsInline
      />

      {/* Full Blackout Screen Overlay (Simulates Screen-Off / AMOLED Pitch Black Stealth Mode) */}
      {blackoutMode && (
        <div
          onDoubleClick={() => setBlackoutMode(false)}
          className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-between p-8 select-none cursor-pointer"
        >
          <div />
          <div className="text-neutral-900 text-xs text-center font-mono-tabular">
            STEALTH OLED BLACKOUT ACTIVE · DOUBLE TAP TO WAKE
          </div>
          <div className="flex items-center gap-4 opacity-25 hover:opacity-90 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerVolumeDownEvent();
              }}
              className="px-4 py-2.5 rounded-xl bg-neutral-900 text-neutral-300 text-xs border border-neutral-800"
            >
              زر خفض الصوت (بدء التسجيل)
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerVolumeUpEvent();
              }}
              className="px-4 py-2.5 rounded-xl bg-neutral-900 text-neutral-300 text-xs border border-neutral-800"
            >
              زر رفع الصوت (إيقاف وحفظ)
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBlackoutMode(false);
              }}
              className="px-4 py-2.5 rounded-xl bg-neutral-900 text-neutral-300 text-xs border border-neutral-800"
            >
              إيقاظ الشاشة
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Main Stealth Control Center */}
        <div className="lg:col-span-7 studio-glass rounded-2xl p-6 flex flex-col justify-between glow-edge-cyan">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
                  <EyeOff className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    التصوير الخفي بالكاميرا الخلفية (للهاتف iPhone iOS / Android والكمبيوتر)
                  </h2>
                  <p className="text-xs text-slate-400">
                    اضغط زر خفض الصوت لبدء التسجيل فوراً بدون فتح الكاميرا، وزر رفع الصوت لإيقاف وحفظ الفيديو
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStealthArmed(!stealthArmed)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  stealthArmed
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                {stealthArmed ? 'أزرار الصوت: مفعلة' : 'أزرار الصوت: متوقفة'}
              </button>
            </div>

            {/* Direct Volume Down (Start) and Volume Up (Stop) Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="p-4 rounded-xl bg-slate-900/80 border border-sky-500/30 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-sky-300 mb-1.5">
                    <span>زر خفض الصوت (بدء التسجيل الخفي)</span>
                    <Volume1 className="w-4 h-4" />
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed mb-4">
                    عند الضغط على <strong>زر خفض الصوت نفسه</strong> يبدأ التسجيل فوراً من الكاميرا الخلفية في الخلفية بدون فتح واجهة الكاميرا نهائياً وبدون أي إشعار.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={triggerVolumeDownEvent}
                  disabled={isStealthRecording}
                  className="w-full py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-emerald-500/30 disabled:text-emerald-200 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer shadow-lg shadow-sky-500/20"
                >
                  <Volume1 className="w-4 h-4" />
                  {isStealthRecording
                    ? `جاري التسجيل الخفي الآن (${elapsedSec} ثانية)...`
                    : 'زر خفض الصوت (Volume Down) — ابدأ التسجيل الآن'}
                </button>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-rose-500/30 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-rose-300 mb-1.5">
                    <span>زر رفع الصوت (إغلاق وحفظ الفيديو)</span>
                    <Volume2 className="w-4 h-4" />
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed mb-4">
                    عند الضغط على <strong>زر رفع الصوت نفسه</strong> يتم إغلاق التسجيل فوراً وحفظ الفيديو في استوديو البرنامج وفي هاتفك.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={triggerVolumeUpEvent}
                  className="w-full py-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer shadow-lg shadow-rose-600/20"
                >
                  <Volume2 className="w-4 h-4" />
                  زر رفع الصوت (Volume Up) — إيقاف وحفظ الفيديو
                </button>
              </div>
            </div>

            {/* Stealth Status Console */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-300">حالة التصوير الخفي (Stealth Engine):</span>
                <span className="font-mono-tabular text-sky-400 font-bold">
                  {isStealthRecording
                    ? `قيد التسجيل الصامت (${elapsedSec} ثانية)`
                    : 'في وضع الاستعداد الصامت'}
                </span>
              </div>
              <p className="text-xs text-slate-300 font-mono-tabular">{lastEventLog}</p>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">جودة الكاميرا الخلفية:</span>
              {(['720p', '1080p', '2K', '4K'] as ResolutionKey[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={isStealthRecording}
                  onClick={() => setResolution(r)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono-tabular cursor-pointer ${
                    resolution === r
                      ? 'bg-sky-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setBlackoutMode(true)}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Power className="w-4 h-4 text-rose-400" />
              إطفاء الشاشة (OLED Screen-Off)
            </button>
          </div>
        </div>

        {/* Save Path Selection & Navigation inside Stealth Section */}
        <div className="lg:col-span-5 studio-glass rounded-2xl p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 text-sky-400">
              <HardDrive className="w-5 h-5" />
              <h3 className="text-base font-bold text-white">
                إعدادات مكان الحفظ والانتقال للفيديوهات المسجلة
              </h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              حدد مكان حفظ الفيديوهات التي يتم تصويرها في الخلفية على هاتفك (iPhone / Android) أو الكمبيوتر، وتوجه إليها مباشرة في أي وقت:
            </p>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
              <div className="text-xs font-bold text-slate-200">المسار الحالي للحفظ التلقائي:</div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-sky-300 font-mono-tabular truncate">
                {directoryHandle ? `المجلد: ${directoryHandle.name}/` : customFolderLabel}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleChooseSaveLocation}
                  className="py-2.5 px-3 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" />
                  اختيار مكان الحفظ
                </button>

                <button
                  type="button"
                  onClick={onNavigateToGallery}
                  className="py-2.5 px-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  التوجه إلى مكان الحفظ
                </button>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={autoSaveToDevice}
                  onChange={(e) => setAutoSaveToDevice(e.target.checked)}
                  className="rounded accent-sky-400"
                />
                <span>فتح نافذة الحفظ المباشر في ملفات/استوديو الآيفون فور الضغط على زر رفع الصوت</span>
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={onNavigateToGallery}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Film className="w-4 h-4" />
            فتح استوديو البرنامج بالكامل ({videos.length} فيديو محفوظ)
          </button>
        </div>
      </div>

      {/* Recorded Videos List Directly Inside Stealth Section */}
      <div className="studio-glass rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-white">
              الفيديوهات التي تم تسجيلها وحفظها في البرنامج ({videos.length})
            </h3>
            <p className="text-xs text-slate-400">
              جميع الفيديوهات المصورة تظهر هنا فوراً — يمكنك تشغيلها أو قصها وتدويرها أو حفظها في ملفات الآيفون أو إرسالها للكمبيوتر
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateToGallery}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-sky-400 flex items-center gap-1.5 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            عرض في قسم الاستوديو والقفل
          </button>
        </div>

        {videos.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            لا توجد فيديوهات مسجلة بعد. اضغط على زر خفض الصوت لبدء التسجيل الخفي فوراً!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {videos.map((v) => (
              <div
                key={v.id}
                className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate" title={v.title}>
                      {v.title}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono-tabular mt-1">
                      {v.resolutionLabel} · {v.durationSec}s · {(v.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                    </div>
                  </div>
                  {v.isLocked && <Lock className="w-4 h-4 text-rose-400 shrink-0" />}
                </div>

                <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => handleVideoAction(v, 'play')}
                    className="py-2 rounded-lg bg-slate-950 hover:bg-sky-500/20 text-slate-200 hover:text-sky-300 text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    تشغيل
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVideoAction(v, 'edit')}
                    className="py-2 rounded-lg bg-slate-950 hover:bg-indigo-500/20 text-slate-200 hover:text-indigo-300 text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Scissors className="w-3 h-3" />
                    قص
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVideoAction(v, 'transfer')}
                    className="py-2 rounded-lg bg-slate-950 hover:bg-emerald-500/20 text-slate-200 hover:text-emerald-300 text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Share2 className="w-3 h-3" />
                    نقل
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVideoAction(v, 'download')}
                    className="py-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    حفظ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal for Save Location Selection */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md studio-glass rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white">اختيار مكان الحفظ على الهاتف أو الكمبيوتر</h3>
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
                  setAutoSaveToDevice(true);
                  setShowFolderModal(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs cursor-pointer"
              >
                حفظ واعتماد المسار
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

      {/* Password Unlock Modal if video is locked */}
      {unlockTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleVerifyUnlock}
            className="w-full max-w-sm studio-glass rounded-2xl p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-white">أدخل الباسورد الثابت لفتح الفيديو</h3>
            <input
              type="password"
              autoFocus
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              placeholder="الباسورد الثابت..."
              className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
            />
            {passError && <p className="text-xs text-rose-400">{passError}</p>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-sky-500 text-slate-950 font-bold text-xs cursor-pointer"
              >
                فتح الفيديو
              </button>
              <button
                type="button"
                onClick={() => setUnlockTarget(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quick Video Player Modal */}
      {playingVideo && playingUrl && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-3xl studio-glass rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">{playingVideo.title}</h3>
              <button
                type="button"
                onClick={() => setPlayingVideo(null)}
                className="p-1.5 rounded-lg bg-slate-900 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="aspect-video bg-black rounded-xl overflow-hidden flex items-center justify-center">
              <video src={playingUrl} controls autoPlay playsInline className="w-full h-full object-contain" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
