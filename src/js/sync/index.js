export { CloudProvider } from './CloudProvider.js';
export { FirebaseProvider } from './FirebaseProvider.js';
export { MockCloudProvider } from './MockCloudProvider.js';
export { FirebaseRealtimeProvider } from './FirebaseRealtimeProvider.js';
export { MockRealtimeProvider } from './MockRealtimeProvider.js';

// Image Storage Providers (PHASE 04 & PHASE 14.1)
export { ImageStorageProvider } from './ImageStorageProvider.js';
export { MockImageStorageProvider } from './MockImageStorageProvider.js';
export { FirebaseStorageProvider } from './FirebaseStorageProvider.js';
export { CloudinaryImageProvider } from './CloudinaryImageProvider.js';
export { SupabaseStorageProvider } from './SupabaseStorageProvider.js';

// Image Manifest (PHASE 05)
export { ImageManifestRepository, imageManifestRepository } from '../repositories/ImageManifestRepository.js';
export {
  ImageManifestService,
  MANIFEST_STATUS,
  normalizeImageMetadata,
  computeImageHash
} from '../services/ImageManifestService.js';

// Local Image Cache (PHASE 06)
export {
  LocalImageCache,
  localImageCache,
  ImageCacheService,
  RETENTION_CATEGORY
} from '../services/LocalImageCache.js';

// Automatic Image Sync (PHASE 07)
export {
  ImageSyncService,
  imageSyncService,
  SYNC_PRIORITY,
  QUEUE_STATE,
  NETWORK_POLICY,
  IMAGE_SYNC_EVENTS
} from '../services/ImageSyncService.js';

