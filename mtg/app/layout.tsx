import type { Metadata } from "next";
import { Alegreya_Sans, IM_Fell_English, IM_Fell_English_SC, Geist_Mono } from "next/font/google";
import "mana-font/css/mana.css";
import "./globals.css";
import "./inkfall.css";
import UserBar from "./UserBar";
import RegisterSW from "./RegisterSW";
import AutoFullscreen from "./AutoFullscreen";
import Music from "./Music";
import { InkFilters } from "./Icons";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

// Alegreya Sans: a humanist face with a calligrapher's rhythm, easy to read at small sizes. All the text you read.
const alegreya = Alegreya_Sans({
  variable: "--font-alegreya",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  style: ["normal", "italic"],
  display: "swap",
});

// IM Fell English SC: a worn letterpress face (cut in the 1600s, photographed from a century of printing). The name and the headings.
const fell = IM_Fell_English_SC({
  variable: "--font-fell",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// IM Fell English: the same press in lower case and italic, for sub-headings and the voice of the game.
const fellText = IM_Fell_English({
  variable: "--font-fell-text",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inkfall",
  description: "A game of two hands and a table. Write a deck, take a seat, and duel.",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], shortcut: "/icon.svg", apple: "/logo.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${alegreya.variable} ${fell.variable} ${fellText.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Open the connections to the card picture hosts early, so the first picture does not wait for them. */}
        <link rel="preconnect" href="https://cards.scryfall.io" crossOrigin="" />
        {process.env.NEXT_PUBLIC_SUPABASE_URL && <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="" />}
      </head>
      <body className="min-h-full flex flex-col">
        <InkFilters />
        <RegisterSW />
        <AutoFullscreen />
        <Music />
        <UserBar />
        {children}
      </body>
    </html>
  );
}
