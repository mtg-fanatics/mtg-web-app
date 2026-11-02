import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Come in | Inkfall" };

export default function LoginPage() {
  return <LoginForm />;
}
