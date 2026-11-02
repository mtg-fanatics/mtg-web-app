import { Suspense } from "react";
import type { Metadata } from "next";
import ReplayView from "../ReplayView";
import { Skeleton } from "../../Skeleton";

export const metadata: Metadata = { title: "Replay | Inkfall" };

// With Cache Components, route params are runtime data and must be read inside <Suspense>.
export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-3 p-6">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <Replay params={params} />
    </Suspense>
  );
}

async function Replay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReplayView key={id} id={id} />;
}
