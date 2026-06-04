import { describe, expect, it } from 'vitest';

import { GuardChecker } from './guard.js';

describe('GuardChecker.validate', () => {
  const checker = new GuardChecker();

  it('accepts valid directives', () => {
    expect(
      checker.validate({ type: 'agent_spawn', agentId: 'batou', prompt: 'do the thing' }).ok,
    ).toBe(true);
    expect(checker.validate({ type: 'direct_response', message: 'hello' }).ok).toBe(true);
    expect(checker.validate({ type: 'squad_update', message: 'update status' }).ok).toBe(true);
    expect(checker.validate({ type: 'unknown' }).ok).toBe(true);
  });

  it('rejects missing required fields', () => {
    const missingAgentId = checker.validate({ type: 'agent_spawn', agentId: '', prompt: 'x' });
    expect(missingAgentId.ok).toBe(false);
    if (!missingAgentId.ok) {
      expect(missingAgentId.violation.code).toBe('MISSING_REQUIRED_FIELD');
      expect(missingAgentId.violation.field).toBe('agentId');
    }

    const missingPrompt = checker.validate({ type: 'agent_spawn', agentId: 'x', prompt: '' });
    expect(missingPrompt.ok).toBe(false);
    if (!missingPrompt.ok) {
      expect(missingPrompt.violation.code).toBe('MISSING_REQUIRED_FIELD');
      expect(missingPrompt.violation.field).toBe('prompt');
    }

    const missingDirectMessage = checker.validate({ type: 'direct_response', message: '' });
    expect(missingDirectMessage.ok).toBe(false);
    if (!missingDirectMessage.ok) {
      expect(missingDirectMessage.violation.code).toBe('MISSING_REQUIRED_FIELD');
    }

    const missingUpdateMessage = checker.validate({ type: 'squad_update', message: '' });
    expect(missingUpdateMessage.ok).toBe(false);
    if (!missingUpdateMessage.ok) {
      expect(missingUpdateMessage.violation.code).toBe('MISSING_REQUIRED_FIELD');
    }
  });

  it('rejects unknown directive type', () => {
    const result = checker.validate({ type: 'evil_hack' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violation.code).toBe('UNKNOWN_DIRECTIVE_TYPE');
    }
  });

  it('rejects circular spawn references', () => {
    const sameParent = checker.validate({
      type: 'agent_spawn',
      agentId: 'a',
      prompt: 'x',
      parentAgentId: 'a',
    });
    expect(sameParent.ok).toBe(false);
    if (!sameParent.ok) {
      expect(sameParent.violation.code).toBe('CIRCULAR_SPAWN_REFERENCE');
    }

    const spawnPathLoop = checker.validate({
      type: 'agent_spawn',
      agentId: 'c',
      prompt: 'x',
      spawnPath: ['a', 'b', 'c'],
    });
    expect(spawnPathLoop.ok).toBe(false);
    if (!spawnPathLoop.ok) {
      expect(spawnPathLoop.violation.code).toBe('CIRCULAR_SPAWN_REFERENCE');
    }
  });

  it('enforces schema constraints for agent_spawn fields', () => {
    const invalidAgentIdFormat = checker.validate({
      type: 'agent_spawn',
      agentId: '9invalid',
      prompt: 'x',
    });
    expect(invalidAgentIdFormat.ok).toBe(false);
    if (!invalidAgentIdFormat.ok) {
      expect(invalidAgentIdFormat.violation.code).toBe('SCHEMA_CONSTRAINT_VIOLATION');
    }

    const tooLongAgentId = checker.validate({
      type: 'agent_spawn',
      agentId: 'a'.repeat(51),
      prompt: 'x',
    });
    expect(tooLongAgentId.ok).toBe(false);
    if (!tooLongAgentId.ok) {
      expect(tooLongAgentId.violation.code).toBe('SCHEMA_CONSTRAINT_VIOLATION');
    }

    const tooLongPrompt = checker.validate({
      type: 'agent_spawn',
      agentId: 'valid-id',
      prompt: 'x'.repeat(32_001),
    });
    expect(tooLongPrompt.ok).toBe(false);
    if (!tooLongPrompt.ok) {
      expect(tooLongPrompt.violation.code).toBe('SCHEMA_CONSTRAINT_VIOLATION');
    }

    const timeoutTooLow = checker.validate({
      type: 'agent_spawn',
      agentId: 'valid-id',
      prompt: 'x',
      timeoutMs: 0,
    });
    expect(timeoutTooLow.ok).toBe(false);
    if (!timeoutTooLow.ok) {
      expect(timeoutTooLow.violation.code).toBe('SCHEMA_CONSTRAINT_VIOLATION');
    }

    const timeoutTooHigh = checker.validate({
      type: 'agent_spawn',
      agentId: 'valid-id',
      prompt: 'x',
      timeoutMs: 400_000,
    });
    expect(timeoutTooHigh.ok).toBe(false);
    if (!timeoutTooHigh.ok) {
      expect(timeoutTooHigh.violation.code).toBe('SCHEMA_CONSTRAINT_VIOLATION');
    }

    const validTimeout = checker.validate({
      type: 'agent_spawn',
      agentId: 'valid-id',
      prompt: 'x',
      timeoutMs: 5_000,
    });
    expect(validTimeout.ok).toBe(true);
  });

  it('enforces schema constraints for direct_response message length', () => {
    const tooLongMessage = checker.validate({
      type: 'direct_response',
      message: 'x'.repeat(8_001),
    });
    expect(tooLongMessage.ok).toBe(false);
    if (!tooLongMessage.ok) {
      expect(tooLongMessage.violation.code).toBe('SCHEMA_CONSTRAINT_VIOLATION');
    }
  });
});
