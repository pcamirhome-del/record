import React, { useState } from 'react';
import { Download, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);

  if (isInstalled) {
    return (
      <span className="text-xs text-emerald-400 font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5">
        <CheckCircle2 className="w-4 h-4" />
        مثبت على الجهاز
      </span>
    );
  }

  return (
    <>
      <button
        onClick={async () => {
          if (isInstallable) {
            await install();
          } else {
            setShowModal(true);
          }
        }}
        className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
      >
        <Download className="w-4 h-4" />
        تثبيت التطبيق (PWA)
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl studio-glass p-6 text-right relative">
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 left-4 p-2 text-slate-400 hover:text-white rounded-lg"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">تثبيت Amir_Recorder_Pro</h3>
                <p className="text-xs text-slate-400">يعمل أوفلاين 100% كتطبيق سطح مكتب وموبايل</p>
              </div>
            </div>

            {isIOS ? (
              <div className="space-y-3 text-sm text-slate-300 leading-relaxed bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                <p>لتثبيت التطبيق على iPhone أو iPad:</p>
                <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300">
                  <li>اضغط على زر <strong>المشاركة (Share)</strong> في شريط متصفح Safari.</li>
                  <li>مرر للأسفل واختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.</li>
                  <li>اضغط <strong>إضافة (Add)</strong> ليظهر التطبيق بملء الشاشة بدون إنترنت.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-slate-300 leading-relaxed bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                <p>لتثبيت التطبيق مباشرة على الكمبيوتر أو هاتف أندرويد:</p>
                <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300">
                  <li>افتح التطبيق في نافذة متصفح مستقلة (أيقونة الفتح في شريط العنوان أعلى اليمين).</li>
                  <li>اضغط على أيقونة <strong>تثبيت التطبيق (Install Amir_Recorder_Pro)</strong> في شريط العنوان بجوار الرابط.</li>
                  <li>في الموبايل، افتح قائمة المتصفح (⋮) واختر <strong>تثبيت التطبيق (Install App)</strong>.</li>
                </ol>
              </div>
            )}

            <button
              onClick={() => setShowModal(false)}
              className="mt-5 w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
            >
              حسناً، فهمت
            </button>
          </div>
        </div>
      )}
    </>
  );
};
