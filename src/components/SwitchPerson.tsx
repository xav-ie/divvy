import { api } from "../client/api.ts";
import { leave } from "../client/leave.ts";
import { ErrorText, useAction } from "./ui.tsx";

/** Picker mode: forget who this browser is and go back to the picker. */
export default function SwitchPerson({ label }: { label: string }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary mt-3 w-full"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await api("DELETE", "/api/who");
            leave("/who");
          })
        }
      >
        {label}
      </button>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
