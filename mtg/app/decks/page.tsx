import type { Metadata } from "next";
import DeckList from "./DeckList";

export const metadata: Metadata = { title: "Your decks | Inkfall" };

export default function DecksPage() {
  return <DeckList />;
}
