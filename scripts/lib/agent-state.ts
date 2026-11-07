/**
 * Simulated-agent state, kept in the OS temp dir per API (never in the repo): the device token
 * (the real app keeps it in DPAPI), the operator token and run statistics. load-orders reads it
 * to play "customer shows the pickup code at the counter".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './common.js';

export interface AgentStats {
  startedAt: string;
  updatedAt: string;
  hints: Record<string, number>;
  /** job.created: transition time (payload `at`) → hint received, ms. */
  hintLatencyMs: number[];
  socketConnects: number;
  heartbeats: number;
  accepted: number;
  rejected: number;
  leased: number;
  printed: number;
  printFailed: number;
  checksumMismatches: number;
  ready: number;
  errors: Record<string, number>;
}

export interface AgentState {
  api: string;
  shopSlug: string;
  shopId: string;
  shopName: string;
  deviceId: string;
  deviceToken: string;
  operatorToken: string | null;
  printerId: string | null;
  stats: AgentStats;
}

export const agentStateFile = (api: string, shopSlug: string) =>
  join(stateDir(api), `agent-${shopSlug}.json`);

export function readAgentState(api: string, shopSlug: string): AgentState | null {
  const file = agentStateFile(api, shopSlug);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AgentState;
  } catch {
    return null;
  }
}

export function writeAgentState(state: AgentState): void {
  writeFileSync(agentStateFile(state.api, state.shopSlug), JSON.stringify(state, null, 2));
}

export function emptyStats(): AgentStats {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    updatedAt: now,
    hints: {},
    hintLatencyMs: [],
    socketConnects: 0,
    heartbeats: 0,
    accepted: 0,
    rejected: 0,
    leased: 0,
    printed: 0,
    printFailed: 0,
    checksumMismatches: 0,
    ready: 0,
    errors: {},
  };
}
