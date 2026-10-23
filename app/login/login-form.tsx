"use client";
import { useActionState } from "react";
import { signIn } from "./actions";
import { buttonClass, inputClass, Field } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="อีเมล"><input name="email" type="email" autoComplete="username" required className={inputClass} /></Field>
      <Field label="รหัสผ่าน"><input name="password" type="password" autoComplete="current-password" required className={inputClass} /></Field>
      {state?.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
      <button disabled={pending} className={buttonClass("primary", "lg") + " w-full"}>{pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>
    </form>
  );
}
