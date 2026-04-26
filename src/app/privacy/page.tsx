import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/landing/footer";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy policy for BimRoss LLC operating MakeACompany.ai and related Platform services.",
  alternates: {
    canonical: "/privacy",
  },
  openGraph: {
    title: "Privacy Policy",
    description:
      "Privacy policy for BimRoss LLC operating MakeACompany.ai and related Platform services.",
    url: `${siteUrl}/privacy`,
  },
};

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 marker:text-foreground/70">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  const collectCategories = [
    "account and contact information, including name, email address, username, organization, role, password credentials or authentication information;",
    "profile and onboarding information, including business ideas, founder profile, business objectives, preferences, use case, intended jurisdiction, industry and other information provided during onboarding;",
    "Inputs and Customer Content, including prompts, instructions, business plans, documents, notes, uploaded files, communications, code, workflows, strategies, customer information, operational information and other materials submitted to the Platform;",
    "Outputs and agent activity data, including AI-generated content, drafts, plans, recommendations, workflow steps, agent logs, actions, messages, tool calls, approvals, errors, task histories and execution records;",
    "third-party integration data, including information from accounts you connect to the Platform, such as email, calendar, Slack, Google Workspace, GitHub, Stripe, payment, hosting, CRM, analytics, cloud, communication, domain, website, document or other third-party services;",
    "commercial and billing information, including subscription plan, invoices, transaction records, usage credits, payment status and related account information. Payment card details may be processed by payment providers and may not be stored by us directly;",
    "communications and feedback, including support requests, survey responses, user interviews, bug reports, product feedback, messages and call notes;",
    "technical, device and usage data, including IP address, device identifiers, browser type, operating system, pages viewed, features used, timestamps, log data, session data, cookies, analytics identifiers, error reports and security events; and",
    "information from third parties, including referral partners, identity or authentication providers, integration providers, analytics providers, service providers, publicly available sources and other users where relevant to your use of the Platform.",
  ];

  const usePurposes = [
    "to provide, operate, maintain, secure, support and improve the Platform;",
    "to create and manage accounts, authenticate users and administer early access participation;",
    "to process Inputs, generate Outputs, coordinate Agents, execute workflows and enable the functionality requested by you;",
    "to enable, monitor, troubleshoot and support third-party integrations and connected accounts;",
    "to communicate with you about the Platform, including onboarding, product updates, support, service notices, billing, security and policy changes;",
    "to analyze usage, measure performance, conduct product research, improve user experience, develop new features and evaluate product-market fit;",
    "to detect, investigate, prevent and respond to fraud, spam, misuse, abuse, security incidents, technical issues, legal risk and violations of our Terms of Use;",
    "to comply with legal obligations, enforce our rights, resolve disputes and respond to lawful requests from regulators, courts, law enforcement or other authorities;",
    "to process payments, invoices, credits and commercial account administration;",
    "to send marketing or promotional communications where permitted by law, subject to your opt-out rights; and",
    "for any other purpose disclosed to you or with your consent.",
  ];

  const discloseRecipients = [
    "service providers, contractors and vendors who provide hosting, storage, compute, model infrastructure, analytics, security, authentication, billing, communications, customer support, error logging, observability and other operational services;",
    "AI model providers, agent infrastructure providers, tool providers and other technical providers used to process Inputs, generate Outputs and operate the Platform;",
    "third-party services and integrations that you connect, authorize or instruct the Platform to use;",
    "professional advisers, including lawyers, accountants, auditors, insurers, bankers and consultants;",
    "corporate transaction counterparties and advisers in connection with any merger, acquisition, financing, reorganization, sale of assets, change of control or similar transaction;",
    "law enforcement, courts, regulators, public authorities, dispute counterparties or other third parties where we believe disclosure is required or appropriate to comply with law, enforce rights, protect safety, prevent harm or investigate misuse;",
    "affiliates and related entities for internal administration, product development, security, support and business operations; and",
    "other persons where you direct us to disclose the information or where you consent to the disclosure.",
  ];

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
        <p className="text-sm uppercase tracking-[0.16em] text-muted-foreground">Legal</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Privacy Policy</h1>
        <p className="mt-4 text-sm text-muted-foreground">Last updated: April 26, 2026</p>

        <div className="mt-10 space-y-8 text-base leading-7 text-foreground/90">
          <div className="space-y-3">
            <p>
              This Privacy Policy explains how BimRoss LLC (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot; or
              &quot;our&quot;) collects, uses, discloses, stores and protects personal information when you access
              or use BimRoss, MakeACompany.ai and any related websites, applications, APIs, AI agents, workflows,
              tools, integrations and services (together, the &quot;Platform&quot;).
            </p>
            <p>
              The Platform is an early access, AI-enabled business creation and operations system. Because the
              Platform may process prompts, business ideas, documents, workflows, agent activity, connected account
              data and other business information, this Privacy Policy is intended to be read together with our{" "}
              <Link href="/terms" className="underline underline-offset-4">
                Early Access Terms of Use
              </Link>
              .
            </p>
            <p>
              By accessing or using the Platform, creating an account, connecting a third-party account, or otherwise
              providing personal information to us, you acknowledge the collection, use and disclosure of personal
              information as described in this Privacy Policy.
            </p>
          </div>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Controller, processor and contact details</h2>
            <p>
              For personal information that we collect directly from users for our own purposes, including account
              administration, security, analytics, billing, product improvement and communications, we act as the
              controller, business or equivalent responsible entity under applicable privacy laws.
            </p>
            <p>
              For personal information contained in user Inputs, connected accounts, business data, customer data,
              documents, workflows, prompts, instructions or other materials that you submit to the Platform for
              processing on your behalf (&quot;Customer Content&quot;), we may act as your processor, service provider
              or equivalent under applicable privacy laws.
            </p>
            <p>
              If a separate data processing agreement, enterprise agreement or other written agreement applies, that
              agreement will prevail to the extent of any inconsistency with this Privacy Policy.
            </p>
            <p>
              Our privacy contact is:{" "}
              <a href="mailto:privacy@makeacompany.ai" className="underline underline-offset-4">
                privacy@makeacompany.ai
              </a>
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Personal information we collect</h2>
            <p>
              We may collect the following categories of personal information, depending on how you use the Platform:
            </p>
            <BulletList items={collectCategories} />
            <p>
              We do not intentionally require you to provide sensitive personal information, regulated health
              information, payment card data, government identifiers or other high-risk personal information unless we
              have expressly agreed in writing that the Platform is suitable for that use.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">AI-specific processing</h2>
            <p>
              The Platform uses AI systems, agents, models, automations and workflow tools to process Inputs,
              generate Outputs and assist with business creation and operational tasks.
            </p>
            <p>
              When you submit prompts, documents, instructions, business ideas, customer information or other Customer
              Content, that information may be processed by the Platform and by selected model providers,
              infrastructure providers and tool providers for the purpose of providing, securing, debugging,
              monitoring and improving the Services.
            </p>
            <p>
              Agent activity may be logged so that we can provide audit-ability, diagnose issues, improve reliability,
              investigate misuse, support users and maintain operational controls.
            </p>
            <p>
              AI systems may generate inaccurate, incomplete or inappropriate Outputs. This Privacy Policy explains
              how we handle personal information, but it does not replace your obligation under the Terms of Use to
              review and approve Outputs and agent actions before external or commercial use.
            </p>
            <p>
              Unless we notify you otherwise or obtain any legally required consent, we will not use non-public
              Customer Content to publicly identify you, disclose your confidential business idea for marketing
              purposes, or train a generally available model in a way that intentionally exposes your identifiable
              Customer Content to other users.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Connected accounts and third-party integrations</h2>
            <p>
              If you connect a third-party account or integration to the Platform, you authorize us and our Agents to
              access, process, retrieve, transmit and use information from that third-party service in accordance with
              your settings, permissions and instructions.
            </p>
            <p>
              The information available to us will depend on the third-party service, the permissions you grant and the
              data made available through that service.
            </p>
            <p>
              You are responsible for ensuring that you have the right to connect third-party accounts and to provide
              any personal information available through those accounts to the Platform.
            </p>
            <p>
              You may be able to revoke access to certain integrations through the Platform or through the relevant
              third-party service. Revocation may affect the availability or functionality of the Services.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Cookies, analytics and similar technologies</h2>
            <p>
              We and our service providers may use cookies, pixels, local storage, SDKs, analytics tags and similar
              technologies to operate the Platform, maintain sessions, remember preferences, measure usage, diagnose
              issues, protect security and improve the Services.
            </p>
            <p>
              You may be able to disable cookies through your browser settings, but some Platform features may not
              function properly without them.
            </p>
            <p>Where legally required, we will request consent for non-essential cookies or similar technologies.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">How we use personal information</h2>
            <p>We may use personal information for the following purposes:</p>
            <BulletList items={usePurposes} />
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Legal bases for processing</h2>
            <p>
              Where EU, UK or similar data protection laws apply, our legal bases for processing personal information
              may include: performance of a contract, where processing is necessary to provide the Platform or
              administer your account; legitimate interests, including product improvement, security, fraud prevention,
              analytics, support and business administration; consent, where we ask for consent for a specific
              processing activity; and legal obligation, where processing is necessary to comply with applicable laws.
            </p>
            <p>
              Where we process Customer Content as a processor or service provider, you are responsible for identifying
              and documenting the relevant legal basis or lawful authority for the processing and for providing any
              required notices or obtaining any required consents.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">How we disclose personal information</h2>
            <p>We may disclose personal information to:</p>
            <BulletList items={discloseRecipients} />
            <p>
              We may use and disclose aggregated, anonymized or de-identified information for analytics, benchmarking,
              product improvement, research, reporting, commercial and operational purposes.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Model providers and infrastructure providers</h2>
            <p>
              The Platform may rely on third-party model providers, cloud infrastructure providers, observability
              providers, databases, vector stores, workflow tools, email providers, communication providers,
              authentication providers, payment processors and other technical service providers.
            </p>
            <p>
              These providers may process personal information and Customer Content on our behalf, subject to
              contractual, technical and organizational controls that we consider appropriate for the relevant service.
            </p>
            <p>
              The specific providers used may change over time as the Platform develops. We may update this Privacy
              Policy or provide additional disclosures where legally required.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">International transfers</h2>
            <p>
              We may process, store and transfer personal information in countries other than the country where you are
              located, including countries that may not provide the same level of data protection as your home
              jurisdiction.
            </p>
            <p>
              Where legally required, we use appropriate safeguards for international transfers, which may include
              standard contractual clauses, data processing agreements, adequacy decisions, intra-group arrangements,
              user consent or other lawful transfer mechanisms.
            </p>
            <p>
              By using the Platform, you acknowledge that personal information may be processed in the jurisdictions
              where we, our affiliates, service providers, model providers and infrastructure providers operate.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Data retention</h2>
            <p>
              We retain personal information for as long as reasonably necessary for the purposes described in this
              Privacy Policy, including to provide the Platform, maintain accounts, comply with legal obligations,
              resolve disputes, enforce agreements, maintain security, improve the Services and support legitimate
              business operations.
            </p>
            <p>
              Retention periods may vary depending on the category of information, the nature of the account, legal
              requirements, operational needs, backup cycles, security requirements and whether the information is
              contained in Customer Content, logs, audit records, support records or financial records.
            </p>
            <p>
              We may retain aggregated, anonymized or de-identified information indefinitely where it no longer identifies
              an individual.
            </p>
            <p>
              Deletion or account closure may not immediately remove information from backups, logs, archives, legal
              holds or records we are required or permitted to retain.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Security</h2>
            <p>
              We use reasonable technical, organizational and administrative measures designed to protect personal
              information against unauthorized access, loss, misuse, disclosure, alteration and destruction.
            </p>
            <p>No system, network, AI workflow, integration or transmission method is completely secure. We cannot guarantee absolute security.</p>
            <p>
              You are responsible for using strong credentials, protecting access tokens and API keys, managing
              permissions, securing connected accounts and promptly notifying us of any suspected unauthorized access
              or security incident.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Automated processing and AI-generated outputs</h2>
            <p>
              The Platform may use automated processing and AI systems to generate Outputs, recommend workflows,
              classify information, route tasks, summarize data, draft content, propose actions and assist with business
              operations.
            </p>
            <p>
              We do not intend the Platform to make legally or similarly significant decisions about individuals without
              appropriate human involvement, unless you independently configure, authorize and lawfully implement such
              use outside our standard early access functionality.
            </p>
            <p>
              You are responsible for ensuring that any use of the Platform involving individuals, customers,
              employees, applicants, users, consumers or other data subjects complies with applicable laws and includes
              all required human review, notices, consents, safeguards and appeal mechanisms.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Your responsibilities when providing personal information</h2>
            <p>
              You must not submit personal information to the Platform unless you have the right to do so and your use
              of the Platform complies with applicable privacy, data protection, marketing, consumer protection,
              employment, communications and platform laws.
            </p>
            <p>
              If you provide personal information about third parties, including customers, leads, employees,
              contractors, applicants, users or business contacts, you are responsible for providing all required
              notices, obtaining all required consents and ensuring there is a lawful basis for processing.
            </p>
            <p>
              You must not use the Platform to process sensitive, regulated or high-risk personal information unless we
              have expressly agreed in writing that the Platform is suitable for that use and any required additional
              safeguards are in place.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Your rights and choices</h2>
            <p>
              Depending on your location and applicable law, you may have rights to access, correct, delete, restrict,
              object to, port or obtain a copy of personal information we hold about you, and to withdraw consent where
              processing is based on consent.
            </p>
            <p>You may also have the right to complain to a privacy regulator or supervisory authority in your jurisdiction.</p>
            <p>
              You may exercise rights by contacting us at{" "}
              <a href="mailto:privacy@makeacompany.ai" className="underline underline-offset-4">
                privacy@makeacompany.ai
              </a>
              . We may need to verify your identity and may refuse or limit requests where permitted by law.
            </p>
            <p>
              If your request relates to Customer Content controlled by one of our users, we may direct you to that user
              or handle the request in accordance with that user&apos;s instructions.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Marketing communications</h2>
            <p>
              We may send service-related communications that are necessary for account, security, billing, legal or
              operational purposes.
            </p>
            <p>
              We may send marketing communications where permitted by law. You may opt out of marketing communications
              by using the unsubscribe mechanism or contacting us.
            </p>
            <p>
              Opting out of marketing communications will not prevent us from sending non-marketing service communications.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Children</h2>
            <p>
              The Platform is not directed to children and is not intended for use by persons under 18 years old.
            </p>
            <p>
              We do not knowingly collect personal information from children. If you believe a child has provided personal
              information to us, please contact us so that we can take appropriate steps.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Changes to this Privacy Policy</h2>
            <p>
              We may update this Privacy Policy from time to time to reflect changes to the Platform, our practices,
              legal requirements or operational needs.
            </p>
            <p>If we make material changes, we may provide notice through the Platform, by email, or by other reasonable means.</p>
            <p>
              Your continued use of the Platform after an updated Privacy Policy becomes effective means that the updated
              Privacy Policy applies to your continued use of the Platform.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Contact and complaints</h2>
            <p>
              If you have questions, requests or complaints regarding this Privacy Policy or our handling of personal
              information, please contact us at:{" "}
              <a href="mailto:privacy@makeacompany.ai" className="underline underline-offset-4">
                privacy@makeacompany.ai
              </a>
              .
            </p>
            <p>
              Please include your name, contact details, the nature of your request and any relevant account information
              so that we can respond appropriately.
            </p>
            <p>
              If you are not satisfied with our response, you may have the right to contact the privacy regulator or
              supervisory authority in your jurisdiction.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Regional disclosures</h2>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">
                European Economic Area, United Kingdom and Switzerland
              </h3>
              <p>
                Where applicable, you may have rights under data protection laws to access, rectify, erase, restrict or
                object to processing of personal data, request data portability, withdraw consent and lodge a complaint
                with a supervisory authority.
              </p>
              <p>
                Where we rely on legitimate interests, you may request information about the balancing assessment relevant
                to that processing where required by law.
              </p>
              <p>
                If we appoint an EU or UK representative, data protection officer or similar contact, we will provide
                those details here or in a supplemental notice.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Australia</h3>
              <p>
                Where the Australian Privacy Act 1988 (Cth) applies, this Privacy Policy is intended to describe how we
                manage personal information in an open and transparent way, including the kinds of personal information
                we collect, how we collect and hold it, the purposes for which we collect, hold, use and disclose it, and
                how individuals may access, correct or complain about our handling of personal information.
              </p>
              <p>
                We may disclose personal information to recipients located outside Australia, including service providers,
                infrastructure providers and model providers in the jurisdictions where they operate.
              </p>
              <p>
                You may contact us at{" "}
                <a href="mailto:privacy@makeacompany.ai" className="underline underline-offset-4">
                  privacy@makeacompany.ai
                </a>{" "}
                to request access to or correction of your personal information or to make a complaint.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">California and other US state privacy laws</h3>
              <p>
                If a US state privacy law applies to our processing of your personal information, you may have rights to
                know, access, correct, delete or obtain a copy of personal information, and to opt out of certain uses
                or disclosures, subject to applicable exceptions.
              </p>
              <p>
                We do not intend to sell personal information in the ordinary sense of exchanging it for money. If any use
                of advertising, analytics or tracking technology is treated as a &quot;sale&quot;, &quot;sharing&quot;
                or targeted advertising under applicable law, we will provide any required notices and opt-out mechanisms.
              </p>
              <p>We will not discriminate against you for exercising privacy rights, except as permitted by law.</p>
            </div>
          </section>
        </div>
      </section>
      <Footer />
    </main>
  );
}
