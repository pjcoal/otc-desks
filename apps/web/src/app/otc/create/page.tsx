import { Suspense } from "react";
import { CreateWizard } from "./wizard";

export const metadata = { title: "Create OTC offer" };

export default function CreatePage() {
  return (
    <Suspense>
      <CreateWizard />
    </Suspense>
  );
}
