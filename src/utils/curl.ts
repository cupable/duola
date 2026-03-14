import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function proxyUrl(): string | null {
  return process.env.POLYMARKET_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? null;
}

export async function curlJson<T>(url: string, maxTimeSeconds = 20): Promise<T> {
  const command = buildCurlCommand(url, maxTimeSeconds);
  const { stdout } = await execAsync(command, {
    maxBuffer: 1024 * 1024 * 10
  });

  return JSON.parse(stdout) as T;
}

export async function curlStatus(url: string, maxTimeSeconds = 10): Promise<{ ok: boolean; status: string }> {
  const proxySegment = proxyUrl() ? ` -x '${proxyUrl()}'` : "";
  const command = `curl -sS --max-time ${maxTimeSeconds} -o /dev/null -w '%{http_code}'${proxySegment} '${url}'`;

  try {
    const { stdout } = await execAsync(command, {
      maxBuffer: 1024 * 1024
    });
    const code = stdout.trim();
    return {
      ok: code.startsWith("2") || code.startsWith("4"),
      status: code
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: message
    };
  }
}

function buildCurlCommand(url: string, maxTimeSeconds: number): string {
  const proxySegment = proxyUrl() ? ` -x '${proxyUrl()}'` : "";
  return `curl -sS --max-time ${maxTimeSeconds}${proxySegment} '${url}'`;
}
