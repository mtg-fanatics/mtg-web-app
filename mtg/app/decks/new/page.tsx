import type { Metadata } from "next";
import DeckEditor from "../DeckEditor";

export const metadata: Metadata = { title: "New deck | Inkfall" };

export default function NewDeckPage() {
  return <DeckEditor />;
}
