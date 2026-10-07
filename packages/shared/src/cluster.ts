export const CLUSTERS = ["devnet", "mainnet-beta", "testnet", "localnet"] as const;
export type Cluster = (typeof CLUSTERS)[number];

/**
 * Genesis hashes identify a network unambiguously and are part of every signed-message domain
 * separator, so a signature produced for devnet can never be replayed on mainnet. localnet genesis
 * hashes differ per validator and must be supplied via SOLANA_GENESIS_HASH.
 */
export const GENESIS_HASHES: Record<Exclude<Cluster, "localnet">, string> = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
};

export function explorerTxUrl(signature: string, cluster: Cluster): string {
  return `https://solscan.io/tx/${signature}${clusterQuery(cluster)}`;
}

export function explorerAccountUrl(address: string, cluster: Cluster): string {
  return `https://solscan.io/account/${address}${clusterQuery(cluster)}`;
}

function clusterQuery(cluster: Cluster): string {
  if (cluster === "mainnet-beta") return "";
  if (cluster === "localnet") return "?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899";
  return `?cluster=${cluster}`;
}
