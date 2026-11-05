import React, { useState } from 'react';
import { FolderTree, Smartphone, Rocket, Copy, CheckCircle2, Code2, ShieldCheck } from 'lucide-react';

const FOLDER_STRUCTURE = `Amir_Recorder_Pro/
├── android/                                   # مشروع Capacitor Android Native
│   └── app/src/main/
│       ├── AndroidManifest.xml                # صلاحيات الكاميرا الخلفية، ForegroundService، وأزرار الصوت
│       ├── java/com/amir/recorderpro/
│       │   ├── MainActivity.kt                # ربط Capacitor Bridge
│       │   ├── StealthCameraPlugin.kt         # Capacitor Native Plugin للتسجيل الخفي
│       │   ├── StealthCameraService.kt        # خدمة ForegroundService + Camera2 API بدون واجهة أو صوت
│       │   └── VolumeKeyAccessibilityService.kt # التقاط ضغطتين خفض الصوت (بدء) وضغطة رفع الصوت (إيقاف)
│       └── res/xml/accessibility_service_config.xml
├── public/
│   ├── icon.svg                               # شعار الاستوديو
│   ├── pwa-192x192.png                        # أيقونة تثبيت الموبايل
│   └── pwa-512x512.png                        # أيقونة تثبيت سطح المكتب
├── src/
│   ├── components/
│   │   ├── StudioRecorder.tsx                 # تسجيل الشاشة، منطقة مخصصة، والكاميرا بدقة 4K
│   │   ├── StealthCameraHub.tsx               # وحدة التحكم بالتصوير الخفي وأزرار الصوت
│   │   ├── LocalGallery.tsx                   # استوديو الفيديوهات المحلي وقفل الباسورد الثابت
│   │   ├── VideoEditor.tsx                    # قص، تدوير 4 اتجاهات، والكتابة عبر FFmpeg.wasm / Canvas
│   │   ├── P2PTransferHub.tsx                 # نقل الفيديو عبر الـ Wi-Fi المحلي WebRTC P2P
│   │   └── PWAInstallButton.tsx               # زر التثبيت المباشر على الموبايل والكمبيوتر
│   ├── services/
│   │   ├── storage.ts                         # IndexedDB + File System Access API
│   │   └── ffmpegService.ts                   # محرك المونتاج المحلي بدون سحابة
│   ├── App.tsx
│   └── main.tsx
├── capacitor.config.ts                        # إعدادات بناء تطبيق الأندرويد الهجين
├── vite.config.ts                             # إعدادات Vite + VitePWA للعمل أوفلاين 100%
└── vercel.json                                # إعدادات الاستضافة المباشرة وترويسات COOP/COEP`;

const ANDROID_VOLUME_SERVICE_CODE = `// المسار: android/app/src/main/java/com/amir/recorderpro/VolumeKeyAccessibilityService.kt
package com.amir.recorderpro

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

class VolumeKeyAccessibilityService : AccessibilityService() {

    private var lastVolumeDownTime: Long = 0
    private val DOUBLE_PRESS_INTERVAL = 600L // 600ms لضغطتين متتاليتين

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return false

        when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_DOWN -> {
                val now = SystemClock.elapsedRealtime()
                if (now - lastVolumeDownTime <= DOUBLE_PRESS_INTERVAL) {
                    // ضغطتان متتاليتان على زر خفض الصوت -> بدء التسجيل الخفي فوراً بدون فتح الكاميرا
                    val startIntent = Intent(this, StealthCameraService::class.java).apply {
                        action = StealthCameraService.ACTION_START_STEALTH_RECORDING
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(startIntent)
                    } else {
                        startService(startIntent)
                    }
                    lastVolumeDownTime = 0L
                    return true // منع ظهور شريط الصوت عند البدء
                }
                lastVolumeDownTime = now
            }

            KeyEvent.KEYCODE_VOLUME_UP -> {
                // ضغطة واحدة على زر رفع الصوت -> إيقاف التسجيل وحفظ الفيديو في الاستوديو
                if (StealthCameraService.isRunning) {
                    val stopIntent = Intent(this, StealthCameraService::class.java).apply {
                        action = StealthCameraService.ACTION_STOP_STEALTH_RECORDING
                    }
                    startService(stopIntent)
                    return true
                }
            }
        }
        return super.onKeyEvent(event)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}
}`;

const ANDROID_STEALTH_CAMERA_SERVICE = `// المسار: android/app/src/main/java/com/amir/recorderpro/StealthCameraService.kt
package com.amir.recorderpro

import android.annotation.SuppressLint
import android.app.*
import android.content.Context
import android.content.Intent
import android.hardware.camera2.*
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.*
import androidx.core.app.NotificationCompat
import java.io.File

class StealthCameraService : Service() {

    companion object {
        const val ACTION_START_STEALTH_RECORDING = "START_STEALTH"
        const val ACTION_STOP_STEALTH_RECORDING = "STOP_STEALTH"
        @Volatile var isRunning = false
    }

    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var mediaRecorder: MediaRecorder? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_STEALTH_RECORDING -> if (!isRunning) startStealthSession()
            ACTION_STOP_STEALTH_RECORDING -> stopStealthSession()
        }
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startStealthSession() {
        isRunning = true
        acquirePartialWakeLock() // استمرار التسجيل حتى بعد قفل شاشة الموبايل
        muteShutterSound()       // كتم صوت غالق الكاميرا نهائياً
        startSilentForegroundNotification()

        val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val rearCameraId = manager.cameraIdList.first { id ->
            manager.getCameraCharacteristics(id)
                .get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
        }

        setupMediaRecorder4K()
        manager.openCamera(rearCameraId, object : CameraDevice.StateCallback() {
            override fun onOpened(camera: CameraDevice) {
                cameraDevice = camera
                val surface = mediaRecorder!!.surface
                val requestBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                    addTarget(surface)
                }
                camera.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        captureSession = session
                        session.setRepeatingRequest(requestBuilder.build(), null, null)
                        mediaRecorder?.start()
                    }
                    override fun onConfigureFailed(session: CameraCaptureSession) {}
                }, null)
            }
            override fun onDisconnected(camera: CameraDevice) { stopStealthSession() }
            override fun onError(camera: CameraDevice, error: Int) { stopStealthSession() }
        }, null)
    }

    private fun setupMediaRecorder4K() {
        val outputDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM)
        val outFile = File(outputDir, "AmirRec_Stealth_\${System.currentTimeMillis()}.mp4")

        mediaRecorder = MediaRecorder().apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setVideoSource(MediaRecorder.VideoSource.SURFACE)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setOutputFile(outFile.absolutePath)
            setVideoEncodingBitRate(42_000_000) // 42 Mbps True 4K
            setVideoFrameRate(60)
            setVideoSize(3840, 2160)
            setVideoEncoder(MediaRecorder.VideoEncoder.HEVC)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            prepare()
        }
    }

    private fun startSilentForegroundNotification() {
        val channelId = "stealth_silent_channel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // IMPORTANCE_MIN يخفي الإشعار من شريط الحالة العلوي ولا يصدر أي صوت أو اهتزاز
            val channel = NotificationChannel(channelId, "System Sync", NotificationManager.IMPORTANCE_MIN).apply {
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_SECRET
            }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("")
            .setContentText("")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .build()

        startForeground(9001, notification)
    }

    private fun muteShutterSound() {
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_MUTE, 0)
    }

    private fun acquirePartialWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AmirRecorder::StealthWakeLock").apply {
            acquire(2 * 60 * 60 * 1000L)
        }
    }

    private fun stopStealthSession() {
        if (!isRunning) return
        isRunning = false
        try {
            captureSession?.stopRepeating()
            captureSession?.close()
            mediaRecorder?.stop()
            mediaRecorder?.release()
            cameraDevice?.close()
            wakeLock?.release()
        } catch (_: Exception) {}
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}`;

const DEPLOYMENT_GUIDE = `# 1. خطوات رفع المشروع على GitHub واستضافته على Vercel:
git init
git add .
git commit -m "feat: release Amir_Recorder_Pro 4K PWA & Capacitor Studio"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/Amir_Recorder_Pro.git
git push -u origin main

# 2. ملف vercel.json (لدعم ترويسات SharedArrayBuffer الخاصة بـ FFmpeg.wasm):
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}

# 3. تحويل المشروع إلى تطبيق أندرويد APK عبر Capacitor:
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init Amir_Recorder_Pro com.amir.recorderpro --web-dir dist
npm run build
npx cap add android
npx cap sync android
npx cap open android

# 4. أمر ADB لإخفاء أيقونات الإشعارات الصامتة تماماً بدون روت:
adb shell cmd notification allow_listener com.amir.recorderpro/.VolumeKeyAccessibilityService
adb shell appops set com.amir.recorderpro SYSTEM_ALERT_WINDOW allow`;

export const ArchitectureGuide: React.FC = () => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyCode = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  return (
    <div className="space-y-6">
      <div className="studio-glass rounded-2xl p-6 glow-edge-cyan">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400">
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              هيكل المشروع الكامل + أكواد Capacitor Android Native + خطوات الرفع على GitHub & Vercel
            </h2>
            <p className="text-xs text-slate-400">
              جميع المخرجات البرمجية لهندسة Amir_Recorder_Pro الهجينة (PWA + Native Background Camera2 + Volume Hardware Keys)
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Project Folder Structure */}
        <div className="studio-glass rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-sky-300 flex items-center gap-2">
                <FolderTree className="w-4 h-4" />
                1. هيكل المشروع الكامل (Folder Structure)
              </span>
              <button
                type="button"
                onClick={() => copyCode(FOLDER_STRUCTURE, 1)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                {copiedIndex === 1 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                نسخ
              </button>
            </div>
            <pre
              dir="ltr"
              className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono-tabular overflow-x-auto leading-relaxed"
            >
              {FOLDER_STRUCTURE}
            </pre>
          </div>
        </div>

        {/* 2. GitHub, Vercel & Capacitor Build Steps */}
        <div className="studio-glass rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                <Rocket className="w-4 h-4" />
                2. خطوات الرفع على GitHub و Vercel وبناء APK
              </span>
              <button
                type="button"
                onClick={() => copyCode(DEPLOYMENT_GUIDE, 2)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                {copiedIndex === 2 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                نسخ
              </button>
            </div>
            <pre
              dir="ltr"
              className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono-tabular overflow-x-auto leading-relaxed"
            >
              {DEPLOYMENT_GUIDE}
            </pre>
          </div>
        </div>

        {/* 3. Android Volume Key Accessibility Service */}
        <div className="studio-glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-indigo-300 flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              3. كود التقاط أزرار الصوت (Volume Down ×2 & Volume Up ×1)
            </span>
            <button
              type="button"
              onClick={() => copyCode(ANDROID_VOLUME_SERVICE_CODE, 3)}
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1 cursor-pointer"
            >
              {copiedIndex === 3 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              نسخ الكود
            </button>
          </div>
          <pre
            dir="ltr"
            className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono-tabular overflow-x-auto max-h-96 leading-relaxed"
          >
            {ANDROID_VOLUME_SERVICE_CODE}
          </pre>
        </div>

        {/* 4. Android Stealth Background Camera2 Service */}
        <div className="studio-glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-rose-300 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              4. كود خدمة الكاميرا الخلفية المخفية (Camera2 4K ForegroundService)
            </span>
            <button
              type="button"
              onClick={() => copyCode(ANDROID_STEALTH_CAMERA_SERVICE, 4)}
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1 cursor-pointer"
            >
              {copiedIndex === 4 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              نسخ الكود
            </button>
          </div>
          <pre
            dir="ltr"
            className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono-tabular overflow-x-auto max-h-96 leading-relaxed"
          >
            {ANDROID_STEALTH_CAMERA_SERVICE}
          </pre>
        </div>
      </div>
    </div>
  );
};
