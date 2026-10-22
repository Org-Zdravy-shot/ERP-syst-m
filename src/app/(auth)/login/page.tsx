"use client";

import Image from "next/image";
import { useActionState } from "react";
import { login } from "./_actions";

const inputClass =
  "w-full rounded-[10px] border border-stone-300 px-3 py-2.5 text-sm outline-none transition focus:border-stone-950 focus:ring-[3px] focus:ring-brand/35";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 p-6">
      <div className="w-full max-w-[380px] rounded-[20px] bg-white px-9 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
        <div className="mb-8 text-center">
          <Image
            src="/logo.png"
            alt="Zdravý Shot"
            width={160}
            height={56}
            className="mx-auto block h-14 w-auto"
            priority
          />
          <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
            ERP systém
          </div>
          <div className="mx-auto mt-4 h-[3px] w-9 rounded-sm bg-brand" />
          <p className="mt-[18px] text-[13px] leading-normal text-stone-500">
            Nie je to len shot.
            <br />
            Je to rozhodnutie!
          </p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-stone-700">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="meno@zdravyshot.sk"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-stone-700">
              Heslo
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </div>

          {state.error && (
            <p className="rounded-[10px] bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1.5 w-full rounded-[10px] bg-brand px-4 py-[11px] text-sm font-semibold text-stone-950 transition hover:bg-brand-dark disabled:opacity-50"
          >
            {pending ? "Prihlasujem…" : "Prihlásiť sa"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-stone-400">
          100 % prírodné · Ručná výroba · Zdravý Shot
        </p>
      </div>
    </main>
  );
}
