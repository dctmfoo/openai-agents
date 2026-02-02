import { describe, expect, it } from 'vitest';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const adminRoot = path.join(repoRoot, 'apps', 'admin');

const expectPathExists = async (targetPath: string) => {
  await expect(access(targetPath)).resolves.toBeUndefined();
};

describe('admin tauri scaffold', () => {
  it('creates the expected directory structure', async () => {
    await expectPathExists(adminRoot);
    const adminStats = await stat(adminRoot);
    expect(adminStats.isDirectory()).toBe(true);

    await expectPathExists(path.join(adminRoot, 'src-tauri', 'Cargo.toml'));
    await expectPathExists(path.join(adminRoot, 'src-tauri', 'src', 'main.rs'));
    await expectPathExists(path.join(adminRoot, 'src-tauri', 'tauri.conf.json'));
    await expectPathExists(path.join(adminRoot, 'frontend', 'index.html'));
  });

  it('documents how to run the app', async () => {
    const readme = await readFile(path.join(adminRoot, 'README.md'), 'utf8');
    expect(readme).toMatch(/pnpm/i);
    expect(readme).toMatch(/tauri dev/i);
  });

  it('references tauri v2 in the Rust manifest', async () => {
    const cargoToml = await readFile(path.join(adminRoot, 'src-tauri', 'Cargo.toml'), 'utf8');
    expect(cargoToml).toMatch(/tauri\s*=\s*\{[^}]*version\s*=\s*"2/);
    expect(cargoToml).toMatch(/tauri-build/);
  });

  it('points to a frontend dist folder', async () => {
    const config = await readFile(path.join(adminRoot, 'src-tauri', 'tauri.conf.json'), 'utf8');
    expect(config).toMatch(/"frontendDist"/);
    expect(config).toMatch(/frontend/);
  });
});
