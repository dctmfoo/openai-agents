type Syncable = { sync: () => Promise<void> };

class CompositeSyncManager {
  private readonly managers: Syncable[];

  constructor(managers: Syncable[]) {
    this.managers = managers;
  }

  async sync(): Promise<void> {
    for (const m of this.managers) {
      await m.sync();
    }
  }
}

export { CompositeSyncManager };
