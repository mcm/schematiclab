"use client";

import { SonnerToaster, TooltipProvider } from "@iamthemcmaster/ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      {children}
      <SonnerToaster position="bottom-right" richColors />
    </TooltipProvider>
  );
}
