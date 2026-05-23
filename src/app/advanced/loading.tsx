// Brief loading state shown while Next.js fetches the `/advanced` route
// chunk on first navigation. The chunk carries deepslate + the vanilla
// block-translation tables (kept out of `/`'s initial chunk by US-017's
// route-level split), so first-time visitors see this before the editor
// shell renders. Subsequent navigations are instant — the chunk is cached.

import { IconLoader2 } from "@tabler/icons-react";

export default function AdvancedLoading() {
  return (
    <main
      role="status"
      aria-label="Loading editor"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "var(--space-3)",
        color: "var(--text-secondary)",
        fontSize: "var(--text-sm)",
      }}
    >
      <IconLoader2
        size={24}
        aria-hidden="true"
        style={{ animation: "schematiclab-spin 0.9s linear infinite" }}
      />
      <span>Loading editor…</span>
    </main>
  );
}
