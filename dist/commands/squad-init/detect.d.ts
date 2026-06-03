import type { InitContext } from "../../coordinator/coordinator.js";
export declare function probeModule(specifier: string): Promise<boolean>;
export declare const KNOWN_RPIV_EXTENSIONS: readonly ["@juicesharp/rpiv-ask-user-question", "@juicesharp/rpiv-todo", "@juicesharp/rpiv-advisor", "@juicesharp/rpiv-telemetry", "@juicesharp/rpiv-workflow"];
export declare function detectEnvironment(cwd: string): Promise<InitContext>;
//# sourceMappingURL=detect.d.ts.map