import { z } from "zod";
import { CLUSTERS, FEE_MODES, U64_MAX } from "@app/shared";

export const OTC_PROTOCOL_VERSION = 1 as const;
export const OTC_METADATA_VERSION = 1 as const;
export const SOL_QUOTE_MINT = "SOL" as const;

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "invalid base58 address");
const hex32 = z.string().regex(/^[0-9a-f]{32}$/, "expected 32 lowercase hex chars");
const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex chars");
const CANONICAL_UINT = /^(0|[1-9]\d*)$/;
const u64String = z
  .string()
  .regex(CANONICAL_UINT, "expected a canonical non-negative integer string")
  // zod runs refinements even after the regex fails, so these must be total functions.
  .refine((s) => !CANONICAL_UINT.test(s) || BigInt(s) <= U64_MAX, "exceeds u64");
const positiveU64String = u64String.refine((s) => CANONICAL_UINT.test(s) && BigInt(s) > 0n, "must be greater than zero");
const unixSeconds = z.number().int().min(1_600_000_000).max(4_102_444_800);

/** C0/C1 control characters plus U+2028/U+2029 (line/paragraph separators). */
// eslint-disable-next-line no-control-regex -- matching control characters is the point: they must not enter signed text
const FORBIDDEN_TEXT = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");

/** Text that is embedded in a signed message: single line, no control characters, NFC. */
export const signedText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s === s.normalize("NFC"), "must be NFC-normalised")
    .refine((s) => !FORBIDDEN_TEXT.test(s), "control characters and line breaks are not allowed");

/**
 * The exact set of fields a maker signs. Changing ANY field changes the order hash and invalidates
 * the signature. Field order here is irrelevant: canonical serialization sorts keys.
 */
export const orderPayloadSchema = z
  .object({
    type: z.literal("otc-order"),
    version: z.literal(OTC_PROTOCOL_VERSION),
    orderId: hex32,
    environment: signedText(128).min(1),
    network: z.enum(CLUSTERS),
    genesisHash: base58,
    makerWallet: base58,
    takerWallet: base58.nullable(),
    tokenMint: base58,
    tokenProgram: base58,
    tokenDecimals: z.number().int().min(0).max(18),
    side: z.enum(["BUY", "SELL"]),
    tokenAmountRaw: positiveU64String,
    quoteMint: z.literal(SOL_QUOTE_MINT),
    quoteAmountRaw: positiveU64String,
    createdAt: unixSeconds,
    expiresAt: unixSeconds,
    nonce: hex32,
    salt: hex32,
    allowPartialFill: z.boolean(),
    minimumFillAmountRaw: u64String,
    platformFeeBps: z.number().int().min(0).max(1000),
    feeMode: z.enum(FEE_MODES),
    parentOrderHash: hex64.nullable(),
    note: signedText(280).nullable(),
    metadataVersion: z.literal(OTC_METADATA_VERSION),
  })
  .strict()
  .superRefine((o, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (o.expiresAt <= o.createdAt) add("expiresAt", "must be after createdAt");
    if (o.takerWallet !== null && o.takerWallet === o.makerWallet) add("takerWallet", "cannot equal makerWallet");
    if (!CANONICAL_UINT.test(o.tokenAmountRaw) || !CANONICAL_UINT.test(o.minimumFillAmountRaw)) return;
    const total = BigInt(o.tokenAmountRaw);
    const min = BigInt(o.minimumFillAmountRaw);
    if (o.allowPartialFill) {
      if (min === 0n || min > total) add("minimumFillAmountRaw", "must be between 1 and tokenAmountRaw when partial fills are allowed");
    } else if (min !== total) {
      add("minimumFillAmountRaw", "must equal tokenAmountRaw when partial fills are disabled");
    }
  });

export type OrderPayload = z.infer<typeof orderPayloadSchema>;

export const acceptPayloadSchema = z
  .object({
    type: z.literal("otc-accept"),
    version: z.literal(OTC_PROTOCOL_VERSION),
    environment: signedText(128).min(1),
    network: z.enum(CLUSTERS),
    genesisHash: base58,
    orderHash: hex64,
    acceptor: base58,
    fillAmountRaw: positiveU64String,
    quoteAmountRaw: positiveU64String,
    nonce: hex32,
    signedAt: unixSeconds,
  })
  .strict();
export type AcceptPayload = z.infer<typeof acceptPayloadSchema>;

export const cancelPayloadSchema = z
  .object({
    type: z.literal("otc-cancel"),
    version: z.literal(OTC_PROTOCOL_VERSION),
    environment: signedText(128).min(1),
    network: z.enum(CLUSTERS),
    genesisHash: base58,
    orderHash: hex64,
    maker: base58,
    nonce: hex32,
    signedAt: unixSeconds,
  })
  .strict();
export type CancelPayload = z.infer<typeof cancelPayloadSchema>;

export type AnyPayload = OrderPayload | AcceptPayload | CancelPayload;

/** The domain separator every signed OTC payload must carry. */
export interface OtcDomain {
  environment: string;
  network: (typeof CLUSTERS)[number];
  genesisHash: string;
}

export function sameDomain(p: OtcDomain, d: OtcDomain): boolean {
  return p.environment === d.environment && p.network === d.network && p.genesisHash === d.genesisHash;
}
