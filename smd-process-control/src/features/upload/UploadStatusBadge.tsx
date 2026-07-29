import type React from "react";

export type UploadStatus = "existing" | "new" | "conflict" | "error";

export const uploadStatusColors = {
  existing: { color: "#56637a", backgroundColor: "#eef2f7" },
  new: { color: "#097958", backgroundColor: "#e6f8f1" },
  conflict: { color: "#a45100", backgroundColor: "#fff0df" },
  error: { color: "#b83f3f", backgroundColor: "#fff0f0" },
} as const satisfies Record<UploadStatus, React.CSSProperties>;

export function UploadStatusBadge({
  status,
  children,
}: {
  status: UploadStatus;
  children: React.ReactNode;
}) {
  return <span
    className={`upload-status-badge is-${status}`}
    style={uploadStatusColors[status]}
  >
    {children}
  </span>;
}
