import { WalletProfile } from "./profile";

export const metadata = { title: "Wallet" };

export default async function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <WalletProfile address={address} />;
}
