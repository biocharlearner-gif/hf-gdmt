import { Link, Typography } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { resolveCitation } from "../engine/citations";

/**
 * Renders a guideline citation as "Source: <document> — <section>", deep-linked to the
 * exact section when a URL is known (opens in a new tab). Shared by the Vitals alert
 * banners and the Tasks list so every cited finding shows the same verifiable source.
 */
export default function CitationLine({ citationRef }: { citationRef: string }) {
  const c = resolveCitation(citationRef);
  const text = c.section ? `${c.source} — ${c.section}` : c.source;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
      Source:{" "}
      {c.url ? (
        <Link
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 0.25 }}
        >
          {text}
          <OpenInNewIcon sx={{ fontSize: 12 }} />
        </Link>
      ) : (
        text
      )}
    </Typography>
  );
}
