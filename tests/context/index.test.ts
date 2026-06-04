import { describe, expect, it } from "vitest";

import * as context from "../../src/context/index.js";

describe("context module exports", () => {
  it("re-exports the context surface used by coordinator code", () => {
    expect(context.ContextPressureLevel.CRITICAL).toBe("CRITICAL");
    expect(context.SessionStore).toBeTypeOf("function");
    expect(context.createSessionStore).toBeTypeOf("function");
    expect(context.SqliteVecBackend).toBeTypeOf("function");
    expect(context.getBackend).toBeTypeOf("function");
    expect(context.createRecoveryOrchestrator).toBeTypeOf("function");
    expect(context.createIngestionPipeline).toBeTypeOf("function");
  });
});
