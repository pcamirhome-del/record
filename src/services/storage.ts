import { get, set } from 'idb-keyval';
import { VideoRecord } from '../types/recorder';

const VIDEOS_STORE_KEY = 'amir_recorder_pro_videos_v1';
const PASSWORD_STORE_KEY = 'amir_recorder_pro_static_password_v1';

export async function getAllVideos(): Promise<VideoRecord[]> {
  try {
    const list = await get<VideoRecord[]>(VIDEOS_STORE_KEY);
    if (!Array.isArray(list)) return [];
    return list.sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.error('Error loading videos from IndexedDB:', err);
    return [];
  }
}

export async function saveVideoRecord(record: VideoRecord): Promise<VideoRecord[]> {
  const current = await getAllVideos();
  const updated = [record, ...current.filter((v) => v.id !== record.id)];
  await set(VIDEOS_STORE_KEY, updated);
  return updated;
}

export async function updateVideoRecord(
  id: string,
  updater: (prev: VideoRecord) => VideoRecord
): Promise<VideoRecord[]> {
  const current = await getAllVideos();
  const updated = current.map((item) => (item.id === id ? updater(item) : item));
  await set(VIDEOS_STORE_KEY, updated);
  return updated;
}

export async function deleteVideoRecord(id: string): Promise<VideoRecord[]> {
  const current = await getAllVideos();
  const updated = current.filter((item) => item.id !== id);
  await set(VIDEOS_STORE_KEY, updated);
  return updated;
}

export async function getStaticPassword(): Promise<string> {
  const saved = await get<string>(PASSWORD_STORE_KEY);
  return saved || '1234';
}

export async function setStaticPassword(newPass: string): Promise<void> {
  await set(PASSWORD_STORE_KEY, newPass.trim());
}

/**
 * Generates a real sample video via HTML5 Canvas + MediaRecorder if the studio is empty
 * or if the user wants to test 4K editing/P2P transfer immediately.
 */
export async function generateDemoStudioVideo(): Promise<VideoRecord> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas context unavailable'));
      return;
    }

    const stream = canvas.captureStream(30);
    const { mimeType } = getSupportedVideoMimeType();

    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : { videoBitsPerSecond: 6_000_000 }
    );

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    let frame = 0;
    const totalFrames = 90; // 3 seconds at 30fps
    let thumbnailDataUrl = '';

    const drawFrame = () => {
      // Deep studio background
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#0B0F19');
      grad.addColorStop(0.5, '#1E293B');
      grad.addColorStop(1, '#0F172A');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Grid lines
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Animated radar / lens circle
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radius = 110 + Math.sin(frame * 0.15) * 18;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Rotating sweep
      const angle = (frame / totalFrames) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * 160, cy + Math.sin(angle) * 160);
      ctx.strokeStyle = '#F43F5E';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Studio HUD text
      ctx.fillStyle = '#F8FAFC';
      ctx.font = 'bold 38px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AMIR_RECORDER_PRO // LOCAL STUDIO CLIP', cx, cy - 165);

      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 28px monospace';
      const sec = (frame / 30).toFixed(2);
      ctx.fillText(`TIMECODE: 00:00:0${sec} | 1280x720 30FPS`, cx, cy + 195);

      if (frame === 15) {
        thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      }

      frame++;
      if (frame <= totalFrames) {
        requestAnimationFrame(drawFrame);
      } else {
        recorder.stop();
      }
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType });
      const record: VideoRecord = {
        id: `clip_${Date.now()}`,
        title: `تسجيل_تجريبي_استوديو_${new Date().toLocaleTimeString('ar-EG')}`,
        blob,
        mimeType,
        sizeBytes: blob.size,
        durationSec: 3.0,
        width: 1280,
        height: 720,
        resolutionLabel: 'HD 720p',
        sourceType: 'screen-full',
        createdAt: Date.now(),
        isLocked: false,
        thumbnailDataUrl,
      };
      await saveVideoRecord(record);
      resolve(record);
    };

    recorder.start(100);
    drawFrame();
  });
}

const FOLDER_LABEL_KEY = 'amir_recorder_pro_save_folder_label_v1';

export async function getSavedFolderName(): Promise<string> {
  const saved = await get<string>(FOLDER_LABEL_KEY);
  return saved || 'مجلد تنزيلات الجهاز / ألبوم الكاميرا (iPhone Files & Photos)';
}

export async function setSavedFolderName(name: string): Promise<void> {
  await set(FOLDER_LABEL_KEY, name.trim());
}

/**
 * Returns the best supported video mimeType for the current browser (supports iOS Safari video/mp4 & Chrome/Desktop video/webm)
 */
export function getSupportedVideoMimeType(): { mimeType: string; ext: 'mp4' | 'webm' } {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: 'video/mp4', ext: 'mp4' };
  }
  const candidates: Array<{ mime: string; ext: 'mp4' | 'webm' }> = [
    { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];

  // On iOS/iPhone prefer mp4 first so it plays and saves cleanly to iOS Photos / Files
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const ordered = isIOS
    ? candidates
    : [
        candidates[3],
        candidates[4],
        candidates[5],
        candidates[0],
        candidates[1],
        candidates[2],
      ];

  for (const item of ordered) {
    try {
      if (MediaRecorder.isTypeSupported(item.mime)) {
        return { mimeType: item.mime, ext: item.ext };
      }
    } catch {
      // continue
    }
  }
  return { mimeType: '', ext: isIOS ? 'mp4' : 'webm' };
}

/**
 * Saves a video Blob directly to user-selected directory or custom file path
 * on both Mobile (iOS/Android via Web Share File sheet or File Picker) and Desktop PC.
 */
export async function saveBlobToDiskWithPicker(
  blob: Blob,
  suggestedName: string,
  dirHandle?: FileSystemDirectoryHandle | null,
  preferMobileShareSheet = false
): Promise<{ savedPath: string; method: 'directory-handle' | 'file-picker' | 'ios-share' | 'browser-download' }> {
  const isMp4 = blob.type.includes('mp4');
  const defaultExt = isMp4 ? '.mp4' : '.webm';
  const cleanName =
    suggestedName.endsWith('.webm') || suggestedName.endsWith('.mp4') || suggestedName.endsWith('.mov')
      ? suggestedName
      : `${suggestedName.replace(/\.(webm|mp4)$/i, '')}${defaultExt}`;

  // 1. If a pre-selected Directory Handle exists (Desktop / Android Chrome File System Access API)
  if (dirHandle) {
    try {
      const fileHandle = await dirHandle.getFileHandle(cleanName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { savedPath: `${dirHandle.name}/${cleanName}`, method: 'directory-handle' };
    } catch (err) {
      console.warn('Directory handle write failed, falling back to picker:', err);
    }
  }

  // 2. On iPhone / iOS or Mobile when requested, use navigator.share({ files }) so user can choose "Save to Files" (حفظ في الملفات) or "Save Video" (حفظ الفيديو في الاستوديو)
  const isMobileOrIOS = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
  if ((isMobileOrIOS || preferMobileShareSheet) && ' navigator' in window || (isMobileOrIOS && navigator.canShare)) {
    try {
      const file = new File([blob], cleanName, {
        type: blob.type || (isMp4 ? 'video/mp4' : 'video/webm'),
      });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: cleanName,
          text: 'حفظ الفيديو في ملفات الهاتف أو ألبوم الكاميرا',
        });
        return { savedPath: `ملفات الآيفون / الاستوديو (${cleanName})`, method: 'ios-share' };
      }
    } catch (err) {
      // If user dismissed share sheet, fall through to direct download only if not AbortError
      if (err instanceof Error && err.name === 'AbortError') {
        return { savedPath: `تم إلغاء نافذة الاختيار (${cleanName})`, method: 'ios-share' };
      }
    }
  }

  // 3. Try showSaveFilePicker API if supported (Desktop Chrome / Edge)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as unknown as {
        showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({
        suggestedName: cleanName,
        types: [
          {
            description: 'Video File',
            accept: {
              'video/mp4': ['.mp4'],
              'video/webm': ['.webm'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { savedPath: handle.name, method: 'file-picker' };
    } catch (err) {
      console.info('Falling back to direct browser download:', err);
    }
  }

  // 4. Universal fallback download (works on iOS Safari "Download" manager & Desktop)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = cleanName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  const customFolder = await getSavedFolderName();
  return { savedPath: `${customFolder}/${cleanName}`, method: 'browser-download' };
}
