import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
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
export declare function registerSquadInitCommand(pi: ExtensionAPI): void;
//# sourceMappingURL=squad-init.d.ts.map