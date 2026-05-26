/**
 * @description: Factory for creating the incident store with env-driven configuration and pseudonymization checks.
 * @footnote-scope: utility
 * @footnote-module: IncidentStoreFactory
 * @footnote-risk: high - Misconfiguration can block incident storage or create inconsistent data paths.
 * @footnote-ethics: high - Protects against storing raw Discord identifiers without hashing.
 */
import { runtimeConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { SqliteIncidentStore } from './sqliteIncidentStore.js';

const incidentStoreLogger =
    typeof logger.child === 'function'
        ? logger.child({ module: 'incidentStore' })
        : logger;

/**
 * Public incident store contract. It currently matches the SQLite
 * implementation exactly so callers can depend on one stable type.
 */
export type IncidentStore = SqliteIncidentStore;

let cachedIncidentStore: IncidentStore | null = null;

/**
 * Lazily creates and caches the default incident store the first time code asks
 * for it.
 */
export function getDefaultIncidentStore(): IncidentStore {
    if (!cachedIncidentStore) {
        cachedIncidentStore = createIncidentStoreFromEnv();
    }
    return cachedIncidentStore;
}

/**
 * Builds the incident store from runtime config and falls back to a local path
 * when the default data volume is unavailable.
 */
export function createIncidentStoreFromEnv(): IncidentStore {
    const pseudonymizationSecret =
        runtimeConfig.storage.incidentPseudonymizationSecret;
    if (!pseudonymizationSecret) {
        throw new Error(
            'Missing required environment variable: INCIDENT_PSEUDONYMIZATION_SECRET'
        );
    }

    const envPath = runtimeConfig.storage.incidentSqlitePath;
    const flyDefaultPath = runtimeConfig.runtime.flyAppName
        ? '/data/incidents.db'
        : undefined;
    const defaultPath = envPath || flyDefaultPath || './data/incidents.db';

    try {
        return new SqliteIncidentStore({
            dbPath: defaultPath,
            pseudonymizationSecret,
        });
    } catch (error) {
        const code = (error as { code?: string }).code;
        const isPermission = code === 'EACCES' || code === 'EPERM';
        if (isPermission && !envPath) {
            incidentStoreLogger.warn(
                `Falling back to local SQLite path "./data/incidents.db" because default path "${defaultPath}" was not writable: ${String(error)}`
            );
            return new SqliteIncidentStore({
                dbPath: './data/incidents.db',
                pseudonymizationSecret,
            });
        }
        throw error;
    }
}

export type {
    IncidentAuditEvent,
    IncidentRecord,
} from './sqliteIncidentStore.js';
export type { IncidentPointers, IncidentStatus } from '@footnote/contracts/web';
