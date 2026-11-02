import { Suspense } from "react";
import type { Metadata } from "next";
import DeckEditor from "../DeckEditor";
import { CardSkeletons, Skeleton } from "../../Skeleton";

export const metadata: Metadata = { title: "Edit deck | Inkfall" };

// With Cache Components, route params are runtime data and must be read inside <Suspense>.
export default function EditDeckPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-10 w-72" />
          <CardSkeletons count={18} size="md" className="flex flex-wrap gap-2" />
        </div>
      }
    >
      <Editor params={params} />
    </Suspense>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeckEditor key={id} deckId={id} />;
}
