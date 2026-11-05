import React, { useState, useEffect } from 'react';
import {
  Lock,
  Unlock,
  Play,
  Scissors,
  Share2,
  Trash2,
  Download,
  KeyRound,
  Film,
  Sparkles,
  CheckCircle2,
  X,
} from 'lucide-react';
import { VideoRecord } from '../types/recorder';
import {
  getStaticPassword,
  setStaticPassword,
  updateVideoRecord,
  deleteVideoRecord,
  saveBlobToDiskWithPicker,
  generateDemoStudioVideo,
} from '../services/storage';

interface LocalGalleryProps {
  videos: VideoRecord[];
  onRefreshVideos: (updated: VideoRecord[]) => void;
  onOpenEditor: (video: VideoRecord) => void;
  onOpenTransfer: (video: VideoRecord) => void;
  directoryHandle: FileSystemDirectoryHandle | null;
}

export const LocalGallery: React.FC<LocalGalleryProps> = ({
  videos,
  onRefreshVideos,
  onOpenEditor,
  onOpenTransfer,
  directoryHandle,
}) => {
  const [staticPassword, setStaticPasswordState] = useState<string>('1234');
  const [newPasswordInput, setNewPasswordInput] = useState<string>('');
  const [showPasswordSettings, setShowPasswordSettings] = useState<boolean>(false);
  const [passwordSavedFeedback, setPasswordSavedFeedback] = useState<boolean>(false);

  // Unlock Modal State
  const [pendingAction, setPendingAction] = useState<{
    video: VideoRecord;
    action: 'play' | 'edit' | 'transfer' | 'toggle-lock' | 'download';
  } | null>(null);
  const [enteredPass, setEnteredPass] = useState<string>('');
  const [passError, setPassError] = useState<string | null>(null);

  // Active Video Player Modal
  const [playingVideo, setPlayingVideo] = useState<VideoRecord | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string>('');

  useEffect(() => {
    getStaticPassword().then((p) => {
      setStaticPasswordState(p);
      setNewPasswordInput(p);
    });
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

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const executeProtectedAction = async (
    video: VideoRecord,
    action: 'play' | 'edit' | 'transfer' | 'toggle-lock' | 'download'
  ) => {
    if (action === 'play') {
      setPlayingVideo(video);
    } else if (action === 'edit') {
      onOpenEditor(video);
    } else if (action === 'transfer') {
      onOpenTransfer(video);
    } else if (action === 'toggle-lock') {
      const updated = await updateVideoRecord(video.id, (v) => ({
        ...v,
        isLocked: !v.isLocked,
      }));
      onRefreshVideos(updated);
    } else if (action === 'download') {
      await saveBlobToDiskWithPicker(video.blob, `${video.title}.webm`, directoryHandle);
    }
  };

  const handleVideoActionClick = (
    video: VideoRecord,
    action: 'play' | 'edit' | 'transfer' | 'toggle-lock' | 'download'
  ) => {
    // If the video is locked, require static password verification first!
    // If it's unlocked and user clicks 'toggle-lock', lock it immediately with the static password.
    if (video.isLocked) {
      setPendingAction({ video, action });
      setEnteredPass('');
      setPassError(null);
    } else {
      executeProtectedAction(video, action);
    }
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingAction) return;
    if (enteredPass.trim() === staticPassword) {
      const { video, action } = pendingAction;
      setPendingAction(null);
      await executeProtectedAction(video, action);
    } else {
      setPassError('كلمة المرور غير صحيحة! يرجى إدخال الباسورد الثابت الصحيح.');
    }
  };

  const handleSaveStaticPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPasswordInput.trim()) return;
    await setStaticPassword(newPasswordInput.trim());
    setStaticPasswordState(newPasswordInput.trim());
    setPasswordSavedFeedback(true);
    setTimeout(() => {
      setPasswordSavedFeedback(false);
      setShowPasswordSettings(false);
    }, 1200);
  };

  const handleDelete = async (video: VideoRecord) => {
    if (video.isLocked) {
      setPendingAction({ video, action: 'toggle-lock' });
      return;
    }
    const updated = await deleteVideoRecord(video.id);
    onRefreshVideos(updated);
  };

  const handleGenerateSample = async () => {
    const sample = await generateDemoStudioVideo();
    onRefreshVideos([sample, ...videos]);
  };

  return (
    <div className="space-y-6">
      {/* Top Studio Gallery Header & Static Password Configuration */}
      <div className="studio-glass rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">
            استوديو الفيديوهات المحلي وحماية الملفات (Local IndexedDB Vault)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            جميع التسجيلات محفوظة محلياً بنسبة 100% على جهازك — اضغط على أي فيديو للتشغيل أو القفل بباسورد أو القص والتدوير
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowPasswordSettings(!showPasswordSettings)}
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-sky-300 flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            <KeyRound className="w-4 h-4" />
            إعدادات الباسورد الثابت للقفل (الحالي: {staticPassword})
          </button>
        </div>
      </div>

      {/* Static Password Drawer */}
      {showPasswordSettings && (
        <form
          onSubmit={handleSaveStaticPassword}
          className="studio-glass rounded-2xl p-5 border border-sky-500/30 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="text-xs font-bold text-white">تعيين كلمة المرور الثابتة (Static Password)</div>
            <p className="text-xs text-slate-400">
              يُستخدم هذا الباسورد لفتح أي فيديو مقفل أو فيديوهات الكاميرا الخلفية السرية قبل تشغيلها أو تعديلها.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="أدخل الباسورد الثابت..."
              className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono-tabular focus:outline-none focus:border-sky-400"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs cursor-pointer whitespace-nowrap shrink-0"
            >
              حفظ الباسورد
            </button>
            {passwordSavedFeedback && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> تم التحديث
              </span>
            )}
          </div>
        </form>
      )}

      {/* Video Cards Grid */}
      {videos.length === 0 ? (
        <div className="studio-glass rounded-2xl p-12 text-center max-w-xl mx-auto my-8">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4 text-sky-400">
            <Film className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">لا توجد فيديوهات مسجلة حتى الآن</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-6">
            ابدأ بتسجيل الشاشة أو الكاميرا بدقة تصل إلى 4K، أو قم بتوليد فيديو اختباري فوري لتجربة القفل بالباسورد، قص الفيديو، تدويره في 4 اتجاهات، والكتابة عليه.
          </p>
          <button
            type="button"
            onClick={handleGenerateSample}
            className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs inline-flex items-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            توليد فيديو استوديو تجريبي الآن
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {videos.map((video) => (
            <div
              key={video.id}
              className="studio-glass rounded-2xl overflow-hidden flex flex-col justify-between transition-all hover:border-sky-400/40"
            >
              <div>
                {/* Thumbnail / Lock Preview */}
                <div
                  onClick={() => handleVideoActionClick(video, 'play')}
                  className="relative aspect-video bg-slate-950 border-b border-slate-800/80 flex items-center justify-center cursor-pointer group overflow-hidden"
                >
                  {video.isLocked ? (
                    <div className="flex flex-col items-center justify-center text-center p-4">
                      <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-2">
                        <Lock className="w-6 h-6" />
                      </div>
                      <span className="text-xs font-bold text-rose-300">ملف فيديو محمي بباسورد</span>
                      <span className="text-[11px] text-slate-400 mt-0.5">
                        اضغط لإدخال الباسورد الثابت للمعاينة أو المونتاج
                      </span>
                    </div>
                  ) : video.thumbnailDataUrl ? (
                    <img
                      src={video.thumbnailDataUrl}
                      alt={video.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <Film className="w-10 h-10 text-slate-600" />
                  )}

                  {!video.isLocked && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-sky-500 text-slate-950 flex items-center justify-center shadow-lg">
                        <Play className="w-5 h-5 fill-current" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div className="p-4">
                  <h3 className="text-sm font-bold text-white truncate mb-1.5" title={video.title}>
                    {video.title}
                  </h3>

                  {/* Clean unboxed metadata per frontend-design zero-pill rule */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono-tabular">
                    <span>{video.resolutionLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>{video.durationSec}s</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(video.sizeBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{video.isLocked ? 'مقفل بباسورد' : 'مفتوح'}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons Bar: Lock, Play, Trim/Rotate/Text Editor, P2P Transfer, Save */}
              <div className="p-3 bg-slate-950/70 border-t border-slate-800/80 grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleVideoActionClick(video, 'play')}
                  title="تشغيل الفيديو"
                  className="py-2 rounded-lg bg-slate-900 hover:bg-sky-500/20 text-slate-200 hover:text-sky-300 text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span className="text-[10px]">تشغيل</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleVideoActionClick(video, 'toggle-lock')}
                  title={video.isLocked ? 'فك قفل الفيديو' : 'قفل الفيديو بباسورد'}
                  className={`py-2 rounded-lg text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                    video.isLocked
                      ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                      : 'bg-slate-900 text-slate-200 hover:bg-amber-500/20 hover:text-amber-300'
                  }`}
                >
                  {video.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  <span className="text-[10px]">{video.isLocked ? 'فك القفل' : 'قفل'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleVideoActionClick(video, 'edit')}
                  title="قص وتدوير والكتابة على الفيديو"
                  className="py-2 rounded-lg bg-slate-900 hover:bg-indigo-500/20 text-slate-200 hover:text-indigo-300 text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span className="text-[10px]">قص ومونتاج</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleVideoActionClick(video, 'transfer')}
                  title="مشاركة فورية للكمبيوتر عبر Wi-Fi P2P"
                  className="py-2 rounded-lg bg-slate-900 hover:bg-emerald-500/20 text-slate-200 hover:text-emerald-300 text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="text-[10px]">نقل Wi-Fi</span>
                </button>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleVideoActionClick(video, 'download')}
                    title="حفظ في مسار مخصص على الجهاز"
                    className="flex-1 h-full py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 flex flex-col items-center justify-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="text-[10px]">حفظ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(video)}
                    title="حذف الفيديو"
                    className="px-2 h-full rounded-lg bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 flex items-center justify-center cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Password Verification Modal */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleVerifyPassword}
            className="w-full max-w-sm studio-glass rounded-2xl p-6 space-y-4 relative"
          >
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="absolute top-4 left-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">الفيديو محمي بباسورد</h3>
                <p className="text-xs text-slate-400">أدخل كلمة المرور الثابتة للمتابعة</p>
              </div>
            </div>

            <input
              type="password"
              autoFocus
              value={enteredPass}
              onChange={(e) => setEnteredPass(e.target.value)}
              placeholder="أدخل الباسورد الثابت..."
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white font-mono-tabular focus:outline-none focus:border-sky-400"
            />

            {passError && <p className="text-xs text-rose-400">{passError}</p>}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs cursor-pointer"
              >
                تأكيد وفتح الفيديو
              </button>
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Video Player Modal */}
      {playingVideo && playingUrl && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-4xl studio-glass rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">{playingVideo.title}</h3>
                <p className="text-xs text-slate-400 font-mono-tabular">
                  {playingVideo.resolutionLabel} · {playingVideo.durationSec}s · {formatBytes(playingVideo.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlayingVideo(null)}
                className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="aspect-video bg-black rounded-xl overflow-hidden flex items-center justify-center">
              <video src={playingUrl} controls autoPlay className="w-full h-full object-contain" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const v = playingVideo;
                    setPlayingVideo(null);
                    onOpenEditor(v);
                  }}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Scissors className="w-4 h-4" />
                  قص وتدوير والكتابة على هذا الفيديو
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const v = playingVideo;
                    setPlayingVideo(null);
                    onOpenTransfer(v);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  مشاركة سريعة للكمبيوتر (WebRTC P2P)
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPlayingVideo(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                إغلاق المشغل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
