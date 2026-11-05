/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { ActiveTab, VideoRecord } from './types/recorder';
import { getAllVideos, generateDemoStudioVideo } from './services/storage';
import { PWAInstallButton } from './components/PWAInstallButton';
import { StudioRecorder } from './components/StudioRecorder';
import { StealthCameraHub } from './components/StealthCameraHub';
import { LocalGallery } from './components/LocalGallery';
import { VideoEditor } from './components/VideoEditor';
import { P2PTransferHub } from './components/P2PTransferHub';
import { ArchitectureGuide } from './components/ArchitectureGuide';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('recorder');
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [selectedVideoForEdit, setSelectedVideoForEdit] = useState<VideoRecord | null>(null);
  const [selectedVideoForTransfer, setSelectedVideoForTransfer] = useState<VideoRecord | null>(null);
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);

  const loadStoredVideos = useCallback(async () => {
    let list = await getAllVideos();
    if (list.length === 0) {
      try {
        const initialDemo = await generateDemoStudioVideo();
        list = [initialDemo];
      } catch {
        // ignore if canvas stream restricted
      }
    }
    setVideos(list);
    if (list.length > 0) {
      setSelectedVideoForEdit((prev) => prev || list[0]);
      setSelectedVideoForTransfer((prev) => prev || list[0]);
    }
  }, []);

  useEffect(() => {
    loadStoredVideos();
  }, [loadStoredVideos]);

  const handleVideoSaved = (newRecord: VideoRecord) => {
    setVideos((prev) => [newRecord, ...prev.filter((v) => v.id !== newRecord.id)]);
    if (!newRecord.isLocked) {
      setSelectedVideoForEdit(newRecord);
      setSelectedVideoForTransfer(newRecord);
    }
  };

  const handleSelectDirectory = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as unknown as {
          showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker({ mode: 'readwrite' });
        setDirectoryHandle(handle);
      } catch {
        // User canceled or running inside cross-origin iframe where File Picker falls back on save
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F19] text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/80 studio-glass sticky top-0 z-40">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#recorder"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('recorder');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Amir_Recorder_Pro
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <a
            href="#recorder"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('recorder');
            }}
            className={`hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 pb-1 ${
              activeTab === 'recorder' ? 'text-sky-400 border-b-2 border-sky-400 font-bold' : ''
            }`}
          >
            مسجل الشاشة 4K
          </a>
          <a
            href="#stealth"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('stealth');
            }}
            className={`hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 pb-1 ${
              activeTab === 'stealth' ? 'text-sky-400 border-b-2 border-sky-400 font-bold' : ''
            }`}
          >
            الكاميرا الخفية
          </a>
          <a
            href="#gallery"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('gallery');
            }}
            className={`hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 pb-1 ${
              activeTab === 'gallery' ? 'text-sky-400 border-b-2 border-sky-400 font-bold' : ''
            }`}
          >
            الاستوديو ({videos.length})
          </a>
          <a
            href="#editor"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('editor');
            }}
            className={`hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 pb-1 ${
              activeTab === 'editor' ? 'text-sky-400 border-b-2 border-sky-400 font-bold' : ''
            }`}
          >
            قص ومونتاج
          </a>
          <a
            href="#transfer"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('transfer');
            }}
            className={`hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 pb-1 ${
              activeTab === 'transfer' ? 'text-sky-400 border-b-2 border-sky-400 font-bold' : ''
            }`}
          >
            نقل P2P Wi-Fi
          </a>
        </nav>

        {/* Zone 3: 1 primary action (PWA Install Button) */}
        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton />
        </div>
      </header>

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Secondary Mode Selector & Native Code Switcher inside Workspace */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-800/60">
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900/90 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('recorder')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'recorder'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              1. التسجيل (شاشة / جزء / كاميرا)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('stealth')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'stealth'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              2. التصوير الخفي (أزرار الصوت)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('gallery')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'gallery'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              3. الفيديوهات المحفوظة والقفل ({videos.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'editor'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              4. المونتاج (قص · تدوير 4 اتجاهات · كتابة)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('transfer')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'transfer'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              5. مشاركة سريعة للكمبيوتر (WebRTC P2P)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('architecture')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'architecture'
                  ? 'bg-indigo-500 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              6. أكواد Capacitor Native والنشر
            </button>
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>حفظ محلي 100% بدون سحابة</span>
            <span aria-hidden="true">·</span>
            <span>IndexedDB & File System API</span>
          </div>
        </div>

        {/* Active View Content */}
        {activeTab === 'recorder' && (
          <StudioRecorder
            onVideoSaved={handleVideoSaved}
            directoryHandle={directoryHandle}
            onSelectDirectory={handleSelectDirectory}
          />
        )}

        {activeTab === 'stealth' && (
          <StealthCameraHub
            onVideoSaved={handleVideoSaved}
            onOpenNativeDocs={() => setActiveTab('architecture')}
          />
        )}

        {activeTab === 'gallery' && (
          <LocalGallery
            videos={videos}
            onRefreshVideos={setVideos}
            onOpenEditor={(video) => {
              setSelectedVideoForEdit(video);
              setActiveTab('editor');
            }}
            onOpenTransfer={(video) => {
              setSelectedVideoForTransfer(video);
              setActiveTab('transfer');
            }}
            directoryHandle={directoryHandle}
          />
        )}

        {activeTab === 'editor' && (
          <VideoEditor
            selectedVideo={selectedVideoForEdit}
            allVideos={videos}
            onSelectVideo={setSelectedVideoForEdit}
            onVideoSaved={handleVideoSaved}
            directoryHandle={directoryHandle}
          />
        )}

        {activeTab === 'transfer' && (
          <P2PTransferHub
            selectedVideo={selectedVideoForTransfer}
            allVideos={videos}
            onSelectVideo={setSelectedVideoForTransfer}
            onVideoReceived={handleVideoSaved}
            directoryHandle={directoryHandle}
          />
        )}

        {activeTab === 'architecture' && <ArchitectureGuide />}
      </main>
    </div>
  );
}
