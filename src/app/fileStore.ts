import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AccountSubscription, InMemorySubscriptionStore } from './store';

/**
 * File-backed SubscriptionStore for long-running Node/Docker deployments.
 */
export class FileSubscriptionStore extends InMemorySubscriptionStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
    if (existsSync(filePath)) {
      this.loadFromDisk(filePath);
    }
  }

  override async upsert(subscription: AccountSubscription): Promise<AccountSubscription> {
    const saved = await super.upsert(subscription);
    this.persist();
    return saved;
  }

  private loadFromDisk(path: string): void {
    try {
      const raw = readFileSync(path, 'utf8');
      const items = JSON.parse(raw) as AccountSubscription[];
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item && typeof item.accountId === 'number') {
            this.records.set(item.accountId, item);
          }
        }
      }
    } catch {
      // Ignore corrupt or empty store file and start clean.
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(
      this.filePath,
      JSON.stringify(Array.from(this.records.values()), null, 2),
      'utf8'
    );
  }
}
