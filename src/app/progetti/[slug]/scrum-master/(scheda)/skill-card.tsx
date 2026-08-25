import type { ReactNode } from "react";

import { StatusPill } from "@/components/feedback/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { SkillKey } from "@/domain";

import { setSkillEnabledAction } from "../actions";
import { SKILLS } from "../labels";

/**
 * One capability, with its switch.
 *
 * **Why this is a component and not three copies of the same markup.** Three
 * capabilities arrived with an identical shape — name, state, where it is used,
 * one switch — and writing them out three times is how the labels drift apart.
 * That already happened twice in this codebase: a capability described as ready
 * in one file while the action that enabled it refused it in another, and a
 * «Disabilita la skill» button duplicated until two of them shared one name.
 *
 * A Server Component: it renders a form that posts to a server action, and needs
 * no state of its own.
 */

export function SkillCard({
  slug,
  skillKey,
  anchor,
  enabled,
  canConfigure,
  /** Where the capability is actually used, written for a reader. */
  whereItIsUsed,
  /** What the switch does *not* change, when that is worth saying. */
  note,
  /** The verb in the buttons, e.g. «il digest giornaliero». */
  subject,
}: {
  readonly slug: string;
  readonly skillKey: SkillKey;
  readonly anchor: string;
  readonly enabled: boolean;
  readonly canConfigure: boolean;
  readonly whereItIsUsed: ReactNode;
  readonly note?: ReactNode;
  readonly subject: string;
}) {
  return (
    <Card id={anchor} className="scroll-mt-24">
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          {/*
           * La pill sta fuori dall'intestazione, non dentro.
           *
           * Dentro l'`<h2>` il nome accessibile diventerebbe «Digest giornaliero
           * Accesa», che è ciò che sentirebbe chi ascolta la pagina e ciò che
           * cercherebbe un test per nome esatto.
           */}
          <h2 className="text-base leading-none font-semibold">{SKILLS[skillKey].name}</h2>

          <StatusPill tone={enabled ? "on" : "off"}>{enabled ? "Accesa" : "Spenta"}</StatusPill>
        </div>

        <CardDescription>{SKILLS[skillKey].produces}</CardDescription>

        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">Dove si usa: </span>
          {whereItIsUsed}
        </p>
      </CardHeader>

      <CardContent className="grid gap-3">
        {note === undefined ? null : <p className="text-sm">{note}</p>}

        {!canConfigure ? (
          <p className="text-muted-foreground text-sm">
            Serve un ruolo di amministratore per accendere o spegnere una capacità.
          </p>
        ) : (
          <form action={setSkillEnabledAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="skillKey" value={skillKey} />
            <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
            <Button type="submit" variant={enabled ? "outline" : "default"}>
              {enabled ? `Disabilita ${subject}` : `Abilita ${subject}`}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
