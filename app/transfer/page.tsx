import { Suspense } from "react";
import { TransferStatus } from "./TransferStatus";

export default function TransferPage() {
  return (
    <Suspense fallback={<main><p className="muted">Loading...</p></main>}>
      <TransferStatus />
    </Suspense>
  );
}