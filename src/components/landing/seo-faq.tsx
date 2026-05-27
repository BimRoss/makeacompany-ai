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
      "Tap Start Building on the homepage. Checkout opens Stripe for the $99/month plan; Joanne will email you an invite to your workspace after you finish checkout.",
  },
  {
    question: "Does this replace my whole team?",
    answer:
      "The goal is to amplify human operators with always-on AI teammates so more work gets done with less operational overhead.",
  },
  {
    question: "What's included in the $99/month plan?",
    answer:
      "One workspace with the full roster of role-based AI employees, unlimited Slack conversations, and ongoing platform updates as we ship new capabilities.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. The plan is month-to-month through Stripe. Cancel from your billing portal and access ends at the close of the current cycle.",
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
