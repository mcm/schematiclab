"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@iamthemcmaster/ui";
import { AppHeader } from "@/components/app-header";

export default function HomePage() {
  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Home" }]} />
      <main style={{ padding: "var(--space-6)" }}>
        <div style={{ maxWidth: 720 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", margin: 0 }}>
            Schematiclab
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-2)" }}>
            Convert between Minecraft schematic formats and update them across Minecraft versions.
          </p>

          <Card style={{ marginTop: "var(--space-6)" }}>
            <CardHeader>
              <CardTitle>Project scaffold</CardTitle>
              <CardDescription>
                The Next.js shell and schemlib port are in progress.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p style={{ color: "var(--text-secondary)", margin: 0 }}>
                Once the schemlib port is far enough along, conversion and version-update workflows will land here.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
