import { ClobClient, OrderType, Side, type TickSize } from "@polymarket/clob-client";
import { Wallet } from "ethers";

interface SdkConfig {
  host: string;
  chainId: number;
  privateKey: string;
  signatureType: number;
  funderAddress: string;
}

let clientPromise: Promise<ClobClient> | null = null;

export interface SdkExecutionRequest {
  leaderAlias?: string;
  assetId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  tickSize?: number;
  negRisk?: boolean;
}

export interface SdkExecutionResult {
  orderId: string | null;
  status: string;
  filledPrice: number | null;
  filledSize: number | null;
  rawOutput: string;
}

export async function executeWithPolymarketSdk(request: SdkExecutionRequest): Promise<SdkExecutionResult> {
  const client = await getClient(request.leaderAlias);
  const side = request.side === "SELL" ? Side.SELL : Side.BUY;
  const tickSize = normalizeTickSize(request.tickSize);

  const signedOrder = await client.createOrder(
    {
      tokenID: request.assetId,
      price: request.price,
      size: request.size,
      side
    },
    {
      tickSize,
      negRisk: request.negRisk ?? false
    }
  );

  const response = await client.postOrder(signedOrder, OrderType.GTC);
  const parsed = response as Record<string, unknown>;
  const orderId = getString(parsed, "orderID") ?? getString(parsed, "orderId") ?? null;
  const status = getString(parsed, "status") ?? "placed";
  const filledPrice = getNumber(parsed, "takingAmount") && getNumber(parsed, "makingAmount")
    ? getNumber(parsed, "takingAmount")! / getNumber(parsed, "makingAmount")!
    : null;
  const filledSize = getNumber(parsed, "makingAmount") ?? null;

  return {
    orderId,
    status,
    filledPrice,
    filledSize,
    rawOutput: JSON.stringify(response)
  };
}

async function getClient(alias?: string): Promise<ClobClient> {
  if (clientPromise) {
    return clientPromise;
  }

  clientPromise = buildClient(alias);
  return clientPromise;
}

async function buildClient(alias?: string): Promise<ClobClient> {
  const config = await readConfig(alias);
  const signer = new Wallet(config.privateKey);
  const baseClient = new ClobClient(
    config.host,
    config.chainId,
    signer,
    undefined,
    config.signatureType,
    config.funderAddress
  );

  const apiCreds = await baseClient.createOrDeriveApiKey();
  return new ClobClient(
    config.host,
    config.chainId,
    signer,
    apiCreds,
    config.signatureType,
    config.funderAddress
  );
}

async function readConfig(alias?: string): Promise<SdkConfig> {
  const { loadPrivateKey } = await import("../config/secrets.js");
  const privateKey = process.env.DUOLA_PRIVATE_KEY ?? (alias ? loadPrivateKey(alias) : null);
  if (!privateKey) {
    throw new Error("A stored private key or DUOLA_PRIVATE_KEY is required for built-in Polymarket execution");
  }

  const host = process.env.DUOLA_CLOB_HOST ?? "https://clob.polymarket.com";
  const chainId = Number(process.env.DUOLA_CHAIN_ID ?? "137");
  const signatureType = Number(process.env.DUOLA_SIGNATURE_TYPE ?? "0");
  const fallbackFunder = new Wallet(privateKey).address;
  const funderAddress = process.env.DUOLA_FUNDER_ADDRESS ?? fallbackFunder;

  if (!Number.isFinite(chainId)) {
    throw new Error("DUOLA_CHAIN_ID must be numeric");
  }

  if (!Number.isFinite(signatureType)) {
    throw new Error("DUOLA_SIGNATURE_TYPE must be numeric");
  }

  if ((signatureType === 1 || signatureType === 2) && !process.env.DUOLA_FUNDER_ADDRESS) {
    throw new Error("DUOLA_FUNDER_ADDRESS is required when DUOLA_SIGNATURE_TYPE is 1 or 2");
  }

  return {
    host,
    chainId,
    privateKey,
    signatureType,
    funderAddress
  };
}

function normalizeTickSize(value?: number): TickSize {
  if (!value || !Number.isFinite(value) || value >= 0.1) {
    return "0.1";
  }

  if (value >= 0.01) {
    return "0.01";
  }

  if (value >= 0.001) {
    return "0.001";
  }

  return "0.0001";
}

function getString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : null;
}

function getNumber(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key];
  if (typeof candidate === "number") {
    return candidate;
  }
  if (typeof candidate === "string") {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
