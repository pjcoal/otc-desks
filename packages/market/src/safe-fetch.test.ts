import { describe, expect, it } from "vitest";
import { candidateUrls, imageFetchUrl, ipfsPathOf } from "./safe-fetch";

const V0 = "QmQr3Fz4h1etNsF7oLGMRHiCzhB5y9a7GjyodnF7zLHK1g";
const V1 = "bafkreifi224zmtycdztn7cde2rcvuf462k54dteq63m6qq3vp6k33tjbhm";
const gw = { ipfs: "https://primary.example/ipfs/", ipfsFallbacks: ["https://second.example/ipfs", "https://primary.example/ipfs/"] };

describe("IPFS gateway fallback", () => {
  it("recognises IPFS content on any gateway and via ipfs://", () => {
    expect(ipfsPathOf(`https://ipfs.io/ipfs/${V1}`)).toBe(V1);
    expect(ipfsPathOf(`ipfs://${V0}/image.png`)).toBe(`${V0}/image.png`);
    expect(ipfsPathOf(`ipfs://ipfs/${V0}`)).toBe(V0);
  });
  it("ignores non-IPFS paths, bad CIDs, traversal and plain http", () => {
    expect(ipfsPathOf("https://example.com/logo.png")).toBeNull();
    expect(ipfsPathOf("https://example.com/ipfs/not-a-cid")).toBeNull();
    expect(ipfsPathOf(`https://example.com/ipfs/${V0}/../../etc`)).toBeNull();
    expect(ipfsPathOf(`http://ipfs.io/ipfs/${V0}`)).toBeNull();
  });
  it("tries each configured gateway once, primary first; other URLs as-is", () => {
    expect(candidateUrls(`https://ipfs.io/ipfs/${V1}`, gw)).toEqual([`https://primary.example/ipfs/${V1}`, `https://second.example/ipfs/${V1}`]);
    expect(candidateUrls("https://griffain.com/logo.png", gw)).toEqual(["https://griffain.com/logo.png"]);
    expect(candidateUrls("http://169.254.169.254/latest", gw)).toEqual([]);
  });
  it("adds the variant Pump's Cloudflare Images account requires", () => {
    const m = "Ai66LHZG9MCzg1WKdawwqduVAXpNDUuV8M3uyq5ppump";
    expect(imageFetchUrl(`https://imagedelivery.net/WL1JOIJiM_NAChp6rtB6Cw/coin-image/${m}`)).toBe(`https://imagedelivery.net/WL1JOIJiM_NAChp6rtB6Cw/coin-image/${m}/256x256`);
    expect(imageFetchUrl(`https://imagedelivery.net/WL1JOIJiM_NAChp6rtB6Cw/coin-image/${m}/256x256`)).toBe(`https://imagedelivery.net/WL1JOIJiM_NAChp6rtB6Cw/coin-image/${m}/256x256`);
  });
});
