import Link from "next/link";

import {
  AskTeammateCard,
  JOANNE_PERSONA,
  ROSS_PERSONA,
} from "@/components/landing/ask-teammate-card";
import { FaqAccordionItem } from "@/components/landing/faq-accordion-item";
import type { LanderSlackSeats } from "@/lib/lander-slack-seats";

const DEFAULT_CAP = 100;

function freeSeatsClause(seats?: LanderSlackSeats): string {
  const cap = typeof seats?.cap === "number" && seats.cap > 0 ? seats.cap : DEFAULT_CAP;
  const claimed =
    typeof seats?.claimed === "number" && seats.claimed >= 0 ? seats.claimed : null;
  if (claimed === null) {
    return `The first ${cap} seats are free for life`;
  }
  const remaining = Math.max(cap - claimed, 0);
  if (remaining <= 0) {
    return `The first ${cap} free-for-life seats have all been claimed`;
  }
  return `The first ${cap} seats are free for life — ${remaining} still available`;
}

function buildFaqItems(seats?: LanderSlackSeats) {
  const freeClause = freeSeatsClause(seats);
  return [
    {
      question: "What is makeacompany.ai?",
      answer:
        "makeacompany.ai is a platform for building an AI-powered company where role-based agents operate inside Slack to help execute work.",
    },
    {
      question: "Who is this for?",
      answer:
        "It is designed for founders, operators, and teams that want to increase leverage by running more of their company with AI systems.",
    },
    {
      question: "How do I get access?",
      answer: `Tap Start Building on the homepage. ${freeClause} (see the live count in the pill at the top of the page). After the free-for-life seats are gone it's $99/mo through Stripe. Either way, Joanne emails you an invite to your workspace once you're in.`,
    },
    {
      question: "Does this replace my whole team?",
      answer:
        "The goal is to amplify human operators with always-on AI teammates so more work gets done with less operational overhead.",
    },
    {
      question: "What's included?",
      answer:
        "Infinite workspaces, channels, and companies — spin up as many as you want, each with the full roster of role-based AI employees, unlimited Slack conversations, and ongoing platform updates as we ship new capabilities.",
    },
    {
      question: "How much does it cost?",
      answer: `${freeClause}. Once those are claimed, it's $99/mo, month-to-month through Stripe.`,
    },
    {
      question: "Can I cancel anytime?",
      answer:
        "Yes. Paid plans are month-to-month through Stripe — cancel from your billing portal and access ends at the close of the current cycle. Free-for-life seats stay free.",
    },
    {
      question: "Do I need to write code to use it?",
      answer:
        "No. Everything happens in Slack — you talk to your AI employees the same way you'd talk to a teammate. Engineers can extend it with custom skills, but it isn't required.",
    },
    {
      question: "What's an AI employee?",
      answer:
        "A role-based agent — like a Head of Automation or a Head of Customer Support — that lives in your Slack workspace, holds context across threads, and uses tools to actually do work, not just answer questions.",
    },
    {
      question: "How is this different from ChatGPT or Zapier?",
      answer:
        "ChatGPT is a single chatbot; Zapier wires APIs together. makeacompany.ai gives you a team of persistent, role-specialized agents that live where your team already works and execute multi-step work end-to-end.",
    },
  ];
}

export function SeoFaqSection({
  seats,
  viewAllHref,
  hideHeading,
  askCardsPosition = "top",
}: {
  seats?: LanderSlackSeats;
  viewAllHref?: string;
  hideHeading?: boolean;
  askCardsPosition?: "top" | "bottom";
} = {}) {
  const faqItems = buildFaqItems(seats);
  const askCards = (
    <>
      <AskTeammateCard persona={JOANNE_PERSONA} />
      <AskTeammateCard persona={ROSS_PERSONA} />
    </>
  );
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-20">
      {hideHeading ? null : (
        <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">Frequently asked questions</h2>
      )}
      <div className={hideHeading ? "space-y-4" : "mt-10 space-y-4"}>
        {askCardsPosition === "top" ? askCards : null}
        {faqItems.map((item) => (
          <FaqAccordionItem key={item.question} question={item.question} answer={item.answer} />
        ))}
        {askCardsPosition === "bottom" ? askCards : null}
      </div>
      {viewAllHref ? (
        <div className="mt-10 text-center">
          <Link
            href={viewAllHref}
            className="text-sm font-medium text-foreground/70 underline-offset-4 hover:text-foreground hover:underline"
          >
            View all FAQs →
          </Link>
        </div>
      ) : null}
    </section>
  );
}

export function faqStructuredData(seats?: LanderSlackSeats) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: buildFaqItems(seats).map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
