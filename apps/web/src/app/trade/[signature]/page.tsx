import { ReceiptView } from "./receipt-view";

export const metadata = { title: "OTC settlement receipt" };

export default async function TradePage({ params }: { params: Promise<{ signature: string }> }) {
  const { signature } = await params;
  return <ReceiptView signature={signature} />;
}
