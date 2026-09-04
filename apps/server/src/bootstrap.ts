import { InstantiationService, ServiceCollection, SyncDescriptor } from './di';
import { ActivationService, IActivationService } from './services/activation';
import { AdapterRegistry, IAdapterRegistry } from './services/adapters';
import { AuthService, IAuthService } from './services/auth';
import { BackupService, IBackupService } from './services/backup';
import { CodexLoginCacheService, ICodexLoginCacheService } from './services/codex-login-cache';
import { CryptoService, ICryptoService } from './services/crypto';
import { DoctorService, IDoctorService } from './services/doctor';
import { DriftService, IDriftService } from './services/drift';
import { EnvironmentService, IEnvironmentService } from './services/environment';
import { FileService, IFileService } from './services/files';
import { GitHubSyncService, IGitHubSyncService } from './services/github-sync';
import { HarnessService, IHarnessService } from './services/harness';
import { HttpClient, IHttpClient } from './services/http-client';
import { IJournalService, JournalService } from './services/journal';
import { ILiveWriteService, LiveWriteService } from './services/live-write';
import { ILogService, LogService } from './services/log';
import { IProbeService, ProbeService } from './services/probe';
import { IProbeCacheService, ProbeCacheService } from './services/probe-cache';
import { IProbeProfileService, ProbeProfileService } from './services/probe-profile';
import { IProfileService, ProfileService } from './services/profiles';
import { IProviderService, ProviderService } from './services/provider';
import { HarnessRegistry, IHarnessRegistry } from './services/registry';
import { IScanService, ScanService } from './services/scan';
import { ITransferService, TransferService } from './services/transfer';
import { IUpdateService, UpdateService } from './services/update';
import { IUserAccessService, UserAccessService } from './services/user-access';
import { IUserSyncService, UserSyncService } from './services/user-sync';
import { IUserService, UserService } from './services/users';
import { IVaultService, VaultService } from './services/vault';
import { IVersionService, VersionService } from './services/version';

/** Built on the first request that reaches it, for services most requests never touch. */
const DELAYED = true;

export function createServices(): InstantiationService {
  const collection = new ServiceCollection();

  // Infrastructure: process-level capabilities with no domain knowledge. Every other
  // layer depends on these, so none of them are worth deferring.
  collection.set(ILogService, new SyncDescriptor(LogService));
  collection.set(IEnvironmentService, new SyncDescriptor(EnvironmentService));
  collection.set(IFileService, new SyncDescriptor(FileService));
  collection.set(ICryptoService, new SyncDescriptor(CryptoService));
  collection.set(IHttpClient, new SyncDescriptor(HttpClient));
  collection.set(IVersionService, new SyncDescriptor(VersionService));

  // Identity: the session guard runs ahead of every guarded route, so auth and the user
  // list stay eager. Provisioning and cross-account sync are their own routes.
  collection.set(IAuthService, new SyncDescriptor(AuthService));
  collection.set(IUserService, new SyncDescriptor(UserService));
  collection.set(IUserAccessService, new SyncDescriptor(UserAccessService, [], DELAYED));
  collection.set(IUserSyncService, new SyncDescriptor(UserSyncService, [], DELAYED));

  // Domain: the harness model and its stores. The registries and the profile/vault pair
  // back the dashboard's first request; the rest serve one route family each.
  collection.set(IHarnessRegistry, new SyncDescriptor(HarnessRegistry));
  collection.set(IAdapterRegistry, new SyncDescriptor(AdapterRegistry));
  collection.set(IProfileService, new SyncDescriptor(ProfileService));
  collection.set(IVaultService, new SyncDescriptor(VaultService));
  collection.set(IJournalService, new SyncDescriptor(JournalService));
  collection.set(IBackupService, new SyncDescriptor(BackupService, [], DELAYED));
  collection.set(ILiveWriteService, new SyncDescriptor(LiveWriteService, [], DELAYED));
  collection.set(ICodexLoginCacheService, new SyncDescriptor(CodexLoginCacheService, [], DELAYED));
  collection.set(IScanService, new SyncDescriptor(ScanService, [], DELAYED));
  collection.set(IProbeService, new SyncDescriptor(ProbeService, [], DELAYED));
  collection.set(IProbeCacheService, new SyncDescriptor(ProbeCacheService, [], DELAYED));
  collection.set(IProbeProfileService, new SyncDescriptor(ProbeProfileService, [], DELAYED));
  collection.set(IDriftService, new SyncDescriptor(DriftService, [], DELAYED));

  // Orchestration: multi-service workflows, each behind a single route family.
  collection.set(IActivationService, new SyncDescriptor(ActivationService));
  collection.set(IHarnessService, new SyncDescriptor(HarnessService));
  collection.set(IProviderService, new SyncDescriptor(ProviderService, [], DELAYED));
  collection.set(ITransferService, new SyncDescriptor(TransferService, [], DELAYED));
  collection.set(IGitHubSyncService, new SyncDescriptor(GitHubSyncService, [], DELAYED));
  collection.set(IDoctorService, new SyncDescriptor(DoctorService, [], DELAYED));
  collection.set(IUpdateService, new SyncDescriptor(UpdateService, [], DELAYED));

  return new InstantiationService(collection);
}
