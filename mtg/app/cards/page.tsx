import type { Metadata } from "next";
import CardBrowser from "./CardBrowser";

export const metadata: Metadata = { title: "The card library | Inkfall" };

export default function CardsPage() {
  return <CardBrowser />;
}
