import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("unisce più classi in una sola stringa", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("risolve le utility Tailwind in conflitto tenendo l'ultima", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("ignora i valori condizionali falsi", () => {
    const isActive = false;
    expect(cn("text-sm", isActive && "font-bold", undefined, null)).toBe("text-sm");
  });
});
