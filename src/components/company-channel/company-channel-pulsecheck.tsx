"use client";

import {
  DigestAuthorLookupProvider,
  DigestStyleUserMessageCard,
  type SlackTranscriptAuthorLookup,
} from "@/components/admin/admin-channel-digest-views";

function resolveJoanneAuthor(lookup: SlackTranscriptAuthorLookup | null | undefined): {
  slackUserId: string;
  author: { displayName: string; portraitUrl: string } | null;
} {
  if (lookup && typeof lookup === "object") {
    for (const [id, row] of Object.entries(lookup)) {
      if (/joanne/i.test(String(row.displayName ?? ""))) {
        const sid = String(id).trim() || "UJOANNE";
        return {
          slackUserId: sid,
          author: {
            displayName: String(row.displayName).trim() || "Joanne",
            portraitUrl: String(row.portraitUrl ?? "").trim(),
          },
        };
      }
    }
  }
  return {
    slackUserId: "UJOANNE",
    author: { displayName: "Joanne", portraitUrl: "" },
  };
}

/** Cached read-company style summary (Redis), styled like a Joanne transcript card. */
export function CompanyChannelPulsecheck({
  markdown,
  slackAuthorLookup,
}: {
  markdown: string;
  slackAuthorLookup?: SlackTranscriptAuthorLookup | null;
}) {
  const text = String(markdown ?? "").trim();
  if (!text) {
    return null;
  }
  const { slackUserId, author } = resolveJoanneAuthor(slackAuthorLookup ?? null);
  return (
    <DigestAuthorLookupProvider lookup={slackAuthorLookup}>
      <div className="flex shrink-0 flex-col gap-2">
        <h2 className="text-lg font-semibold leading-snug tracking-tight text-foreground">Latest News</h2>
        <DigestStyleUserMessageCard slackUserId={slackUserId} author={author} bodyMarkdown={text} />
      </div>
    </DigestAuthorLookupProvider>
  );
}
