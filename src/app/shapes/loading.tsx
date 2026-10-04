// Brief loading state shown while Next.js fetches the `/shapes` route chunk
// on first navigation. Like `/advanced`, the chunk carries deepslate and the
// vanilla block tables, which stay out of `/`'s bundle.

import { IconLoader2 } from "@tabler/icons-react";

export default function ShapesLoading() {
  return (
    <main
      role="status"
      aria-label="Loading shape generator"
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
      <span>Loading shape generator…</span>
    </main>
  );
}
