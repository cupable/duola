import { Command } from "commander";
import { addLeader, inspectLeader, listLeaders, removeLeader } from "../leaders/service.js";
import { printOutput } from "../utils/output.js";
import { syncLeader } from "../sync/service.js";
import { runBacktest } from "../backtest/service.js";
import { initFollowProfile, showFollowProfile, updateFollowProfile } from "../follow/service.js";
import { getFollowLogs, getFollowStatus, startFollowRunner, stopFollowRunner } from "../follow/runner.js";
import { autopilotOnboard, autopilotResetSecret, autopilotStart, autopilotStatus, autopilotStop } from "../autopilot/service.js";
import { runDoctor } from "../doctor/service.js";
import { readSecretFromStdin } from "../utils/stdin.js";

const LIVE_CONFIRMATION_PHRASE = "I UNDERSTAND LIVE TRADING";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("duola")
    .description("Polymarket copy-trading CLI")
    .version("0.1.0");

  const leader = program.command("leader").description("Manage tracked leader wallets");

  leader
    .command("add")
    .argument("<address>", "Leader wallet address")
    .requiredOption("--name <alias>", "Local alias")
    .option("--notes <text>", "Optional notes")
    .option("--output <format>", "Output format: table or json", "table")
    .action((address, options) => {
      const record = addLeader(options.name, address, options.notes);
      printOutput(record, options.output);
    });

  leader
    .command("list")
    .option("--output <format>", "Output format: table or json", "table")
    .action((options) => {
      printOutput(listLeaders(), options.output);
    });

  leader
    .command("remove")
    .argument("<aliasOrAddress>", "Alias or wallet address")
    .action((aliasOrAddress) => {
      const removed = removeLeader(aliasOrAddress);
      if (!removed) {
        throw new Error(`Leader not found: ${aliasOrAddress}`);
      }
      console.log(`Removed ${aliasOrAddress}`);
    });

  leader
    .command("inspect")
    .argument("<aliasOrAddress>", "Alias or wallet address")
    .option("--output <format>", "Output format: table or json", "table")
    .action((aliasOrAddress, options) => {
      const details = inspectLeader(aliasOrAddress);
      printOutput(details, options.output);
    });

  program
    .command("sync")
    .argument("<aliasOrAddress>", "Alias or wallet address")
    .option("--limit <number>", "Maximum events to fetch", "200")
    .option("--output <format>", "Output format: table or json", "table")
    .action(async (aliasOrAddress, options) => {
      const result = await syncLeader(aliasOrAddress, Number(options.limit));
      printOutput(result, options.output);
    });

  program
    .command("doctor")
    .argument("[alias]", "Optional leader alias")
    .option("--output <format>", "Output format: table or json", "table")
    .action(async (alias, options) => {
      const result = await runDoctor(alias);
      printOutput(result, options.output);
    });

  program
    .command("backtest")
    .argument("<aliasOrAddress>", "Alias or wallet address")
    .option("--lookback <duration>", "Lookback window, e.g. 7d or 24h", "7d")
    .option("--fixed-usd <number>", "Fixed notional per copied trade", "25")
    .option("--min-liquidity <number>", "Minimum market liquidity in USD", "5000")
    .option("--min-time-to-expiry <seconds>", "Minimum time to expiry in seconds", "3600")
    .option("--output <format>", "Output format: table or json", "table")
    .action(async (aliasOrAddress, options) => {
      const report = await runBacktest(aliasOrAddress, {
        lookback: options.lookback,
        fixedUsd: Number(options.fixedUsd),
        minLiquidityUsd: Number(options.minLiquidity),
        minTimeToExpirySec: Number(options.minTimeToExpiry),
        outputFormat: options.output
      });
      printOutput(report, options.output);
    });

  const follow = program.command("follow").description("Manage follow profiles");

  follow
    .command("init")
    .argument("<aliasOrAddress>", "Alias or wallet address")
    .option("--profile <name>", "Profile: conservative, balanced, aggressive", "balanced")
    .option("--output <format>", "Output format: table or json", "table")
    .action((aliasOrAddress, options) => {
      const result = initFollowProfile(aliasOrAddress, options.profile);
      printOutput(result, options.output);
    });

  follow
    .command("show-config")
    .argument("<alias>", "Leader alias")
    .option("--output <format>", "Output format: table or json", "table")
    .action((alias, options) => {
      printOutput(showFollowProfile(alias), options.output);
    });

  follow
    .command("config")
    .description("Update follow profile values")
    .command("set")
    .argument("<alias>", "Leader alias")
    .argument("<key>", "Dot path, e.g. sizing.fixed_usd")
    .argument("<value>", "New value")
    .option("--output <format>", "Output format: table or json", "table")
    .action((alias, key, value, options) => {
      const updated = updateFollowProfile(alias, key, value);
      printOutput(updated, options.output);
    });

  follow
    .command("start")
    .argument("<alias>", "Leader alias")
    .requiredOption(
      "--confirm-live <phrase>",
      `Must exactly equal: ${LIVE_CONFIRMATION_PHRASE}`
    )
    .option("--max-cycles <number>", "Stop after N polling cycles", "0")
    .option("--output <format>", "Output format: table or json", "table")
    .action(async (alias, options) => {
      if (options.confirmLive !== LIVE_CONFIRMATION_PHRASE) {
        throw new Error(`Invalid confirmation phrase. Expected: ${LIVE_CONFIRMATION_PHRASE}`);
      }

      const result = await startFollowRunner(alias, {
        maxCycles: Number(options.maxCycles) > 0 ? Number(options.maxCycles) : undefined
      });
      printOutput(result, options.output);
    });

  follow
    .command("stop")
    .argument("<alias>", "Leader alias")
    .option("--output <format>", "Output format: table or json", "table")
    .action((alias, options) => {
      printOutput(stopFollowRunner(alias), options.output);
    });

  follow
    .command("status")
    .argument("<alias>", "Leader alias")
    .option("--output <format>", "Output format: table or json", "table")
    .action((alias, options) => {
      printOutput(getFollowStatus(alias), options.output);
    });

  follow
    .command("logs")
    .argument("<alias>", "Leader alias")
    .option("--tail <number>", "Rows to return", "50")
    .option("--output <format>", "Output format: table or json", "table")
    .action((alias, options) => {
      printOutput(getFollowLogs(alias, Number(options.tail)), options.output);
    });

  const autopilot = program.command("autopilot").description("Single-entry workflow for agent-driven usage");

  autopilot
    .command("onboard")
    .argument("<leaderAddress>", "Leader wallet address")
    .requiredOption("--name <alias>", "Local alias")
    .option("--private-key <key>", "Follower wallet private key")
    .option("--private-key-stdin", "Read follower wallet private key from stdin", false)
    .option("--profile <name>", "Profile: conservative, balanced, aggressive", "balanced")
    .option("--sync-limit <number>", "Initial sync event count", "200")
    .option("--output <format>", "Output format: table or json", "table")
    .action(async (leaderAddress, options) => {
      const usingInlineKey = typeof options.privateKey === "string" && options.privateKey.length > 0;
      const usingStdinKey = Boolean(options.privateKeyStdin);

      if (usingInlineKey === usingStdinKey) {
        throw new Error("Provide exactly one of --private-key or --private-key-stdin.");
      }

      const privateKey = usingInlineKey ? options.privateKey : await readSecretFromStdin();
      const result = await autopilotOnboard(
        leaderAddress,
        options.name,
        privateKey,
        options.profile,
        Number(options.syncLimit)
      );
      printOutput(result, options.output);
    });

  autopilot
    .command("start")
    .argument("<alias>", "Leader alias")
    .requiredOption(
      "--confirm-live <phrase>",
      `Must exactly equal: ${LIVE_CONFIRMATION_PHRASE}`
    )
    .option("--detach", "Run the follow loop in the background", false)
    .option("--max-cycles <number>", "Stop after N polling cycles", "0")
    .option("--output <format>", "Output format: table or json", "table")
    .action(async (alias, options) => {
      if (options.confirmLive !== LIVE_CONFIRMATION_PHRASE) {
        throw new Error(`Invalid confirmation phrase. Expected: ${LIVE_CONFIRMATION_PHRASE}`);
      }

      const result = await autopilotStart(
        alias,
        options.confirmLive,
        {
          maxCycles: Number(options.maxCycles) > 0 ? Number(options.maxCycles) : undefined,
          detach: Boolean(options.detach)
        }
      );
      printOutput(result, options.output);
    });

  autopilot
    .command("status")
    .argument("<alias>", "Leader alias")
    .option("--output <format>", "Output format: table or json", "table")
    .action((alias, options) => {
      printOutput(autopilotStatus(alias), options.output);
    });

  autopilot
    .command("stop")
    .argument("<alias>", "Leader alias")
    .option("--output <format>", "Output format: table or json", "table")
    .action((alias, options) => {
      printOutput(autopilotStop(alias), options.output);
    });

  autopilot
    .command("reset-secret")
    .argument("<alias>", "Leader alias")
    .option("--output <format>", "Output format: table or json", "table")
    .action((alias, options) => {
      printOutput(autopilotResetSecret(alias), options.output);
    });

  return program;
}
