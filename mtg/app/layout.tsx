import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Alegreya_Sans, IM_Fell_English, IM_Fell_English_SC, Geist_Mono } from "next/font/google";
import "mana-font/css/mana.css";
import "./globals.css";
import "./inkfall.css";
import "./mobile.css";
import "./duel-mobile.css";
import "./scribe.css";
import UserBar from "./UserBar";
import RegisterSW from "./RegisterSW";
import AutoFullscreen from "./AutoFullscreen";
import Music from "./Music";
import FontWarm from "./FontWarm";
import BackGuard from "./BackGuard";
import PhoneTier from "./PhoneTier";
import Scribe from "./Scribe";
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
  applicationName: "Inkfall",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/inkfall-seal.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    shortcut: "/icons/favicon-48.png",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // iPhone: the Home Screen app. The status bar is see-through over the dark top bar (the bar leaves room for it: see the safe-area rules in globals.css).
  appleWebApp: { capable: true, title: "Inkfall", statusBarStyle: "black-translucent" },
  // (Next writes mobile-web-app-capable; iPhone Safari before iOS 17 only reads the apple- name, so both are there)
  other: { "apple-mobile-web-app-capable": "yes" },
  formatDetection: { telephone: false },
};

// viewport-fit=cover lets the page run under the notch and the home indicator; the top bar, the hand and the buttons keep clear of them with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b19",
  colorScheme: "dark",
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
        {/* a phone gets the cheaper way of drawing from the very first paint (the filters on the big lettering were the slowest thing on the sign-in page) */}
        <script dangerouslySetInnerHTML={{ __html: "if(matchMedia('(hover: none) and (pointer: coarse)').matches)document.documentElement.classList.add('perf-lite')" }} />
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
        <FontWarm />
        <BackGuard />
        <PhoneTier />
        <Suspense>
          <Scribe />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
