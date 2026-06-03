import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Coordinator } from "../coordinator/coordinator.js";
export type SquadInitResult = {
    readonly status: 'already_initialized';
    readonly projectRoot: string;
    readonly teamPath: string;
} | {
    readonly status: 'initialized';
    readonly projectRoot: string;
    readonly createdDirectories: readonly string[];
    readonly createdFiles: readonly string[];
};
export declare function initializeSquadProject(projectRoot: string): Promise<SquadInitResult>;
export declare function registerSquadInitCommand(pi: ExtensionAPI, coordinator?: Coordinator): void;
//# sourceMappingURL=squad-init.d.ts.map