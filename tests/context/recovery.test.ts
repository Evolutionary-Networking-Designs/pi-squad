import { mkdir, readFile, writeFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
}));

import { TRUNCATION_ORDER } from "../../src/coordinator/composite-prompt.js";
import {
  DefaultCheckpointStrategy,
  DefaultGracefulDegradeStrategy,
  DefaultRecoveryOrchestrator,
} from "../../src/context/recovery.js";
import {
  ContextPressureLevel,
  type RecoveryContext,
  type RecoveryResult,
} from "../../src/context/types.js";

const mkdirMock = vi.mocked(mkdir);
const readFileMock = vi.mocked(readFile);
const writeFileMock = vi.mocked(writeFile);

function createMissingError(filePath: string): Error & { code: string } {
  const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as Error & {
    code: string;
  };
  error.code = "ENOENT";
  return error;
}

function createBaseContext(): RecoveryContext {
  return {
    budget: {
      total: 100,
      used: 95,
      available: 5,
      pressureLevel: ContextPressureLevel.CRITICAL,
      utilizationPercent: 95,
      measuredAt: "2026-06-01T00:00:00.000Z",
    },
    teamRoot: "/repo/.squad",
    turnIndex: 12,
    previousAttempts: [],
    coordinatorState: {
      activeAgents: ["Ada", "Iris"],
      routingDigest: "root routing -> local routing",
      recentDecisionIds: ["decision-1", "decision-2"],
      activeWorkItems: [
        {
          agent: "Iris",
          description: "Add integration coverage",
          assignedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      historySummaries: [
        {
          agent: "Ada",
          entryCount: 4,
          summary: "Reviewed earlier context.",
          periodStart: "2026-05-30T00:00:00.000Z",
          periodEnd: "2026-06-01T00:00:00.000Z",
        },
      ],
    },
    estimator: {
      method: "char-approx",
      estimate: (text: string) => Math.ceil(text.length / 4),
    },
  };
}

describe("context recovery", () => {
  beforeEach(() => {
    mkdirMock.mockReset();
    readFileMock.mockReset();
    writeFileMock.mockReset();
  });

  it("executes the recovery strategy chain in registration order until one succeeds", async () => {
    const executionOrder: string[] = [];
    const ctx: RecoveryContext = {
      ...createBaseContext(),
      budget: {
        ...createBaseContext().budget,
        pressureLevel: ContextPressureLevel.WARNING,
        utilizationPercent: 75,
        used: 75,
        available: 25,
      },
    };
    const first = {
      id: "first",
      displayName: "First",
      description: "Fails first.",
      minimumLevel: ContextPressureLevel.WARNING,
      estimateFreeable: () => 1,
      canAct: () => true,
      execute: async (): Promise<RecoveryResult> => {
        executionOrder.push("first");
        return {
          success: false,
          tokensFreed: 0,
          newPressureLevel: ContextPressureLevel.WARNING,
          summary: "No change.",
          requiresReinject: false,
        };
      },
    };
    const second = {
      id: "second",
      displayName: "Second",
      description: "Succeeds second.",
      minimumLevel: ContextPressureLevel.WARNING,
      estimateFreeable: () => 10,
      canAct: () => true,
      execute: async (): Promise<RecoveryResult> => {
        executionOrder.push("second");
        return {
          success: true,
          tokensFreed: 10,
          newPressureLevel: ContextPressureLevel.NOMINAL,
          summary: "Recovered.",
          requiresReinject: false,
        };
      },
    };

    const orchestrator = new DefaultRecoveryOrchestrator({ root: {} as never }, [first, second]);

    const result = await orchestrator.recover(ContextPressureLevel.WARNING, ctx);

    expect(executionOrder).toEqual(["first", "second"]);
    expect(result.summary).toBe("Recovered.");
    expect(orchestrator.getAttemptHistory()).toEqual([
      expect.objectContaining({ strategyId: "first", success: false, tokensFreed: 0 }),
      expect.objectContaining({ strategyId: "second", success: true, tokensFreed: 10 }),
    ]);
  });

  it("keeps graceful degradation drop order in sync with composite prompt truncation", () => {
    const strategy = new DefaultGracefulDegradeStrategy();

    expect(strategy.config.dropOrder).toEqual(TRUNCATION_ORDER);
  });

  it("writes checkpoints with the expected JSON shape", async () => {
    const strategy = new DefaultCheckpointStrategy();
    const ctx = createBaseContext();

    readFileMock.mockImplementation(async (filePath) => {
      const normalizedPath = String(filePath);
      if (normalizedPath.includes("squad/VERSION")) {
        return "0.9.4\n";
      }
      throw createMissingError(normalizedPath);
    });

    const result = await strategy.execute(ctx);

    expect(result).toEqual({
      success: true,
      tokensFreed: 95,
      newPressureLevel: ContextPressureLevel.NOMINAL,
      summary: expect.stringMatching(/^Wrote checkpoint .*\.json\.$/),
      requiresReinject: true,
    });
    expect(mkdirMock).toHaveBeenCalledWith("/repo/.squad/checkpoints", { recursive: true });

    const [checkpointPath, rawCheckpoint, encoding] = writeFileMock.mock.calls[0] ?? [];
    expect(String(checkpointPath)).toMatch(/^\/repo\/\.squad\/checkpoints\/.*\.json$/);
    expect(encoding).toBe("utf8");

    const checkpoint = JSON.parse(String(rawCheckpoint).trim()) as Record<string, unknown>;
    expect(checkpoint).toEqual({
      id: expect.any(String),
      createdAt: expect.any(String),
      turnIndex: 12,
      triggerLevel: ContextPressureLevel.CRITICAL,
      budget: ctx.budget,
      state: ctx.coordinatorState,
      squadVersion: "0.9.4",
      checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(checkpoint.id).toBe(checkpoint.createdAt);
  });
});
