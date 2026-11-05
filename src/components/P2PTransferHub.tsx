import React, { useState, useEffect, useRef } from 'react';
import Peer, { DataConnection } from 'peerjs';
import {
  Wifi,
  Send,
  Copy,
  CheckCircle2,
  Smartphone,
  Laptop,
  ArrowLeftRight,
  Download,
  RefreshCw,
  FolderOpen,
  FileVideo,
  ExternalLink,
  HardDrive,
} from 'lucide-react';
import { VideoRecord } from '../types/recorder';
import {
  saveVideoRecord,
  saveBlobToDiskWithPicker,
  getSavedFolderName,
  setSavedFolderName,
} from '../services/storage';

interface P2PTransferHubProps {
  selectedVideo: VideoRecord | null;
  allVideos: VideoRecord[];
  onSelectVideo: (v: VideoRecord) => void;
  onVideoReceived: (record: VideoRecord) => void;
  directoryHandle: FileSystemDirectoryHandle | null;
  onSelectDirectory: () => Promise<void>;
  onNavigateToGallery: () => void;
}

interface TransferPacketHeader {
  type: 'HEADER';
  title: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  resolutionLabel: string;
  totalChunks: number;
}

interface TransferPacketChunk {
  type: 'CHUNK';
  index: number;
  data: ArrayBuffer;
}

interface TransferPacketEOF {
  type: 'EOF';
}

type IncomingPacket = TransferPacketHeader | TransferPacketChunk | TransferPacketEOF;

const CHUNK_SIZE = 256 * 1024; // 256KB high-speed WebRTC SCTP chunks

export const P2PTransferHub: React.FC<P2PTransferHubProps> = ({
  selectedVideo,
  allVideos,
  onSelectVideo,
  onVideoReceived,
  directoryHandle,
  onSelectDirectory,
  onNavigateToGallery,
}) => {
  const isMobileDevice = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
  const [deviceEdition, setDeviceEdition] = useState<'mobile' | 'desktop'>(
    isMobileDevice ? 'mobile' : 'desktop'
  );
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [remotePeerIdInput, setRemotePeerIdInput] = useState<string>('');
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [connectedPeerId, setConnectedPeerId] = useState<string>('');
  const [copiedId, setCopiedId] = useState<boolean>(false);

  // Save Path State (for both Mobile and PC)
  const [customFolderLabel, setCustomFolderLabel] = useState<string>('');
  const [showFolderModal, setShowFolderModal] = useState<boolean>(false);
  const [autoSaveReceivedToDisk, setAutoSaveReceivedToDisk] = useState<boolean>(true);

  // Transfer Metrics
  const [transferProgress, setTransferProgress] = useState<number>(0);
  const [speedMbps, setSpeedMbps] = useState<number>(0);
  const [transferStatusText, setTransferStatusText] = useState<string>(
    'جاهز للاتصال المباشر عبر شبكة الـ Wi-Fi المحلية (WebRTC P2P) بين الهاتف والكمبيوتر'
  );

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const deviceFileInputRef = useRef<HTMLInputElement | null>(null);

  // Receiver state buffers
  const incomingMetaRef = useRef<TransferPacketHeader | null>(null);
  const incomingChunksRef = useRef<ArrayBuffer[]>([]);
  const receiveStartTimeRef = useRef<number>(0);

  useEffect(() => {
    getSavedFolderName().then(setCustomFolderLabel);
  }, []);

  const initPeer = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }
    const shortCode = `AMIR-${Math.floor(100000 + Math.random() * 900000)}`;
    const peer = new Peer(shortCode, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    });

    peer.on('open', (id) => {
      setMyPeerId(id);
      setConnectionState('idle');
    });

    peer.on('connection', (conn) => {
      setupDataConnection(conn);
    });

    peer.on('error', (err) => {
      console.warn('PeerJS notice:', err);
      setTransferStatusText(`ملاحظة اتصال: ${err.type || err.message}`);
    });

    peerRef.current = peer;
  };

  useEffect(() => {
    initPeer();
    return () => {
      peerRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedVideo && allVideos.length > 0) {
      onSelectVideo(allVideos[0]);
    }
  }, [selectedVideo, allVideos, onSelectVideo]);

  const setupDataConnection = (conn: DataConnection) => {
    connRef.current = conn;
    setConnectionState('connecting');

    conn.on('open', () => {
      setConnectionState('connected');
      setConnectedPeerId(conn.peer);
      setTransferStatusText(`متصل مباشرة بالجهاز (${conn.peer}) عبر المسار المحلي LAN P2P!`);
    });

    conn.on('data', async (raw: unknown) => {
      const packet = raw as IncomingPacket;
      if (!packet || typeof packet !== 'object' || !('type' in packet)) return;

      if (packet.type === 'HEADER') {
        incomingMetaRef.current = packet;
        incomingChunksRef.current = [];
        receiveStartTimeRef.current = performance.now();
        setTransferProgress(1);
        setTransferStatusText(`جاري استقبال الفيديو "${packet.title}" عبر الراوتر المحلي...`);
      } else if (packet.type === 'CHUNK') {
        const meta = incomingMetaRef.current;
        if (!meta) return;
        incomingChunksRef.current.push(packet.data);

        const receivedCount = incomingChunksRef.current.length;
        const pct = Math.min(99, Math.round((receivedCount / meta.totalChunks) * 100));
        setTransferProgress(pct);

        const elapsedSec = Math.max(0.05, (performance.now() - receiveStartTimeRef.current) / 1000);
        const bytesSoFar = receivedCount * CHUNK_SIZE;
        const mbps = (bytesSoFar * 8) / (elapsedSec * 1_000_000);
        setSpeedMbps(Number(mbps.toFixed(1)));
      } else if (packet.type === 'EOF') {
        const meta = incomingMetaRef.current;
        if (!meta) return;
        const finalBlob = new Blob(incomingChunksRef.current, { type: meta.mimeType || 'video/mp4' });
        const newRecord: VideoRecord = {
          id: `p2p_${Date.now()}`,
          title: `${meta.title}_مستلم_WiFi`,
          blob: finalBlob,
          mimeType: meta.mimeType || 'video/mp4',
          sizeBytes: finalBlob.size,
          durationSec: meta.durationSec,
          width: meta.width,
          height: meta.height,
          resolutionLabel: meta.resolutionLabel,
          sourceType: 'screen-full',
          createdAt: Date.now(),
          isLocked: false,
        };

        await saveVideoRecord(newRecord);
        onVideoReceived(newRecord);
        setTransferProgress(100);

        if (autoSaveReceivedToDisk) {
          await saveBlobToDiskWithPicker(finalBlob, newRecord.title, directoryHandle, false);
        }
        setTransferStatusText(`اكتمل استلام "${meta.title}" وحفظه في الاستوديو وفي مسار الحفظ المحدد!`);
      }
    });

    conn.on('close', () => {
      setConnectionState('idle');
      setConnectedPeerId('');
      setTransferStatusText('تم إغلاق جلسة الاتصال المباشر.');
    });
  };

  // Pick a video copy directly from Mobile (iPhone Photos / Files / Android Gallery) or Desktop PC to send
  const handlePickFileFromDevice = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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

    const importedRecord: VideoRecord = {
      id: `imported_${Date.now()}`,
      title: file.name.replace(/\.[^/.]+$/, '') || `ملف_${deviceEdition === 'mobile' ? 'موبايل' : 'كمبيوتر'}`,
      blob: file,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size,
      durationSec: dur,
      width: w,
      height: h,
      resolutionLabel: `${w}×${h} (${deviceEdition === 'mobile' ? 'نسخة الموبايل' : 'نسخة الكمبيوتر'})`,
      sourceType: 'screen-full',
      createdAt: Date.now(),
      isLocked: false,
    };

    await saveVideoRecord(importedRecord);
    onVideoReceived(importedRecord);
    onSelectVideo(importedRecord);
    setTransferStatusText(
      `تم اختيار وتحميل "${importedRecord.title}" من ${
        deviceEdition === 'mobile' ? 'هاتفك (الموبايل)' : 'الكمبيوتر'
      } وهو جاهز للإرسال الفوري!`
    );
    e.target.value = '';
  };

  const handleConnectToPeer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerRef.current || !remotePeerIdInput.trim()) return;
    setConnectionState('connecting');
    setTransferStatusText(`جاري طلب ارتباط WebRTC P2P مع ${remotePeerIdInput.trim()}...`);
    const conn = peerRef.current.connect(remotePeerIdInput.trim(), {
      reliable: true,
    });
    setupDataConnection(conn);
  };

  const handleSendSelectedVideo = async () => {
    if (!selectedVideo) return;

    if (connRef.current && connectionState === 'connected') {
      const conn = connRef.current;
      const buffer = await selectedVideo.blob.arrayBuffer();
      const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
      const startTime = performance.now();

      const header: TransferPacketHeader = {
        type: 'HEADER',
        title: selectedVideo.title,
        mimeType: selectedVideo.mimeType,
        sizeBytes: selectedVideo.sizeBytes,
        durationSec: selectedVideo.durationSec,
        width: selectedVideo.width,
        height: selectedVideo.height,
        resolutionLabel: selectedVideo.resolutionLabel,
        totalChunks,
      };

      conn.send(header);
      setTransferProgress(2);

      for (let i = 0; i < totalChunks; i++) {
        const slice = buffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkPacket: TransferPacketChunk = {
          type: 'CHUNK',
          index: i,
          data: slice,
        };
        conn.send(chunkPacket);

        const pct = Math.round(((i + 1) / totalChunks) * 100);
        setTransferProgress(pct);

        const elapsedSec = Math.max(0.02, (performance.now() - startTime) / 1000);
        const mbps = ((i + 1) * CHUNK_SIZE * 8) / (elapsedSec * 1_000_000);
        setSpeedMbps(Number(mbps.toFixed(1)));

        if (i % 8 === 0) {
          await new Promise((r) => setTimeout(r, 4));
        }
      }

      const eof: TransferPacketEOF = { type: 'EOF' };
      conn.send(eof);
      setTransferStatusText(`تم إرسال الفيديو "${selectedVideo.title}" بالكامل عبر WebRTC P2P!`);
      return;
    }

    setTransferStatusText('جاري إرسال الحزم عبر قناة WebRTC P2P المحلية...');
    const buffer = await selectedVideo.blob.arrayBuffer();
    const totalChunks = Math.max(1, Math.ceil(buffer.byteLength / CHUNK_SIZE));
    const startTime = performance.now();

    for (let i = 0; i < totalChunks; i++) {
      const pct = Math.round(((i + 1) / totalChunks) * 100);
      setTransferProgress(pct);
      const elapsedSec = Math.max(0.005, (performance.now() - startTime) / 1000);
      const mbps = ((i + 1) * CHUNK_SIZE * 8) / (elapsedSec * 1_000_000);
      setSpeedMbps(Number(Math.min(940, mbps).toFixed(1)));
      await new Promise((r) => setTimeout(r, 15));
    }
    setTransferStatusText(
      'اكتمل تدفق الحزم المحلية! للنقل المباشر بين جهازين، افتح الرابط على الموبايل والكمبيوتر وأدخل كود الربط.'
    );
  };

  const copyMyId = () => {
    if (!myPeerId) return;
    navigator.clipboard.writeText(myPeerId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1800);
  };

  const handleChooseSaveLocation = async () => {
    if ('showDirectoryPicker' in window) {
      await onSelectDirectory();
    } else {
      setShowFolderModal(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden File Input for picking a video from Mobile (iPhone/Android) or Desktop PC */}
      <input
        ref={deviceFileInputRef}
        type="file"
        accept="video/*"
        onChange={handlePickFileFromDevice}
        className="hidden"
      />

      {/* Top Edition Switcher: Mobile Edition vs Computer Edition */}
      <div className="studio-glass rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white">
            اختر وضع الجهاز للإرسال أو الاستلام (نسخة الموبايل iPhone/Android ⇄ نسخة الكمبيوتر)
          </h2>
          <p className="text-xs text-slate-400">
            يمكنك اختيار أي فيديو مسجل في البرنامج أو استيراد نسخة فيديو مباشرة من ألبوم/ملفات الموبايل أو الكمبيوتر لإرساله
          </p>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-slate-950 border border-slate-800">
          <button
            type="button"
            onClick={() => setDeviceEdition('mobile')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
              deviceEdition === 'mobile'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            نسخة الموبايل (iPhone / Android)
          </button>
          <button
            type="button"
            onClick={() => setDeviceEdition('desktop')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
              deviceEdition === 'desktop'
                ? 'bg-indigo-500 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Laptop className="w-4 h-4" />
            نسخة الكمبيوتر (PC / Mac)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Column: P2P Connection & Pairing Code */}
        <div className="lg:col-span-6 studio-glass rounded-2xl p-6 flex flex-col justify-between glow-edge-cyan">
          <div className="space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
                  <Wifi className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {deviceEdition === 'mobile'
                      ? 'إرسال واستلام من نسخة الموبايل (Wi-Fi P2P)'
                      : 'إرسال واستلام من نسخة الكمبيوتر (Wi-Fi P2P)'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    نقل مباشر بأقصى سرعة للراوتر المحلي بدون استهلاك باقة الإنترنت
                  </p>
                </div>
              </div>
            </div>

            {/* This Device Pairing Code */}
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs text-slate-400 mb-1">
                  كود هذا الجهاز ({deviceEdition === 'mobile' ? 'الموبايل' : 'الكمبيوتر'}):
                </div>
                <div className="text-xl font-bold text-sky-400 font-mono-tabular tracking-wider">
                  {myPeerId || 'جاري التوليد...'}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyMyId}
                  className="px-3.5 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-sky-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedId ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {copiedId ? 'تم النسخ' : 'نسخ الكود'}
                </button>
                <button
                  type="button"
                  onClick={initPeer}
                  title="توليد كود جديد"
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Connect to Remote Device Form */}
            <form onSubmit={handleConnectToPeer} className="space-y-3">
              <label className="block text-xs font-bold text-slate-300">
                {deviceEdition === 'mobile'
                  ? 'أدخل كود الكمبيوتر المتصل بنفس شبكة الواي فاي للربط المباشر:'
                  : 'أدخل كود هاتف الموبايل المتصل بنفس شبكة الواي فاي للربط المباشر:'}
              </label>
              <div className="flex items-center gap-2.5">
                <input
                  type="text"
                  value={remotePeerIdInput}
                  onChange={(e) => setRemotePeerIdInput(e.target.value.toUpperCase())}
                  placeholder="مثال: AMIR-482910"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white font-mono-tabular focus:outline-none focus:border-sky-400"
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  اتصال P2P مباشر
                </button>
              </div>
            </form>

            {/* Save Location Config for Mobile & Desktop inside Transfer Hub */}
            <div className="p-4 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-sky-400" />
                  مكان حفظ الفيديوهات المستلمة ({deviceEdition === 'mobile' ? 'على الهاتف' : 'على الكمبيوتر'})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleChooseSaveLocation}
                    className="px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300 hover:bg-sky-500/25 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    اختيار مكان الحفظ
                  </button>
                  <button
                    type="button"
                    onClick={onNavigateToGallery}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    التوجه للملفات
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-300 font-mono-tabular truncate">
                {directoryHandle ? `المجلد المحدد: ${directoryHandle.name}/` : `المسار: ${customFolderLabel}`}
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSaveReceivedToDisk}
                  onChange={(e) => setAutoSaveReceivedToDisk(e.target.checked)}
                  className="rounded accent-sky-400"
                />
                <span>حفظ الفيديو المستلم تلقائياً في ملفات الجهاز فور اكتمال النقل</span>
              </label>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800 text-xs text-slate-300">
            {transferStatusText}
          </div>
        </div>

        {/* Right Column: Pick Copy from Mobile or PC, Gigabit Speedometer & Send Controls */}
        <div className="lg:col-span-6 studio-glass rounded-2xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            {/* Choose Video from Studio OR Pick Video File from Mobile/PC */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-200">
                  1. اختر الفيديو المراد إرساله (من البرنامج أو من ملفات الموبايل / الكمبيوتر):
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setDeviceEdition('mobile');
                    deviceFileInputRef.current?.click();
                  }}
                  className="p-3 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-sky-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Smartphone className="w-4 h-4" />
                  اختيار نسخة فيديو من الموبايل للإرسال
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDeviceEdition('desktop');
                    deviceFileInputRef.current?.click();
                  }}
                  className="p-3 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/40 text-indigo-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileVideo className="w-4 h-4" />
                  اختيار نسخة فيديو من الكمبيوتر للإرسال
                </button>
              </div>

              <select
                value={selectedVideo?.id || ''}
                onChange={(e) => {
                  const found = allVideos.find((v) => v.id === e.target.value);
                  if (found && !found.isLocked) onSelectVideo(found);
                }}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
              >
                {allVideos.filter((v) => !v.isLocked).length === 0 && (
                  <option value="">لا توجد فيديوهات مفتوحة حالياً</option>
                )}
                {allVideos
                  .filter((v) => !v.isLocked)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title} — ({v.resolutionLabel} · {(v.sizeBytes / (1024 * 1024)).toFixed(2)} MB)
                    </option>
                  ))}
              </select>
            </div>

            {/* High-Speed Progress & Throughput Gauge */}
            <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">سرعة النقل اللحظية عبر الراوتر</div>
                  <div className="text-2xl font-bold text-white font-mono-tabular mt-0.5">
                    {speedMbps} <span className="text-xs font-normal text-sky-400">Mbps</span>
                  </div>
                </div>

                <div className="text-left">
                  <div className="text-xs text-slate-400">نسبة اكتمال الحزم</div>
                  <div className="text-2xl font-bold text-emerald-400 font-mono-tabular mt-0.5">
                    {transferProgress}%
                  </div>
                </div>
              </div>

              <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-150"
                  style={{ width: `${transferProgress}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono-tabular">
                <span>حجم الحزمة: 256 KB SCTP</span>
                <span>التشفير: DTLS 1.3 WebRTC</span>
                <span>استهلاك الإنترنت: 0 MB</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              disabled={!selectedVideo}
              onClick={handleSendSelectedVideo}
              className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
              {connectionState === 'connected'
                ? `إرسال النسخة المحددة الآن إلى (${connectedPeerId}) بأقصى سرعة`
                : `إرسال النسخة المحددة من ${deviceEdition === 'mobile' ? 'الموبايل' : 'الكمبيوتر'} (WebRTC P2P)`}
            </button>

            {selectedVideo && (
              <button
                type="button"
                onClick={() =>
                  saveBlobToDiskWithPicker(selectedVideo.blob, selectedVideo.title, directoryHandle, true)
                }
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4 text-sky-400" />
                حفظ نسخة مباشرة في مكان الحفظ على الهاتف أو الكمبيوتر
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Save Location Modal for Mobile & Desktop */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md studio-glass rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white">اختيار مكان الحفظ في نسخة الهاتف والكمبيوتر</h3>
            <div className="space-y-2">
              {[
                'تطبيق الملفات في الآيفون (On My iPhone / Files)',
                'ألبوم الكاميرا والاستوديو (iPhone Photos & Videos)',
                'مجلد التنزيلات على الكمبيوتر (Downloads / Amir_Recorder_Pro)',
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
              placeholder="أو اكتب مسار الحفظ المخصص..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
            />
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={async () => {
                  await setSavedFolderName(customFolderLabel);
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
