"use client";

import Logo from "../Logo";
import { Scribble } from "../Icons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearCached } from "@/lib/dashCache";
import LiveWallpaper from "../LiveWallpaper";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  normalizeUsername,
  usernameToEmail,
} from "@/lib/auth";

const REQUEST_LIMIT_MS = 20_000;

/** A request that never answers (a dropped connection, a stuck server) must not leave the form on "Please wait…" for good. */
function withLimit<T>(work: PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), REQUEST_LIMIT_MS);
    Promise.resolve(work).then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = normalizeUsername(username);
    if (name.length < MIN_USERNAME_LENGTH) {
      setError("Enter a username.");
      return;
    }
    if (name.length > MAX_USERNAME_LENGTH) {
      setError(`Username can be at most ${MAX_USERNAME_LENGTH} characters.`);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError("Enter a password.");
      return;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setError(`Password can be at most ${MAX_PASSWORD_LENGTH} characters.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await attempt(name);
    } catch {
      setError("The server did not answer in time. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function attempt(name: string) {
    const supabase = createClient();
    const email = usernameToEmail(name);

    if (mode === "login") {
      // signing in goes through our own route, which counts wrong passwords (5 wrong tries lock the account for 10 minutes)
      const res = await withLimit(
        fetch("/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: name, password }),
        }),
      ).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { access_token?: string; refresh_token?: string; error?: string } | null;
      if (!res || !res.ok || !body?.access_token || !body.refresh_token) {
        setError(body?.error ?? "Could not reach the server. Try again.");
        setBusy(false);
        return;
      }
      const { error } = await withLimit(supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token }));
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    } else {
      const { data, error } = await withLimit(supabase.auth.signUp({ email, password, options: { data: { username: name } } }));
      if (error) {
        setError(error.message.includes("already registered") ? "That username is taken." : error.message);
        setBusy(false);
        return;
      }
      if (!data.session) {
        setError('Account created but not signed in: turn OFF "Confirm email" in Supabase (Authentication → Sign In / Providers → Email).');
        setBusy(false);
        return;
      }
    }

    clearCached(); // whatever an earlier player left on this computer
    router.replace("/");
    router.refresh();
    // signed in, but the next page is slow to open: let the button come back rather than hang
    setTimeout(() => setBusy(false), REQUEST_LIMIT_MS);
  }

  const signup = mode === "signup";

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-x-clip p-5 text-white sm:p-8">
      <LiveWallpaper />
      <div className="relative flex w-full max-w-md flex-col items-center gap-7">
        <div className="hero-scrim" aria-hidden="true" />
        <div className="relative flex flex-col items-center gap-2 text-center">
          <Logo size={96} glow className="hero-rise mb-2" />
          <p className="hero-eyebrow hero-rise caps !not-italic">A game for two hands</p>
          <h1 className="hero-rise flex flex-col items-center gap-2 font-title" style={{ animationDelay: "0.06s" }}>
            <span className="hero-title" style={{ fontSize: "clamp(2.6rem, 10vw, 4.2rem)" }}>Inkfall</span>
          </h1>
          <Scribble width={200} className="hero-rise -mt-1" />
        </div>

        <form onSubmit={submit} className="panel-glass hero-rise relative flex w-full flex-col gap-5 p-6 sm:p-7" style={{ animationDelay: "0.16s" }}>
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl text-[#e8dcc0]">{signup ? "Join the ledger" : "Back at the table"}</h2>
            <p className="italic-note text-[17px] text-slate-300">{signup ? "Choose a name and a secret word, and the ink is yours." : "Say who you are and take your old seat."}</p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">Your name</span>
            <input className="auth-input" maxLength={MAX_USERNAME_LENGTH} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Your secret word</span>
            <input
              className="auth-input"
              type="password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? "new-password" : "current-password"}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg border-2 border-[#b3392b] bg-[#b3392b]/20 px-3 py-2 text-[15px] text-[#f0bfb0]">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-gold w-full justify-center py-2.5">
            {busy ? "One moment…" : signup ? "Sign the ledger" : "Come in"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(signup ? "login" : "signup");
              setError(null);
            }}
            className="login-switch text-sm text-slate-300 underline-offset-4 hover:text-[#e8dcc0] hover:underline"
          >
            {signup ? "Already written in? Come in" : "Not in the ledger yet? Add your name"}
          </button>
        </form>
      </div>
    </main>
  );
}
