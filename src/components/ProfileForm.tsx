import { useState } from "react";
import { api } from "../client/api.ts";
import { toast } from "../client/toast.ts";
import { ErrorText, Field, NAME_MAX, useAction } from "./ui.tsx";

/** Edit the signed-in user's display name. */
export default function ProfileForm({ name: initial }: { name: string }) {
  const [name, setName] = useState(initial);
  const { busy, error, run } = useAction();
  return (
    <form
      className="card space-y-3 p-4"
      aria-label="Profile"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const u = await api<{ name: string }>("PATCH", "/api/me", { name });
          setName(u.name);
          toast("Name saved");
        });
      }}
    >
      <Field
        label="Your name"
        maxLength={NAME_MAX}
        value={name}
        required
        autoComplete="name"
        onChange={(e) => setName(e.target.value)}
      />
      <p className="text-sm text-muted">This is how your groups see you.</p>
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Saving…" : "Save name"}
      </button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
