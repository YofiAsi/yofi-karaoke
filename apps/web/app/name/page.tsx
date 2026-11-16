"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { createUser, validateStoredUser } from "@/lib/user";

const ERROR_MESSAGES: Record<string, string> = {
  host_name_taken: "That host name is already active. Wait 30 seconds or pick another.",
  name_taken: "That name is taken. Pick another.",
  pin_required: "This name needs the host PIN.",
  invalid_pin: "Wrong PIN. Try again.",
  too_many_attempts: "Too many wrong PINs. Try again in a few minutes.",
};

function describeError(err: unknown): string {
  const code = err instanceof ApiError ? err.code : "";
  return ERROR_MESSAGES[code] ?? "Could not join. Try again.";
}

function needsPin(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export default function NamePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pinVisible, setPinVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    validateStoredUser().then((existing) => {
      if (existing) router.replace("/");
    });
  }, [router]);

  function handleNameChange(value: string) {
    setName(value);
    setPinVisible(false);
    setPin("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await createUser(trimmed, pinVisible ? pin : undefined);
      router.replace("/");
    } catch (err) {
      if (needsPin(err)) setPinVisible(true);
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm flex flex-col gap-4"
      >
        <h1 className="text-3xl font-semibold">Karaoke</h1>
        <p className="text-sm text-neutral-400">
          Pick a name so everyone knows who queued what.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-lg outline-none focus:border-neutral-500"
        />
        {pinVisible && (
          <input
            autoFocus
            type="password"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Host PIN"
            maxLength={64}
            className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-lg outline-none focus:border-neutral-500"
          />
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !name.trim() || (pinVisible && !pin)}
          className="w-full rounded-lg bg-white text-black font-semibold py-3 disabled:opacity-40"
        >
          {submitting ? "Joining…" : "Join"}
        </button>
      </form>
    </main>
  );
}
