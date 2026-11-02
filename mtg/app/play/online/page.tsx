import type { Metadata } from "next";
import { OnlineGame } from "../Game";

export const metadata: Metadata = { title: "A duel | Inkfall" };

export default function OnlinePlayPage() {
  return <OnlineGame />;
}
