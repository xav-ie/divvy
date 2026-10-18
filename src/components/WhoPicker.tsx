import { useState } from "react";
import { api } from "../client/api.ts";
import { leave } from "../client/leave.ts";
import Avatar from "./Avatar.tsx";
import { ErrorText, Field, NAME_MAX, useAction } from "./ui.tsx";

interface Person {
  id: number;
  name: string;
}

/** Picker mode sign-in: tap your name, or add yourself. */
export default function WhoPicker({ people }: { people: Person[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const { busy, error, run } = useAction();
  const go = (body: unknown) =>
    run(async () => {
      await api("POST", "/api/who", body);
      leave("/");
    });
  return (
    <div className="space-y-6">
      <ErrorText>{error}</ErrorText>
      {people.length > 0 && (
        <section aria-labelledby="who-pick">
          <h2
            id="who-pick"
            className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase"
          >
            Pick yourself
          </h2>
          <ul className="card divide-y divide-line overflow-hidden">
            {people.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="row-link w-full cursor-pointer text-left text-base disabled:opacity-60"
                  disabled={busy}
                  title={p.name}
                  onClick={() => go({ userId: p.id })}
                >
                  <Avatar name={p.name} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {p.name}
                  </span>
                  <svg
                    aria-hidden="true"
                    className="shrink-0 text-muted"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form
        className="card space-y-3 p-4"
        aria-labelledby="who-new"
        onSubmit={(e) => {
          e.preventDefault();
          go({ name, email });
        }}
      >
        <h2 id="who-new" className="text-lg font-semibold">
          I'm new here
        </h2>
        <Field
          label="Your name"
          value={name}
          required
          maxLength={NAME_MAX}
          autoComplete="name"
          placeholder="e.g. Ana"
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label="Your email"
          type="email"
          value={email}
          required
          autoComplete="email"
          inputMode="email"
          placeholder="e.g. ana@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="text-sm text-muted">
          Your email links you to groups that already invited you.
        </p>
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Joining…" : "Join"}
        </button>
      </form>
    </div>
  );
}
