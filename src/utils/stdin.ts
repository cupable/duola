export async function readSecretFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("stdin is a TTY. Pipe the secret in, or use --private-key.");
  }

  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const value = Buffer.concat(chunks).toString("utf8").trim();
  if (!value) {
    throw new Error("No secret received on stdin.");
  }

  return value;
}
