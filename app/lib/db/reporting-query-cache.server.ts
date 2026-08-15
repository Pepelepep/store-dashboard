import { promisify } from "node:util";
import { gzip, gunzip, constants as zlibConstants } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_BYTES = 48 * 1024 * 1024;

type CacheEntry = {
  compressed: Buffer;
  expiresAt: number;
};

function positiveIntegerFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class ReportingQueryCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly options: {
    ttlMs: number;
    maxBytes: number;
    now?: () => number;
  };
  private totalBytes = 0;

  constructor(options: {
    ttlMs: number;
    maxBytes: number;
    now?: () => number;
  }) {
    this.options = options;
  }

  private currentTime() {
    return this.options.now?.() ?? Date.now();
  }

  private deleteEntry(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.totalBytes -= entry.compressed.byteLength;
    this.entries.delete(key);
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.deleteEntry(key);
    }
  }

  private store(key: string, compressed: Buffer, now: number) {
    if (compressed.byteLength > this.options.maxBytes) return;

    this.deleteEntry(key);
    while (
      this.totalBytes + compressed.byteLength > this.options.maxBytes &&
      this.entries.size > 0
    ) {
      const oldestKey = this.entries.keys().next().value as string;
      this.deleteEntry(oldestKey);
    }

    this.entries.set(key, {
      compressed,
      expiresAt: now + this.options.ttlMs,
    });
    this.totalBytes += compressed.byteLength;
  }

  async getOrLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.currentTime();
    this.pruneExpired(now);

    const cached = this.entries.get(key);
    if (cached) {
      // Refresh insertion order so eviction is least-recently-used.
      this.entries.delete(key);
      this.entries.set(key, cached);
      const json = await gunzipAsync(cached.compressed);
      return JSON.parse(json.toString("utf8")) as T;
    }

    const existingLoad = this.inFlight.get(key);
    if (existingLoad) return existingLoad as Promise<T>;

    const pending = load()
      .then(async (value) => {
        // Caching is an optimization only. Serialization/compression failure
        // must never turn a successful database read into a failed report.
        try {
          const json = JSON.stringify(value);
          const compressed = await gzipAsync(Buffer.from(json), {
            level: zlibConstants.Z_BEST_SPEED,
          });
          this.store(key, compressed, this.currentTime());
        } catch {
          // Return the loaded value uncached.
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      });

    this.inFlight.set(key, pending);
    return pending;
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
    this.totalBytes = 0;
  }
}

const reportingQueryCache = new ReportingQueryCache({
  ttlMs: positiveIntegerFromEnv(
    process.env.REPORTING_QUERY_CACHE_TTL_MS,
    DEFAULT_TTL_MS,
  ),
  maxBytes: positiveIntegerFromEnv(
    process.env.REPORTING_QUERY_CACHE_MAX_BYTES,
    DEFAULT_MAX_BYTES,
  ),
});

export function reportingCacheKey(
  namespace: string,
  parts: Array<string | number | boolean | null | string[]>,
) {
  return `${namespace}:${JSON.stringify(parts)}`;
}

export function getCachedReportingQuery<T>(
  key: string,
  load: () => Promise<T>,
) {
  return reportingQueryCache.getOrLoad(key, load);
}
