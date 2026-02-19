import { describe, expect, it } from 'vitest';

import {
  applyScopeCitationPolicy,
  buildScopeCitationPolicy,
  CITATION_POLICY_BLOCK_MESSAGE,
} from './citationPolicy.js';

describe('file citation policy', () => {
  it('marks files from disallowed lanes as blocked citations', () => {
    const policy = buildScopeCitationPolicy({
      files: [
        {
          filename: 'allowed.pdf',
          storageMetadata: {
            laneId: 'parent_private:wags',
            scopeId: 'telegram:dm:wags',
          },
        },
        {
          filename: 'blocked.pdf',
          storageMetadata: {
            laneId: 'child_private:kid',
            scopeId: 'telegram:dm:wags',
          },
        },
      ],
      allowedLaneIds: ['parent_private:wags'],
      allowedScopeIds: ['telegram:dm:wags'],
    });

    expect(policy.disallowedFilenames).toEqual(['blocked.pdf']);
  });

  it('blocks final output when it cites a disallowed filename', () => {
    const policy = buildScopeCitationPolicy({
      files: [
        {
          filename: 'blocked.pdf',
          storageMetadata: {
            laneId: 'child_private:kid',
            scopeId: 'telegram:dm:wags',
          },
        },
      ],
      allowedLaneIds: ['parent_private:wags'],
      allowedScopeIds: ['telegram:dm:wags'],
    });

    const result = applyScopeCitationPolicy(
      'The answer is from blocked.pdf and should not be shared here.',
      policy,
    );

    expect(result.blocked).toBe(true);
    expect(result.output).toBe(CITATION_POLICY_BLOCK_MESSAGE);
  });

  it('does NOT block when output word contains disallowed filename as substring (boundary match)', () => {
    const policy = buildScopeCitationPolicy({
      files: [
        {
          filename: 'report',
          storageMetadata: {
            laneId: 'child_private:kid',
            scopeId: 'telegram:dm:wags',
          },
        },
      ],
      allowedLaneIds: ['parent_private:wags'],
      allowedScopeIds: ['telegram:dm:wags'],
    });

    // "reported" contains "report" as a substring, but "report" is not a
    // standalone word/path boundary — boundary-aware matching must NOT block this
    const result = applyScopeCitationPolicy(
      'I reported the issue to the team.',
      policy,
    );

    expect(result.blocked).toBe(false);
    expect(result.output).toBe('I reported the issue to the team.');
  });
});
