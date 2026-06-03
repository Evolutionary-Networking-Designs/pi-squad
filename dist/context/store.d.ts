/**
 * @module context/store
 * SQLite-backed session store for token analytics, checkpoints, and semantic recovery.
 *
 * Uses better-sqlite3 for synchronous local persistence and sqlite-vec for vector
 * search via the VectorBackend abstraction. Embeddings use @huggingface/transformers
 * (Xenova/all-MiniLM-L6-v2, 384-dim) for semantic similarity. The pipeline is
 * lazy-initialized on first use and cached.
 *
 * Vector operations are delegated to SqliteVecBackend (manageSchema: false) so
 * that the store owns the schema and the backend owns only the vec0 table operations.
 * Swapping to pgvector requires only changing the backend — all store logic stays.
 */
import { ContextPressureLevel, type ContextCheckpoint, type TokenSample } from "./types.js";
import type { BackendConfig } from "./backends/types.js";
export interface SessionEntry {
    readonly id: string;
    readonly name: string | null;
    readonly createdAt: string;
    readonly lastActive: string;
    readonly tokenHighWatermark: number | null;
    readonly peakPressureLevel: ContextPressureLevel | null;
    readonly checkpointCount: number;
}
export declare class SessionStore {
    private readonly db;
    private readonly dbPath;
    private readonly embeddingDimension;
    private readonly vectorBackend;
    constructor(storePath: string, backend?: BackendConfig);
    recordTokenSample(sample: TokenSample): void;
    querySamples(sessionId: string, limit?: number): TokenSample[];
    queryTrend(sessionId: string, windowSize?: number): {
        avgPercent: number;
        peakPercent: number;
        sampleCount: number;
    };
    listSessions(): SessionEntry[];
    getLastKnownTokens(sessionId: string): number | null;
    saveCheckpoint(checkpoint: ContextCheckpoint, embedding?: Float32Array): Promise<void>;
    findRelevantCheckpoints(query: string, sessionId?: string, limit?: number): Promise<ContextCheckpoint[]>;
    getCheckpoint(id: string): ContextCheckpoint | null;
    listCheckpoints(sessionId: string): ContextCheckpoint[];
    initialize(): Promise<void>;
    bootstrapFromCheckpoint(checkpoint: ContextCheckpoint): Promise<void>;
    upsertSession(id: string, name?: string): void;
    touchSession(id: string, pressureLevel?: ContextPressureLevel): void;
    private initializeSchema;
    private mapTokenSample;
    private getMostRecentSession;
    private decodeCheckpoint;
    private buildCheckpointSummary;
    private writeSessionRegistry;
}
export declare function createStore(dbPath: string): SessionStore;
/** Factory type — creates a SessionStore for a given squad directory */
export type StoreFactory = (squadPath: string, backend?: BackendConfig) => Promise<SessionStore>;
/**
 * Creates and initializes a SessionStore for the given squad directory.
 * If a JSON checkpoint exists at {squadPath}/checkpoints/latest.json, bootstraps from it.
 */
declare function createSessionStoreImpl(squadPath: string, backend?: BackendConfig): Promise<SessionStore>;
export { createSessionStoreImpl as createSessionStore };
//# sourceMappingURL=store.d.ts.map