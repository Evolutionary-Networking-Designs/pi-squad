/**
 * Phase 1 SDK test harness for @pi-squad/coordinator.
 *
 * Wraps createAgentSession() with:
 * - Faux provider registration (no API keys, no network)
 * - SessionManager.inMemory() (no disk state)
 * - Coordinator extension factory injection
 * - Event capture and system-prompt white-box inspection
 *
 * NOTE: The coordinator resolves its .squad/ tree from process.cwd().
 * Tests that need specific .squad/ content should either:
 *   - Use vi.mock("node:fs/promises") in the test file (preferred for unit/integration)
 *   - Call process.chdir() before/after the test with a real fixture directory
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  registerFauxProvider,
  type FauxProviderRegistration,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";

import coordinatorFactory from "../../src/index.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// A non-existent agent dir within the project. Since noExtensions/noSkills/etc.
// are set to true, the resource loader never reads from here.
const AGENT_DIR = join(PACKAGE_ROOT, "tests", "workspaces", ".agent");

export interface TestSessionOptions {
  /**
   * Working directory for the session. Passed as cwd to createAgentSession.
   * The coordinator reads .squad/ relative to process.cwd() (not this value),
   * so for fixture-based tests use process.chdir() or vi.mock("node:fs/promises").
   */
  squadDir?: string;

  /** Additional extension factories injected alongside the coordinator. */
  extensionFactories?: ExtensionFactory[];

  /**
   * Initial faux provider responses. Set before any session.prompt() calls.
   * Empty by default — tests that prompt the agent must supply at least one response.
   * Ignored when useFauxProvider is false.
   */
  fauxResponses?: FauxResponseStep[];

  /**
   * Use the faux provider instead of real credentials.
   *
   * Default: true (safe for CI and unit tests).
   * Set to false (or PISQUAD_REAL=1) to use ~/.pi/agent/auth.json — real LLM
   * responses, real provider, same session as `pi` CLI on this machine.
   *
   * Pattern for integration tests that need real behavior locally:
   *   createTestSession({ useFauxProvider: process.env.CI === "true" })
   */
  useFauxProvider?: boolean;
}

export interface TestSession {
  /** The underlying AgentSession. */
  session: AgentSession;

  /**
   * Returns the last system prompt captured by the harness spy after
   * before_agent_start fires.  Undefined until the first session.prompt()
   * call.  After the hook fires, contains the coordinator-injected prompt
   * (i.e. Pi's base prompt with Squad content prepended).
   *
   * Falls back to session.agent.state.systemPrompt when no hook has fired.
   */
  systemPrompt: () => string;

  /** Returns a snapshot of all events collected during the session lifetime. */
  events: () => AgentSessionEvent[];

  /**
   * Returns true if an extension command with the given name is registered
   * in the live session.  Valid immediately after createTestSession() returns.
   */
  hasCommand: (name: string) => boolean;

  /**
   * Returns the description string of a registered extension command, or
   * undefined if the command does not exist.
   */
  getCommandDescription: (name: string) => string | undefined;

  /**
   * Faux provider registration for setting/inspecting responses mid-test.
   * Undefined when useFauxProvider is false (real credentials mode).
   */
  faux?: FauxProviderRegistration;

  /** Dispose the session and unregister the faux provider. Call in afterEach. */
  cleanup: () => void;
}

/**
 * Create a test session with the coordinator extension loaded and faux provider active.
 *
 * @example
 * ```typescript
 * import { createTestSession } from '../helpers/index.js';
 *
 * let ts: TestSession;
 * beforeEach(async () => { ts = await createTestSession(); });
 * afterEach(() => ts.cleanup());
 *
 * it('injects coordinator context', async () => {
 *   ts.faux.setResponses([fauxText('ok')]);
 *   await ts.session.prompt('hello');
 *   expect(ts.systemPrompt()).toContain('Squad Coordinator');
 * });
 * ```
 */
// Minimal ResolvedCommand shape — only the fields we need for test introspection.
interface ResolvedCommand {
  invocationName: string;
  description?: string;
}

// Private ExtensionRunner surface used for test introspection.
// We access this via (session as any)._extensionRunner at runtime.
interface ExtensionRunnerPrivate {
  getCommand(name: string): ResolvedCommand | undefined;
}

export async function createTestSession(options: TestSessionOptions = {}): Promise<TestSession> {
  const { useFauxProvider = process.env["PISQUAD_REAL"] !== "1" } = options;

  // Spy factory — runs AFTER coordinatorFactory so it receives the already-chained
  // system prompt from before_agent_start.  Captures it without further modification.
  let capturedHookPrompt: string | undefined;
  const hookSpy: ExtensionFactory = (pi) => {
    pi.on("before_agent_start", async (event) => {
      capturedHookPrompt = event.systemPrompt;
      // Return nothing — let the chained prompt pass through unchanged.
      return undefined;
    });
  };

  const factories: ExtensionFactory[] = [
    coordinatorFactory,
    ...(options.extensionFactories ?? []),
    hookSpy,
  ];

  const cwd = options.squadDir ?? PACKAGE_ROOT;

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: AGENT_DIR,
    extensionFactories: factories,
    // Skip file-system discovery — only use injected factories.
    // This keeps the harness CI-safe and deterministic.
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  // reload() must be called before createAgentSession() so the extension
  // factories are executed and their commands/handlers are registered.
  // When resourceLoader is provided to createAgentSession(), the SDK skips
  // its own reload() call, leaving extensionsResult empty without this.
  await resourceLoader.reload();

  if (useFauxProvider) {
    // --- Faux mode (default): no network, no credentials, reproducible ---
    const faux = registerFauxProvider();
    faux.setResponses(options.fauxResponses ?? []);

    const model = faux.getModel();

    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(model.provider, "faux-key");

    const modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider(model.provider, {
      baseUrl: model.baseUrl,
      apiKey: "faux-key",
      api: model.api,
      models: faux.models.map((m) => ({
        id: m.id,
        name: m.name,
        api: m.api,
        baseUrl: m.baseUrl,
        reasoning: m.reasoning,
        input: m.input,
        cost: m.cost,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
      })),
    });

    const { session } = await createAgentSession({
      cwd,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      model,
    });

    const collectedEvents: AgentSessionEvent[] = [];
    session.subscribe((event) => {
      collectedEvents.push(event);
    });

    return {
      session,
      systemPrompt: () => capturedHookPrompt ?? session.agent.state.systemPrompt,
      events: () => [...collectedEvents],
      hasCommand: (name: string) => {
        const runner = (session as unknown as { _extensionRunner?: ExtensionRunnerPrivate })._extensionRunner;
        return runner?.getCommand(name) !== undefined;
      },
      getCommandDescription: (name: string) => {
        const runner = (session as unknown as { _extensionRunner?: ExtensionRunnerPrivate })._extensionRunner;
        return runner?.getCommand(name)?.description;
      },
      faux,
      cleanup() {
        session.dispose();
        faux.unregister();
      },
    };
  } else {
    // --- Real-credentials mode: uses ~/.pi/agent/auth.json (same as `pi` CLI) ---
    // Requires Pi to be authenticated on this machine. Never use in CI.
    // Enable with: createTestSession({ useFauxProvider: false })
    //           or: PISQUAD_REAL=1 npm test
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);

    const { session } = await createAgentSession({
      cwd,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
    });

    const collectedEvents: AgentSessionEvent[] = [];
    session.subscribe((event) => {
      collectedEvents.push(event);
    });

    return {
      session,
      systemPrompt: () => capturedHookPrompt ?? session.agent.state.systemPrompt,
      events: () => [...collectedEvents],
      hasCommand: (name: string) => {
        const runner = (session as unknown as { _extensionRunner?: ExtensionRunnerPrivate })._extensionRunner;
        return runner?.getCommand(name) !== undefined;
      },
      getCommandDescription: (name: string) => {
        const runner = (session as unknown as { _extensionRunner?: ExtensionRunnerPrivate })._extensionRunner;
        return runner?.getCommand(name)?.description;
      },
      // faux is undefined in real-credentials mode
      cleanup() {
        session.dispose();
      },
    };
  }
}
