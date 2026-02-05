import { describe, expect, it } from 'vitest';

import {
  buildSchemaStatements,
  getScopeIndexPath,
  validateVectorStoreMetadata,
} from './vectorStore.js';

describe('vectorStore', () => {
  it('builds vec0 and fts5 schema with dimensions', () => {
    const statements = buildSchemaStatements(1536);
    const joined = statements.join('\n');
    expect(joined).toContain('fts5');
    expect(joined).toContain('vec0');
    expect(joined).toContain('FLOAT[1536]');
  });

  it('rejects mismatched embedding metadata', () => {
    expect(() =>
      validateVectorStoreMetadata(
        {
          embedding_provider: 'openai',
          embedding_model: 'text-embedding-3-small',
          embedding_dimensions: '1536',
        },
        {
          provider: 'openai',
          model: 'text-embedding-3-large',
          dimensions: 1536,
        },
      ),
    ).toThrow('Embedding model mismatch');
  });

  it('computes per-scope index path', () => {
    const path = getScopeIndexPath('/halo', 'telegram:dm:wags');
    expect(path).toContain('/halo/memory/scopes/');
    expect(path).toContain('index.sqlite');
  });
});
