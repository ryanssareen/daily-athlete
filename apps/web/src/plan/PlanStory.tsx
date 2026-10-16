import type { PlanView } from "@da2/shared";

import { cardStyle } from "./plan-card-style";

export function PlanStory({ story }: { story: PlanView["story"] }) {
  return (
    <section data-testid="plan-story" aria-label="Plan story" style={cardStyle}>
      {story.paragraphs.map((paragraph) => (
        <p
          key={paragraph}
          style={{ fontSize: 15, lineHeight: 1.55, color: "var(--color-ink)", margin: "0 0 10px" }}
        >
          {paragraph}
        </p>
      ))}
      {story.whyQuote && (
        <blockquote
          style={{
            margin: "6px 0 0",
            paddingLeft: 12,
            borderLeft: "3px solid var(--color-border)",
            fontSize: 14,
            fontStyle: "italic",
            lineHeight: 1.5,
            color: "var(--color-ink-muted)",
          }}
        >
          &ldquo;{story.whyQuote}&rdquo;
        </blockquote>
      )}
    </section>
  );
}
