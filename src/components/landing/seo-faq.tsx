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
      "Join the waitlist on the homepage. Early users can reserve access and get launch updates as availability opens.",
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
          <details key={item.question} className="rounded-xl border border-border bg-card/60 p-5">
            <summary className="cursor-pointer list-none text-lg font-medium">{item.question}</summary>
            <p className="mt-3 text-muted-foreground">{item.answer}</p>
          </details>
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
