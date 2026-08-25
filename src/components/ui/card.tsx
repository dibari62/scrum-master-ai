import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        // `ring` invece di `border`: un bordo pieno a piena opacità disegna una
        // griglia di rettangoli che compete con il contenuto. Un contorno
        // sottile separa senza reclamare attenzione.
        "bg-card text-card-foreground ring-border/70 flex flex-col gap-5 rounded-xl py-5 shadow-sm ring-1",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("grid auto-rows-min items-start gap-1.5 px-5", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      // Il testo esplicativo non supera la misura leggibile anche quando la
      // scheda è larga: righe da centoventi caratteri si rileggono male, ed è
      // il difetto che compare appena si allarga il contenitore.
      className={cn("text-muted-foreground max-w-prose text-sm", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-5", className)}
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
