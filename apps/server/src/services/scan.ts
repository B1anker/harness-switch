import type {
  HarnessId,
  LocalizedMessage,
  ScanCandidate,
  ScanHarnessResult,
  ScanImportResponse,
  ScanImportSelection,
  ScanSource,
} from '@seaveyon/harness-switch-shared';
import { ERROR_CODES, SCAN_NOTE_CODES, WARNING_CODES } from '@seaveyon/harness-switch-shared';
import { HttpError } from '../common/errors';
import { createDecorator, inject } from '../di';
import type { CurrentFiles, HarnessAdapter } from './adapters';
import { IAdapterRegistry } from './adapters';
import type { DetectedProfile } from './adapters/detect';
import { assertParsable } from './adapters/serialize';
import { IFileService } from './files';
import { ILogService } from './log';
import { IProfileService } from './profiles';
import { IHarnessRegistry } from './registry';
import { IVaultService } from './vault';

export interface IScanService {
  readonly _serviceBrand: undefined;
  /** Reads what the five tools already have configured. Never writes anything. */
  scan(): ScanHarnessResult[];
  /** Saves the chosen candidates as profiles or vault entries. Never touches the tools. */
  importSelections(selections: ScanImportSelection[]): ScanImportResponse;
}

export const IScanService = createDecorator<IScanService>('scanService');

/**
 * Turns configuration a user already set up by hand into managed profiles.
 *
 * The scan is strictly read-only and the import only writes to this manager's own store:
 * adopting an existing setup must never rewrite the tool's config as a side effect, or a
 * user trying the wizard out would lose the very setup they came to import.
 */
@inject(
  IAdapterRegistry,
  IHarnessRegistry,
  IProfileService,
  IVaultService,
  IFileService,
  ILogService,
)
export class ScanService implements IScanService {
  declare readonly _serviceBrand: undefined;

  constructor(
    private readonly adapters: IAdapterRegistry,
    private readonly harnesses: IHarnessRegistry,
    private readonly profiles: IProfileService,
    private readonly vault: IVaultService,
    private readonly files: IFileService,
    private readonly log: ILogService,
  ) {}

  scan(): ScanHarnessResult[] {
    return this.harnesses.list().map((harness) => this.scanOne(harness.id, harness.label));
  }

  importSelections(selections: ScanImportSelection[]): ScanImportResponse {
    const found = new Map<string, { harness: HarnessId; candidate: DetectedProfile }>();
    for (const result of this.harnesses.list()) {
      const adapter = this.adapters.get(result.id);
      for (const candidate of this.detect(adapter)) {
        found.set(candidateId(result.id, candidate.key), {
          harness: result.id,
          candidate,
        });
      }
    }

    const warnings: LocalizedMessage[] = [];
    let imported = 0;
    let skipped = 0;
    let providersCreated = 0;

    for (const selection of selections) {
      const entry = found.get(selection.id);
      if (!entry) {
        // The tool's config changed between the scan and the import.
        warnings.push({
          scope: selection.name,
          code: WARNING_CODES.scanProfileGone,
        });
        skipped += 1;
        continue;
      }
      const exists = this.profiles.get(entry.harness, selection.name) !== undefined;
      if (exists && !selection.overwrite) {
        warnings.push({
          scope: selection.name,
          code: WARNING_CODES.scanProfileExists,
        });
        skipped += 1;
        continue;
      }
      try {
        providersCreated += this.save(entry.harness, entry.candidate, selection, exists);
        imported += 1;
      } catch (error) {
        this.log.error(`scan import failed for ${entry.harness}/${selection.name}`, error);
        const reason = error instanceof Error ? error.message : String(error);
        warnings.push({
          scope: selection.name,
          code: WARNING_CODES.scanImportFailed,
          data: { reason },
        });
        skipped += 1;
      }
    }

    return { ok: true, imported, skipped, providersCreated, warnings };
  }

  /** Returns the number of vault entries created, so the caller can report it. */
  private save(
    harness: HarnessId,
    candidate: DetectedProfile,
    selection: ScanImportSelection,
    replacing: boolean,
  ): number {
    let providerId: string | undefined;
    let created = 0;

    // A provider that reads its key from the shell leaves nothing on disk to import, so
    // the wizard asks the user for it instead of inventing one.
    const apiKey = candidate.apiKey || selection.apiKey?.trim() || '';

    if (selection.target === 'vault') {
      if (selection.providerId) {
        // Referencing an existing entry keeps its credential; only the link is new.
        this.vault.get(selection.providerId);
        providerId = selection.providerId;
      } else {
        if (!apiKey) {
          throw new HttpError(400, '这条配置里没有可提取的凭据，请先填写 API key', {
            code: ERROR_CODES.scanApiKeyRequired,
          });
        }
        providerId = this.vault.create({
          name: selection.providerName ?? selection.name,
          apiKey,
          endpoints: candidate.baseUrl
            ? [{ key: 'default', label: '默认', baseUrl: candidate.baseUrl }]
            : [],
        }).id;
        created = 1;
      }
    } else if (!apiKey) {
      throw new HttpError(400, '这条配置里没有可提取的凭据，请先填写 API key', {
        code: ERROR_CODES.scanApiKeyRequired,
      });
    }

    this.profiles.upsert(
      harness,
      {
        name: selection.name,
        sourceName: replacing ? selection.name : undefined,
        baseUrl: candidate.baseUrl,
        // A vault-backed profile still caches the key, exactly as the normal edit path does.
        apiKey,
        model: candidate.model,
        notes: `从 ${harness} 现有配置导入（${candidate.key}）`,
        extras: candidate.extras,
        ...(providerId ? { providerId, providerEndpoint: 'default' } : {}),
      },
      !replacing,
    );
    return created;
  }

  private scanOne(harness: HarnessId, label: string): ScanHarnessResult {
    const adapter = this.adapters.get(harness);
    const targets = adapter.targets();
    const sources: ScanSource[] = targets.map((target) => {
      const content = this.readSafely(target.path);
      let parsable = content !== undefined;
      if (content !== undefined) {
        try {
          assertParsable(target.format, target.path, content);
        } catch {
          parsable = false;
        }
      }
      return {
        key: target.key,
        label: target.label,
        path: target.path,
        exists: content !== undefined,
        parsable,
      };
    });

    if (!adapter.detect) {
      return {
        harness,
        label,
        sources,
        candidates: [],
        noteCode: SCAN_NOTE_CODES.unsupported,
      };
    }
    if (sources.every((source) => !source.exists)) {
      return {
        harness,
        label,
        sources,
        candidates: [],
        noteCode: SCAN_NOTE_CODES.noConfigFiles,
      };
    }
    if (sources.some((source) => source.exists && !source.parsable)) {
      return {
        harness,
        label,
        sources,
        candidates: [],
        noteCode: SCAN_NOTE_CODES.unparsable,
      };
    }

    const candidates = this.detect(adapter).map((candidate) =>
      this.describe(harness, candidate, this.existingNames(harness)),
    );
    return {
      harness,
      label,
      sources,
      candidates,
      noteCode: candidates.length === 0 ? SCAN_NOTE_CODES.noCandidates : undefined,
    };
  }

  private describe(
    harness: HarnessId,
    candidate: DetectedProfile,
    existing: Set<string>,
  ): ScanCandidate {
    const suggestedName = uniqueName(candidate.key || harness, existing);
    return {
      id: candidateId(harness, candidate.key),
      harness,
      sourceKey: candidate.key,
      suggestedName,
      baseUrl: candidate.baseUrl,
      model: candidate.model,
      extras: candidate.extras,
      apiKeyPreview: mask(candidate.apiKey),
      apiKeyPresent: candidate.apiKey !== '',
      active: candidate.active,
      conflictsWith: existing.has(candidate.key) ? candidate.key : undefined,
      matchesProvider: this.matchProvider(candidate),
    };
  }

  /** A detect() that throws must not take the whole scan down with it. */
  private detect(adapter: HarnessAdapter): DetectedProfile[] {
    if (!adapter.detect) {
      return [];
    }
    try {
      return adapter.detect(this.readCurrent(adapter));
    } catch (error) {
      this.log.error(`scan failed for ${adapter.id}`, error);
      return [];
    }
  }

  /** Points at a vault entry that already holds this credential, so it is not duplicated. */
  private matchProvider(candidate: DetectedProfile): string | undefined {
    if (!candidate.apiKey) {
      return undefined;
    }
    for (const provider of this.vault.list()) {
      try {
        if (this.vault.decrypt(provider.id) === candidate.apiKey) {
          return provider.id;
        }
      } catch {
        // An unreadable entry simply is not a match.
      }
    }
    return undefined;
  }

  private existingNames(harness: HarnessId): Set<string> {
    return new Set(this.profiles.list(harness).map((profile) => profile.name));
  }

  private readCurrent(adapter: HarnessAdapter): CurrentFiles {
    const current: CurrentFiles = {};
    for (const target of adapter.targets()) {
      current[target.key] = this.readSafely(target.path);
    }
    return current;
  }

  /** A config file that is a symlink or a directory is reported as absent, not fatal. */
  private readSafely(path: string): string | undefined {
    try {
      return this.files.readRegularOptional(path);
    } catch {
      return undefined;
    }
  }
}

function candidateId(harness: HarnessId, key: string): string {
  return `${harness}:${key}`;
}

/** Shows enough of a credential to recognise it without handing it out. */
function mask(apiKey: string): string {
  if (!apiKey) {
    return '';
  }
  if (apiKey.length <= 8) {
    return '•'.repeat(apiKey.length);
  }
  return `${apiKey.slice(0, 4)}${'•'.repeat(6)}${apiKey.slice(-4)}`;
}

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) {
    return base;
  }
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}
