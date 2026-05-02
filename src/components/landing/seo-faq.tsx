import { FaqAccordionItem } from "@/components/landing/faq-accordion-item";

const faqItems = [
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
    answer:
      "Tap Start Building on the homepage. Checkout opens Stripe for the $9/month plan; Joanne will email you an invite to your workspace after you finish checkout.",
  },
  {
    question: "Does this replace my whole team?",
    answer:
      "The goal is to amplify human operators with always-on AI teammates so more work gets done with less operational overhead.",
  },
];

export function SeoFaqSection() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-20">
      <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">Frequently asked questions</h2>
      <div className="mt-10 space-y-4">
        {faqItems.map((item) => (
          <FaqAccordionItem key={item.question} question={item.question} answer={item.answer} />
        ))}
      </div>
    </section>
  );
}

export function faqStructuredData() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
