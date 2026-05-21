"use client";

import { SidebarProvider, ToastProvider, ToastViewport, TooltipProvider } from "@iamthemcmaster/ui";
import { SonnerToaster } from "@iamthemcmaster/ui";
import { AppSidebar } from "./app-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>
        <SidebarProvider>
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <AppSidebar />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {children}
            </div>
          </div>
        </SidebarProvider>
        <ToastViewport />
        <SonnerToaster position="bottom-right" richColors />
      </ToastProvider>
    </TooltipProvider>
  );
}
