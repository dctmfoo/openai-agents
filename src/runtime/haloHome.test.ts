import { describe, expect, it } from 'vitest';
import { getHaloHome } from './haloHome.js';
import path from 'node:path';
import { homedir } from 'node:os';

describe('getHaloHome', () => {
  it('uses HALO_HOME when set', () => {
    expect(getHaloHome({ HALO_HOME: '/tmp/halo' } as any)).toBe('/tmp/halo');
  });

  it('defaults to ~/.halo', () => {
    expect(getHaloHome({} as any)).toBe(path.join(homedir(), '.halo'));
  });
});
