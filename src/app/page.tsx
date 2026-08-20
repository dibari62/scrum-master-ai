import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
        Traguardo T0 — fondamenta
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-balance">
        Scrum Master AI
      </h1>
      <p className="text-muted-foreground text-lg">
        Lo scheletro dell&apos;applicazione è in piedi: Next.js, TypeScript in modalità
        strict, Tailwind e shadcn/ui. Il codice calcola, il modello linguistico racconta.
      </p>
      <div>
        <Button disabled>Registra la tua azienda (in arrivo)</Button>
      </div>
    </main>
  );
}
