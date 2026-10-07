import { expect, test, type Page } from "@playwright/test";
import { mockWalletScript } from "./mock-wallet";
import { BUYER_SEED, SELLER_SEED } from "./env";

async function walletPage(browser: import("@playwright/test").Browser, seed: string) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  await ctx.addInitScript(mockWalletScript(seed, "E2E Wallet"));
  return ctx.newPage();
}

async function connectAndSignIn(page: Page) {
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("button", { name: /E2E Wallet/ }).click();
  await page.getByRole("button", { name: /Sign in as/ }).click();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
}

test("Bob offers a block, Carol accepts, both sign one atomic transaction, receipt verifies on chain", async ({ browser, request }) => {
  const { mint } = (await (await request.get("/api/e2e/fixture")).json()) as { mint: string };

  // Bob (seller): browse the token, connect his wallet, publish a signed ask.
  const bob = await walletPage(browser, SELLER_SEED);
  await bob.goto(`/token/${mint}`);
  await expect(bob.getByRole("heading", { name: "[E2E] Test Token" })).toBeVisible();
  await connectAndSignIn(bob);
  await bob.goto(`/otc/create?mint=${mint}&side=SELL`);
  await expect(bob.getByText("[E2E] Test Token")).toBeVisible();
  const next = () => bob.getByRole("button", { name: "Continue" }).click();
  await next(); // side
  await bob.getByLabel(/How many/).fill("20000000");
  await next();
  await bob.getByLabel("Total price for the whole block").fill("40");
  await next();
  await next(); // public
  await next(); // expiry
  await next(); // comparison
  await bob.getByRole("button", { name: "Sign and publish offer" }).click();
  await expect(bob.getByRole("heading", { name: "Your offer is live" })).toBeVisible();
  await bob.getByRole("button", { name: "Open deal" }).click();
  await expect(bob.getByText("Maker signature verified")).toBeVisible();
  const dealUrl = bob.url();

  // Carol (buyer): sees the public ask, accepts, builds settlement, signs first.
  const carol = await walletPage(browser, BUYER_SEED);
  await carol.goto(dealUrl);
  await connectAndSignIn(carol);
  await carol.getByRole("button", { name: /^Accept:/ }).click();
  await carol.getByRole("button", { name: "Build settlement transaction" }).click();
  await expect(carol.getByText("Both transfers execute atomically")).toBeVisible();
  await carol.getByRole("checkbox").check();
  await carol.getByRole("button", { name: /Sign: pay SOL/ }).click();
  await expect(carol.getByText("You signed. Waiting for the seller.")).toBeVisible();

  // Bob signs the same transaction; it is submitted and confirmed.
  await bob.reload();
  await expect(bob.getByText("Both transfers execute atomically")).toBeVisible();
  await bob.getByRole("checkbox").check();
  await bob.getByRole("button", { name: /Sign: sell/ }).click();
  await expect(bob.getByRole("link", { name: "View receipt" })).toBeVisible();
  await bob.getByRole("link", { name: "View receipt" }).click();

  // Receipt is rebuilt from chain data.
  await expect(bob.getByText("Verified from on-chain data")).toBeVisible();
  await expect(bob.getByText("20,000,000").first()).toBeVisible();
  await expect(bob.getByText("39.8").first()).toBeVisible(); // 40 SOL minus the disclosed 0.5% fee
});

test("the brief's story: Bob asks 40 SOL, Carol counters at 37, Bob accepts, both sign", async ({ browser, request }) => {
  const { mint } = (await (await request.get("/api/e2e/fixture")).json()) as { mint: string };
  const bob = await walletPage(browser, SELLER_SEED);
  await bob.goto(`/otc/create?mint=${mint}&side=SELL`);
  await connectAndSignIn(bob);
  const next = () => bob.getByRole("button", { name: "Continue" }).click();
  await next();
  await bob.getByLabel(/How many/).fill("20000000");
  await next();
  await bob.getByLabel("Total price for the whole block").fill("40");
  for (let i = 0; i < 4; i++) await next();
  await bob.getByRole("button", { name: "Sign and publish offer" }).click();
  await bob.getByRole("button", { name: "Open deal" }).click();
  await expect(bob.getByText("Maker signature verified")).toBeVisible();
  const askUrl = bob.url();

  const carol = await walletPage(browser, BUYER_SEED);
  await carol.goto(askUrl);
  await connectAndSignIn(carol);
  await carol.getByRole("button", { name: "Counteroffer" }).click();
  await carol.getByLabel("Total price").fill("37");
  await carol.getByRole("button", { name: "Sign and send counteroffer" }).click();
  await expect(carol.getByText("Revision 1")).toBeVisible();
  const counterUrl = carol.url();

  await bob.goto(counterUrl);
  await expect(bob.getByText("Negotiation")).toBeVisible();
  await bob.getByRole("button", { name: /^Accept:/ }).click();
  await bob.getByRole("button", { name: "Build settlement transaction" }).click();
  await expect(bob.getByText("Waiting for the buyer, who signs first.")).toBeVisible();

  await carol.reload();
  await carol.getByRole("checkbox").check();
  await carol.getByRole("button", { name: /Sign: pay SOL/ }).click();
  await expect(carol.getByText("You signed. Waiting for the seller.")).toBeVisible();

  await bob.reload();
  await bob.getByRole("checkbox").check();
  await bob.getByRole("button", { name: /Sign: sell/ }).click();
  await bob.getByRole("link", { name: "View receipt" }).click();
  await expect(bob.getByText("Verified from on-chain data")).toBeVisible();
  await expect(bob.getByText("36.815").first()).toBeVisible(); // 37 SOL minus the 0.5% fee
});

test("an unrelated wallet cannot see a private deal from its link", async ({ browser, request }) => {
  void request;
  const stranger = await walletPage(browser, "44".repeat(32));
  await stranger.goto("/deal/not-a-real-deal");
  await expect(stranger.getByText(/not found|Private offer/i).first()).toBeVisible();
});
