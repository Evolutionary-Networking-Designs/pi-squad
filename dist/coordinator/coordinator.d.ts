/**
 * @module coordinator/coordinator
 * Core coordinator object — initializes Squad state and wires Pi lifecycle hooks.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ContextAssessment } from "../context/monitor.js";
import type { TeamStack } from "../types.js";
export interface InitContext {
    readonly userName: string | null;
    readonly detectedExtensions: readonly string[];
    readonly projectName: string;
}
export interface Coordinator {
    route(message: string, ctx: unknown): Promise<void>;
    getSystemPrompt(): Promise<string>;
    getTeamRoot(): Promise<string>;
    getTeamStack(): Promise<TeamStack>;
    assessContext(content: string, history?: readonly string[]): Promise<ContextAssessment>;
    setInitMode(ctx: InitContext): void;
    clearInitMode(): void;
    isInitMode(): boolean;
    getInitContext(): InitContext | null;
}
export declare function initializeCoordinator(pi: ExtensionAPI): Promise<Coordinator>;
//# sourceMappingURL=coordinator.d.ts.map