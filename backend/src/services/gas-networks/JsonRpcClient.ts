import fetch from 'node-fetch';

export interface RpcCommandClient {
  command(method: string, ...params: unknown[]): Promise<any>;
}

interface JsonRpcClientOptions {
  url: string;
  username?: string;
  password?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Minimal JSON-RPC client used instead of the unmaintained request-based
 * bitcoin-core package and its vulnerable transitive dependency chain. */
export class JsonRpcClient implements RpcCommandClient {
  private requestId = 0;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor({ url, username, password, headers, timeoutMs = 30_000 }: JsonRpcClientOptions) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('RPC URL must use HTTP or HTTPS');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('RPC credentials must be configured separately from the URL');
    }
    this.url = parsedUrl.toString();
    this.timeoutMs = timeoutMs;
    this.headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    };
    if (username && password) {
      this.headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }
  }

  async command(method: string, ...params: unknown[]): Promise<any> {
    if (!/^[a-z][a-z0-9_]*$/i.test(method)) {
      throw new Error('Invalid RPC method');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params }),
        signal: controller.signal,
        size: 10 * 1024 * 1024,
      });
      if (!response.ok) {
        throw new Error(`RPC request failed with status ${response.status}`);
      }

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 10 * 1024 * 1024) {
        throw new Error('RPC response exceeded the 10 MiB limit');
      }
      const payload = JSON.parse(text) as { result?: unknown; error?: { code?: unknown; message?: unknown } };
      if (payload.error) {
        const code = typeof payload.error.code === 'number' ? ` (${payload.error.code})` : '';
        const message = typeof payload.error.message === 'string' ? payload.error.message : 'Unknown RPC error';
        throw new Error(`RPC error${code}: ${message}`);
      }
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }
}
