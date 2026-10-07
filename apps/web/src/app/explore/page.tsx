import { Suspense } from "react";
import { Explore } from "./explore";

export const metadata = { title: "Explore" };

export default function ExplorePage() {
  return (
    <Suspense>
      <Explore />
    </Suspense>
  );
}
