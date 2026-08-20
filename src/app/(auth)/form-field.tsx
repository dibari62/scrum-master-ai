"use client";

import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFieldProps = ComponentProps<typeof Input> & {
  readonly name: string;
  readonly label: string;
  /** Message shown under the field, or `undefined` when it is fine. */
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
};

/**
 * A labelled input with its error message.
 *
 * The message is tied to the field through `aria-describedby` and marked
 * `aria-invalid`, so a screen reader announces *which* field is wrong instead
 * of reading a list of complaints detached from the form.
 */
export function FormField({ name, label, error, hint, ...props }: FormFieldProps) {
  const errorId = `${name}-errore`;
  const hintId = `${name}-nota`;
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter((value) => value !== null)
    .join(" ");

  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
