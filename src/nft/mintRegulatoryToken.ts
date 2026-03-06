/**
 * XLS-20 Regulatory State Token — URI Token Minting (Xahau)
 *
 * This module implements Step 3 of the PoC: minting a "Regulatory State Token"
 * on the Xahau Testnet.
 *
 * IMPORTANT: Xahau uses the URIToken standard instead of XRPL's NFToken (XLS-20).
 * URIToken is Xahau's native on-chain token with an embedded URI field — it
 * serves the same conceptual purpose as an NFT for this PoC.
 *
 * The token represents the *current state* of the MiCA Article 54 rule. Its URI
 * field contains the full, machine-readable rule parameters encoded as JSON.
 * Regulatory changes are broadcast by burning the old token and minting a new
 * one with updated metadata — creating an auditable history on-chain.
 *
 * Design choices:
 * - URI embeds the full rule JSON, making the token self-describing
 * - tfBurnable flag is NOT set — only the issuer can burn (regulatory control)
 * - Burning and re-minting simulates a regulatory rule update cycle
 * - URITokenID is deterministically computed from issuer + URI (hashURIToken)
 *
 * Xahau URIToken Specification:
 *   https://xahau.network/transactoin-types/uritokenmint
 */

import {
  Client,
  Wallet,
  convertStringToHex,
  URITokenMint,
  URITokenBurn,
  hashes,
} from "xahau";
import { NETWORKS } from "../config";
import {
  MiCARule,
  MICA_ARTICLE_54_RULE,
  encodeRuleAsJSON,
} from "../rules/micaRules";

export interface RegulatoryTokenResult {
  minter: string;
  uriTokenId: string;
  uri: string;
  uriDecoded: string;
  mintTxHash: string;
  explorerUrl: string;
}

/**
 * Mints a Regulatory State Token (URIToken) on the Xahau Testnet.
 *
 * The URI embeds the encoded MiCA rule so that any network participant can
 * read the rule parameters directly from the ledger — no external database
 * or oracle required.
 *
 * @param regulatorWallet - The Regulatory Authority account that mints the token
 * @param client          - Connected Xahau client
 * @param rule            - The MiCA rule to embed (defaults to Article 54)
 */
export async function mintRegulatoryStateToken(
  regulatorWallet: Wallet,
  client: Client,
  rule: MiCARule = MICA_ARTICLE_54_RULE
): Promise<RegulatoryTokenResult> {
  const ruleJson = encodeRuleAsJSON(rule);
  const tokenUri = `data:application/json;charset=utf-8,${ruleJson}`;
  const tokenUriHex = convertStringToHex(tokenUri);

  // Deterministically compute the URITokenID from issuer address + URI
  const uriTokenId = hashes.hashURIToken(regulatorWallet.address, tokenUri);

  console.log("\n--- Minting Regulatory State Token (Xahau URIToken) ---");
  console.log(`  Minter       : ${regulatorWallet.address}`);
  console.log(`  Rule ID      : ${rule.ruleId}`);
  console.log(`  URIToken ID  : ${uriTokenId}`);
  console.log(`  URI (preview): ${tokenUri.slice(0, 80)}...`);

  const mintTx: URITokenMint = {
    TransactionType: "URITokenMint",
    Account: regulatorWallet.address,
    URI: tokenUriHex,
    // Flags: 0 → NOT burnable by anyone other than the issuer (regulatory control)
    Flags: 0,
  };

  const mintResult = await client.submitAndWait(mintTx, {
    wallet: regulatorWallet,
  });

  if (
    typeof mintResult.result.meta === "object" &&
    mintResult.result.meta !== null &&
    "TransactionResult" in mintResult.result.meta &&
    mintResult.result.meta.TransactionResult !== "tesSUCCESS"
  ) {
    throw new Error(
      `URITokenMint failed: ${JSON.stringify(mintResult.result.meta)}`
    );
  }

  const mintTxHash = mintResult.result.hash;
  console.log(`  TX Hash      : ${mintTxHash}`);
  console.log(`  Result       : tesSUCCESS`);

  return {
    minter: regulatorWallet.address,
    uriTokenId,
    uri: tokenUriHex,
    uriDecoded: tokenUri,
    mintTxHash,
    explorerUrl: `${NETWORKS.XAHAU_TESTNET.explorer}/accounts/${regulatorWallet.address}`,
  };
}

/**
 * Queries the Xahau ledger and retrieves all Regulatory State Tokens
 * (URIToken objects) held by the given account.
 */
export async function getRegulatoryTokens(
  accountAddress: string,
  client: Client
): Promise<Array<{ uriTokenId: string; uri: string; uriDecoded: string }>> {
  const response = await client.request({
    command: "account_objects",
    account: accountAddress,
    type: "uri_token" as "check", // 'uri_token' is valid on Xahau but not in base typings
  } as Parameters<typeof client.request>[0]);

  const objects = (
    response.result as { account_objects: Array<Record<string, unknown>> }
  ).account_objects;

  return objects.map((obj) => {
    const uriHex = (obj.URI as string) ?? "";
    const uriDecoded = Buffer.from(uriHex, "hex").toString("utf8");
    return {
      uriTokenId: obj.index as string,
      uri: uriHex,
      uriDecoded,
    };
  });
}

/**
 * Burns an existing Regulatory State Token to simulate a rule version update.
 * The caller should then mint a new token with updated rule metadata.
 *
 * This burn-and-remint pattern models how regulators could invalidate old
 * rule states and publish new ones — creating an auditable history on-chain.
 */
export async function burnRegulatoryStateToken(
  regulatorWallet: Wallet,
  uriTokenId: string,
  client: Client
): Promise<string> {
  console.log(`\n--- Burning outdated Regulatory State Token ---`);
  console.log(`  URIToken ID: ${uriTokenId}`);

  const burnTx: URITokenBurn = {
    TransactionType: "URITokenBurn",
    Account: regulatorWallet.address,
    URITokenID: uriTokenId,
  };

  const result = await client.submitAndWait(burnTx, {
    wallet: regulatorWallet,
  });

  console.log(`  TX Hash: ${result.result.hash}`);
  console.log(`  Result : tesSUCCESS`);

  return result.result.hash;
}
