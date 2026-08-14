import { InstantiationService, ServiceCollection, SyncDescriptor } from './di';
import { ActivationService, IActivationService } from './services/activation';
import { AdapterRegistry, IAdapterRegistry } from './services/adapters';
import { AuthService, IAuthService } from './services/auth';
import { BackupService, IBackupService } from './services/backup';
import { CryptoService, ICryptoService } from './services/crypto';
import { EnvironmentService, IEnvironmentService } from './services/environment';
import { FileService, IFileService } from './services/files';
import { ILiveWriteService, LiveWriteService } from './services/live-write';
import { ILogService, LogService } from './services/log';
import { IProfileService, ProfileService } from './services/profiles';
import { HarnessRegistry, IHarnessRegistry } from './services/registry';

export function createServices(): InstantiationService {
  const collection = new ServiceCollection();
  collection.set(ILogService, new SyncDescriptor(LogService));
  collection.set(IEnvironmentService, new SyncDescriptor(EnvironmentService));
  collection.set(IFileService, new SyncDescriptor(FileService));
  collection.set(ICryptoService, new SyncDescriptor(CryptoService));
  collection.set(IAuthService, new SyncDescriptor(AuthService));
  collection.set(IHarnessRegistry, new SyncDescriptor(HarnessRegistry));
  collection.set(IAdapterRegistry, new SyncDescriptor(AdapterRegistry));
  collection.set(IBackupService, new SyncDescriptor(BackupService));
  collection.set(ILiveWriteService, new SyncDescriptor(LiveWriteService));
  collection.set(IProfileService, new SyncDescriptor(ProfileService));
  collection.set(IActivationService, new SyncDescriptor(ActivationService));
  return new InstantiationService(collection);
}
