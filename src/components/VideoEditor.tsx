import React, { useState, useEffect, useRef } from 'react';
import {
  Scissors,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Type,
  Save,
  Play,
  Pause,
  CheckCircle2,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { VideoRecord } from '../types/recorder';
import { ffmpegStudio, VideoEditOptions } from '../services/ffmpegService';
import { saveVideoRecord, saveBlobToDiskWithPicker } from '../services/storage';

interface VideoEditorProps {
  selectedVideo: VideoRecord | null;
  allVideos: VideoRecord[];
  onSelectVideo: (v: VideoRecord) => void;
  onVideoSaved: (record: VideoRecord) => void;
  directoryHandle: FileSystemDirectoryHandle | null;
}

export const VideoEditor: React.FC<VideoEditorProps> = ({
  selectedVideo,
  allVideos,
  onSelectVideo,
  onVideoSaved,
  directoryHandle,
}) => {
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [duration, setDuration] = useState<number>(10);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Trim Start & End Seconds
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(10);

  // 4-Direction Rotation & Flips
  const [rotationDeg, setRotationDeg] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState<boolean>(false);
  const [flipV, setFlipV] = useState<boolean>(false);

  // Text Overlay
  const [overlayText, setOverlayText] = useState<string>('');
  const [overlayPosition, setOverlayPosition] = useState<'top' | 'center' | 'bottom'>('bottom');
  const [overlayColor, setOverlayColor] = useState<string>('#38BDF8');

  // Render State
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderPercent, setRenderPercent] = useState<number>(0);
  const [renderStage, setRenderStage] = useState<string>('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!selectedVideo && allVideos.length > 0) {
      onSelectVideo(allVideos[0]);
    }
  }, [selectedVideo, allVideos, onSelectVideo]);

  useEffect(() => {
    if (!selectedVideo) {
      setVideoUrl('');
      return;
    }
    const url = URL.createObjectURL(selectedVideo.blob);
    setVideoUrl(url);
    setTrimStart(0);
    setTrimEnd(selectedVideo.durationSec || 5);
    setDuration(selectedVideo.durationSec || 5);
    setRotationDeg(0);
    setFlipH(false);
    setFlipV(false);
    setOverlayText('');
    setSaveSuccessMsg(null);

    return () => URL.revokeObjectURL(url);
  }, [selectedVideo]);

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    const realDur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : selectedVideo?.durationSec || 5;
    setDuration(Number(realDur.toFixed(2)));
    setTrimStart(0);
    setTrimEnd(Number(realDur.toFixed(2)));
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (v.currentTime >= trimEnd) {
      v.pause();
      v.currentTime = trimStart;
      setIsPlaying(false);
    }
  };

  const togglePlayPreview = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
        v.currentTime = trimStart;
      }
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const handleRenderAndSave = async (exportToDiskAlso: boolean) => {
    if (!selectedVideo) return;
    setIsRendering(true);
    setRenderPercent(5);
    setRenderStage('جاري تجهيز محرك المونتاج المحلي (FFmpeg / WebMedia Pipeline)...');
    setSaveSuccessMsg(null);

    try {
      const options: VideoEditOptions = {
        trimStartSec: trimStart,
        trimEndSec: trimEnd,
        rotationDeg,
        flipHorizontal: flipH,
        flipVertical: flipV,
        overlayText,
        overlayPosition,
        overlayColor,
      };

      const result = await ffmpegStudio.renderEditedVideo(
        selectedVideo.blob,
        options,
        (pct, stage) => {
          setRenderPercent(pct);
          setRenderStage(stage);
        }
      );

      const editedTitle = `${selectedVideo.title}_معدل_${rotationDeg}deg`;
      const newRecord: VideoRecord = {
        id: `edit_${Date.now()}`,
        title: editedTitle,
        blob: result.blob,
        mimeType: 'video/webm',
        sizeBytes: result.blob.size,
        durationSec: result.durationSec,
        width: result.width,
        height: result.height,
        resolutionLabel: `${result.width}×${result.height} (Rendered)`,
        sourceType: selectedVideo.sourceType,
        createdAt: Date.now(),
        isLocked: selectedVideo.isLocked,
        thumbnailDataUrl: selectedVideo.thumbnailDataUrl,
        editMetadata: {
          rotationDeg,
          flipH,
          flipV,
          overlayText,
          trimmedFrom: `${trimStart.toFixed(1)}s - ${trimEnd.toFixed(1)}s`,
        },
      };

      await saveVideoRecord(newRecord);
      onVideoSaved(newRecord);

      if (exportToDiskAlso) {
        const diskRes = await saveBlobToDiskWithPicker(result.blob, `${editedTitle}.webm`, directoryHandle);
        setSaveSuccessMsg(`تم حفظ الفيديو بالتنسيق الجديد في الاستوديو وفي جهازك: ${diskRes.savedPath}`);
      } else {
        setSaveSuccessMsg('تم حفظ الفيديو الجديد بالتنسيق والقص والتدوير والكتابة بنجاح في الاستوديو المحلي!');
      }
    } catch (err: unknown) {
      setRenderStage(err instanceof Error ? err.message : 'حدث خطأ أثناء معالجة الفيديو');
    } finally {
      setIsRendering(false);
    }
  };

  if (!selectedVideo) {
    return (
      <div className="studio-glass rounded-2xl p-10 text-center">
        <p className="text-sm text-slate-300">
          يرجى اختيار فيديو من قسم الاستوديو أو تسجيل فيديو جديد لفتحه في محرر القص والتدوير.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      {/* Left Column: Live Interactive Video Preview + Dual Trim Timeline */}
      <div className="lg:col-span-7 studio-glass rounded-2xl p-6 flex flex-col justify-between glow-edge-cyan">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-800">
            <div>
              <h2 className="text-lg font-bold text-white">معاينة التنسيق والمونتاج المباشر</h2>
              <p className="text-xs text-slate-400">
                قص الثواني بدقة · تدوير في الاتجاهات الأربعة · إضافة نصوص على الفيديو
              </p>
            </div>

            {/* Video Selector Dropdown if multiple videos exist */}
            <select
              value={selectedVideo.id}
              onChange={(e) => {
                const found = allVideos.find((v) => v.id === e.target.value);
                if (found && !found.isLocked) onSelectVideo(found);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-200"
            >
              {allVideos
                .filter((v) => !v.isLocked || v.id === selectedVideo.id)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} ({v.durationSec}s)
                  </option>
                ))}
            </select>
          </div>

          {/* Preview Stage */}
          <div className="relative aspect-video bg-slate-950 rounded-xl border border-slate-800 overflow-hidden flex items-center justify-center">
            {videoUrl && (
              <video
                ref={videoRef}
                src={videoUrl}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setIsPlaying(false)}
                className="max-w-full max-h-full object-contain transition-transform duration-200"
                style={{
                  transform: `rotate(${rotationDeg}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
                }}
              />
            )}

            {/* Live Text Overlay Preview */}
            {overlayText.trim() && (
              <div
                className={`absolute inset-x-0 flex justify-center pointer-events-none px-6 ${
                  overlayPosition === 'top'
                    ? 'top-6'
                    : overlayPosition === 'center'
                    ? 'top-1/2 -translate-y-1/2'
                    : 'bottom-6'
                }`}
              >
                <div
                  className="px-5 py-2 rounded-xl bg-slate-950/85 border text-base font-bold shadow-lg"
                  style={{
                    color: overlayColor,
                    borderColor: overlayColor,
                  }}
                >
                  {overlayText}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Dual Trim Slider & Timeline Controls */}
        <div className="mt-6 pt-4 border-t border-slate-800 space-y-4">
          <div className="flex items-center justify-between text-xs font-mono-tabular">
            <button
              type="button"
              onClick={togglePlayPreview}
              className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
              {isPlaying ? 'إيقاف مؤقت' : 'معاينة الجزء المقطوع'}
            </button>

            <div className="text-slate-300">
              الوقت الحالي: <span className="text-sky-400 font-bold">{currentTime.toFixed(1)}s</span> /{' '}
              {duration.toFixed(1)}s
            </div>

            <div className="text-emerald-400 font-bold">
              المدة بعد القص: {Math.max(0.5, trimEnd - trimStart).toFixed(1)} ثانية
            </div>
          </div>

          {/* Interactive Trim Range Bar */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Scissors className="w-4 h-4 text-sky-400" />
                شريط قص الفيديو (تحريك يمين ويسار + تحديد ثواني البداية والنهاية)
              </span>
            </div>

            {/* Visual Range Bar */}
            <div className="relative h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className="absolute top-0 bottom-0 bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full"
                style={{
                  right: `${(trimStart / Math.max(1, duration)) * 100}%`,
                  left: `${100 - (trimEnd / Math.max(1, duration)) * 100}%`,
                }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-slate-400">ثانية البداية (Start Sec):</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={Math.max(0, trimEnd - 0.5)}
                    value={trimStart}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(Number(e.target.value), trimEnd - 0.5));
                      setTrimStart(val);
                      if (videoRef.current) videoRef.current.currentTime = val;
                    }}
                    className="w-20 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-sky-300 font-mono-tabular text-center"
                  />
                </div>
                <input
                  type="range"
                  step="0.1"
                  min={0}
                  max={Math.max(0.5, duration - 0.5)}
                  value={trimStart}
                  onChange={(e) => {
                    const val = Math.min(Number(e.target.value), trimEnd - 0.5);
                    setTrimStart(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-slate-400">ثانية النهاية (End Sec):</label>
                  <input
                    type="number"
                    step="0.1"
                    min={trimStart + 0.5}
                    max={duration}
                    value={trimEnd}
                    onChange={(e) => {
                      const val = Math.min(duration, Math.max(Number(e.target.value), trimStart + 0.5));
                      setTrimEnd(val);
                      if (videoRef.current) videoRef.current.currentTime = val;
                    }}
                    className="w-20 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-indigo-300 font-mono-tabular text-center"
                  />
                </div>
                <input
                  type="range"
                  step="0.1"
                  min={0.5}
                  max={duration}
                  value={trimEnd}
                  onChange={(e) => {
                    const val = Math.max(Number(e.target.value), trimStart + 0.5);
                    setTrimEnd(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                  className="w-full accent-indigo-400 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: 4-Direction Orientation, Flip, Text Overlay & Save */}
      <div className="lg:col-span-5 studio-glass rounded-2xl p-6 flex flex-col justify-between space-y-6">
        <div className="space-y-6">
          {/* 1. Rotate & Flip in all 4 Directions */}
          <div>
            <label className="block text-xs font-bold text-slate-200 mb-2.5">
              1. تغيير اتجاه ولف الفيديو في الأربع اتجاهات (أعلى · أسفل · يمين · يسار)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <button
                type="button"
                onClick={() => setRotationDeg(0)}
                className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 cursor-pointer ${
                  rotationDeg === 0
                    ? 'bg-sky-500/20 border-sky-400 text-white'
                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <ArrowUp className="w-4 h-4 text-sky-400" />
                <span>أعلى (0°)</span>
              </button>

              <button
                type="button"
                onClick={() => setRotationDeg(90)}
                className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 cursor-pointer ${
                  rotationDeg === 90
                    ? 'bg-sky-500/20 border-sky-400 text-white'
                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <ArrowRight className="w-4 h-4 text-sky-400" />
                <span>يمين (90°)</span>
              </button>

              <button
                type="button"
                onClick={() => setRotationDeg(180)}
                className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 cursor-pointer ${
                  rotationDeg === 180
                    ? 'bg-sky-500/20 border-sky-400 text-white'
                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <ArrowDown className="w-4 h-4 text-sky-400" />
                <span>أسفل (180°)</span>
              </button>

              <button
                type="button"
                onClick={() => setRotationDeg(270)}
                className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 cursor-pointer ${
                  rotationDeg === 270
                    ? 'bg-sky-500/20 border-sky-400 text-white'
                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <ArrowLeft className="w-4 h-4 text-sky-400" />
                <span>يسار (270°)</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFlipH(!flipH)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer ${
                  flipH
                    ? 'bg-indigo-500/20 border-indigo-400 text-indigo-200'
                    : 'bg-slate-900/70 border-slate-800 text-slate-300'
                }`}
              >
                <FlipHorizontal className="w-4 h-4" />
                عكس أفقي (يمين ⇄ يسار)
              </button>

              <button
                type="button"
                onClick={() => setFlipV(!flipV)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer ${
                  flipV
                    ? 'bg-indigo-500/20 border-indigo-400 text-indigo-200'
                    : 'bg-slate-900/70 border-slate-800 text-slate-300'
                }`}
              >
                <FlipVertical className="w-4 h-4" />
                عكس عمودي (أعلى ⇅ أسفل)
              </button>
            </div>
          </div>

          {/* 2. Text Overlay on Video */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <label className="block text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Type className="w-4 h-4 text-sky-400" />
              2. الكتابة على الفيديو (Text Overlay) وتحديد الموضع
            </label>

            <input
              type="text"
              value={overlayText}
              onChange={(e) => setOverlayText(e.target.value)}
              placeholder="اكتب أي نص ليظهر مطبوعاً داخل الفيديو..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-400"
            />

            <div className="grid grid-cols-3 gap-2">
              {(['top', 'center', 'bottom'] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setOverlayPosition(pos)}
                  className={`py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                    overlayPosition === pos
                      ? 'bg-sky-500/20 border-sky-400 text-white'
                      : 'bg-slate-900/70 border-slate-800 text-slate-400'
                  }`}
                >
                  {pos === 'top' ? 'أعلى الفيديو' : pos === 'center' ? 'منتصف الفيديو' : 'أسفل الفيديو'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <span className="text-xs text-slate-400">لون النص:</span>
              {['#38BDF8', '#FFFFFF', '#F43F5E', '#10B981', '#F59E0B'].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setOverlayColor(color)}
                  className={`w-6 h-6 rounded-full border-2 cursor-pointer ${
                    overlayColor === color ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* 3. Render & Save Section */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          {isRendering && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-sky-500/40 space-y-2">
              <div className="flex items-center justify-between text-xs text-sky-300 font-mono-tabular">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {renderStage}
                </span>
                <span>{renderPercent}%</span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-400 transition-all duration-200"
                  style={{ width: `${renderPercent}%` }}
                />
              </div>
            </div>
          )}

          {saveSuccessMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={isRendering}
              onClick={() => handleRenderAndSave(false)}
              className="py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              حفظ في الاستوديو بالتنسيق الجديد
            </button>

            <button
              type="button"
              disabled={isRendering}
              onClick={() => handleRenderAndSave(true)}
              className="py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCw className="w-4 h-4" />
              ريندر وحفظ كملف على الجهاز
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
