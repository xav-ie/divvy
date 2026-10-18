import { api } from "../client/api.ts";
import { goWithToast, type Undo } from "../client/toast.ts";
import { ConfirmButton } from "./ui.tsx";

/** Delete something through the API after an inline confirmation, then leave with a toast. */
export default function DeleteAction(props: {
  url: string;
  redirect: string;
  label: string;
  question: string;
  done: string;
  /** Offer Undo in the toast by re-creating it from this. */
  undo?: Undo;
  className?: string;
}) {
  return (
    <ConfirmButton
      label={props.label}
      question={props.question}
      className={props.className}
      onConfirm={async () => {
        await api("DELETE", props.url);
        goWithToast(props.redirect, props.done, props.undo);
      }}
    />
  );
}
