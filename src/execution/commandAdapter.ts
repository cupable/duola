import { exec } from "node:child_process";
import { promisify } from "node:util";
import { executeWithPolymarketSdk } from "./polymarketSdk.js";

const execAsync = promisify(exec);

export interface ExecutionRequest {
  leaderAlias: string;
  sourceUid: string;
  conditionId: string;
  assetId: string;
  side: string;
  requestedUsd: number;
  requestedPrice: number;
  requestedSize: number;
  maxSlippageBps: number;
  tickSize?: number;
  negRisk?: boolean;
}

export interface ExecutionResult {
  orderId: string | null;
  status: string;
  filledPrice: number | null;
  filledSize: number | null;
  rawOutput?: string;
}

export async function executeLiveOrder(request: ExecutionRequest): Promise<ExecutionResult> {
  const command = process.env.DUOLA_EXECUTION_COMMAND;

  if (!command) {
    return executeWithPolymarketSdk({
      leaderAlias: request.leaderAlias,
      assetId: request.assetId,
      side: request.side === "SELL" ? "SELL" : "BUY",
      price: request.requestedPrice,
      size: request.requestedSize,
      tickSize: request.tickSize,
      negRisk: request.negRisk
    });
  }

  const payload = JSON.stringify(request).replace(/'/g, "'\\''");
  const shellCommand = `printf '%s' '${payload}' | ${command}`;
  const { stdout } = await execAsync(shellCommand, {
    maxBuffer: 1024 * 1024 * 10
  });

  const parsed = parseExecutionResult(stdout);
  return {
    ...parsed,
    rawOutput: stdout
  };
}

function parseExecutionResult(stdout: string): ExecutionResult {
  const output = stdout.trim();

  if (!output) {
    throw new Error("Execution command returned empty output");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output) as Record<string, unknown>;
  } catch {
    throw new Error("Execution command must return JSON");
  }

  return {
    orderId: typeof parsed.orderId === "string" ? parsed.orderId : null,
    status: typeof parsed.status === "string" ? parsed.status : "filled",
    filledPrice: typeof parsed.filledPrice === "number" ? parsed.filledPrice : null,
    filledSize: typeof parsed.filledSize === "number" ? parsed.filledSize : null
  };
}
