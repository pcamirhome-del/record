export type ResolutionKey = '720p' | '1080p' | '2K' | '4K';

export interface ResolutionConfig {
  label: string;
  width: number;
  height: number;
  bitrate: number;
  badge: string;
}

export const RESOLUTIONS: Record<ResolutionKey, ResolutionConfig> = {
  '720p': {
    label: 'HD 720p',
    width: 1280,
    height: 720,
    bitrate: 5_000_000,
    badge: '1280×720',
  },
  '1080p': {
    label: 'FHD 1080p',
    width: 1920,
    height: 1080,
    bitrate: 12_000_000,
    badge: '1920×1080',
  },
  '2K': {
    label: 'QHD 2K',
    width: 2560,
    height: 1440,
    bitrate: 24_000_000,
    badge: '2560×1440',
  },
  '4K': {
    label: 'UHD 4K',
    width: 3840,
    height: 2160,
    bitrate: 45_000_000,
    badge: '3840×2160',
  },
};

export type CaptureSourceType = 'screen-full' | 'screen-region' | 'camera-rear' | 'camera-front' | 'stealth-rear';

export interface CropRegion {
  x: number; // percentage 0..100
  y: number; // percentage 0..100
  width: number; // percentage 10..100
  height: number; // percentage 10..100
}

export interface VideoRecord {
  id: string;
  title: string;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  resolutionLabel: string;
  sourceType: CaptureSourceType;
  createdAt: number;
  isLocked: boolean;
  thumbnailDataUrl?: string;
  editMetadata?: {
    rotationDeg?: number;
    flipH?: boolean;
    flipV?: boolean;
    overlayText?: string;
    trimmedFrom?: string;
  };
}

export type ActiveTab = 'recorder' | 'stealth' | 'gallery' | 'editor' | 'transfer' | 'architecture';
