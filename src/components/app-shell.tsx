"use client";

import {
  ToastProvider,
  ToastViewport,
  TooltipProvider,
} from "@iamthemcmaster/ui";
import { SonnerToaster } from "@iamthemcmaster/ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>
        {children}
        <ToastViewport />
        <SonnerToaster position="bottom-right" richColors />
      </ToastProvider>
    </TooltipProvider>
  );
}
