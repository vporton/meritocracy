import fetch from 'node-fetch';

const DEFAULT_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const KEEPALIVE_PATH = '/api/cron/status';

/**
 * Keep Fly.io machines awake during long-running operations by periodically
 * calling this service's own public API URL.
 */
export function startApiSelfKeepAlive(taskName: string, intervalMs: number = DEFAULT_INTERVAL_MS): () => void {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    console.log(`⏭️  Self-keepalive skipped for "${taskName}" because API_URL is not set`);
    return () => {};
  }

  let inFlight = false;
  const targetUrl = new URL(KEEPALIVE_PATH, apiUrl).toString();

  const pingSelf = async () => {
    if (inFlight) {
      return;
    }

    inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      await fetch(targetUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'meritocracy-self-keepalive'
        }
      });
    } catch (error) {
      console.warn(
        `⚠️  Self-keepalive ping failed for "${taskName}":`,
        error instanceof Error ? error.message : error
      );
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void pingSelf();
  }, intervalMs);

  console.log(`💓 Self-keepalive enabled for "${taskName}" every ${Math.floor(intervalMs / 1000)} seconds`);

  return () => {
    clearInterval(timer);
    console.log(`🛑 Self-keepalive stopped for "${taskName}"`);
  };
}
