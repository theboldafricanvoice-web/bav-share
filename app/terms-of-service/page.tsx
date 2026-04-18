import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | BAV Network",
  description: "Terms of Service for the BAV Network mobile application.",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-neutral-900">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-7 text-neutral-700">{children}</div>
    </section>
  );
}

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-3xl bg-neutral-950 px-6 py-8 text-white shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">
            BAV Network
          </p>
          <h1 className="mt-3 text-3xl font-bold">Terms of Service</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-300">
            These Terms of Service govern use of the BAV Network mobile application
            and related services.
          </p>
          <p className="mt-4 text-sm text-neutral-400">Last updated: April 18, 2026</p>
        </header>

        <Section title="Use of the Service">
          <p>
            By using BAV Network, you agree to use the app lawfully and respectfully.
            You must not misuse chat, calls, uploads, or other interactive features.
          </p>
        </Section>

        <Section title="Accounts">
          <p>
            Certain features require an account. You are responsible for maintaining
            the confidentiality of your login credentials and for activity under your
            account.
          </p>
        </Section>

        <Section title="Community Conduct">
          <p>
            You may not post unlawful, abusive, threatening, harassing, fraudulent, or
            otherwise harmful content. We may moderate content and suspend or terminate
            access for policy violations.
          </p>
        </Section>

        <Section title="Content and Availability">
          <p>
            BAV Network provides news, radio, TV, chat, calls, and entertainment
            features, but availability may change or be interrupted by technical issues,
            maintenance, or third-party service disruptions.
          </p>
        </Section>

        <Section title="Intellectual Property">
          <p>
            BAV Network branding, broadcasts, app content, and related materials remain
            the property of BAV Network or its licensors, except for content users own
            and submit themselves.
          </p>
        </Section>

        <Section title="Disclaimers and Liability">
          <p>
            The service is provided on an &quot;as is&quot; basis. To the maximum extent
            permitted by law, BAV Network disclaims warranties and limits liability for
            indirect or consequential damages arising from use of the service.
          </p>
        </Section>

        <Section title="Contact">
          <p>Email: legal@bavnetwork.com</p>
          <p>Website: https://bavnetwork.com</p>
        </Section>
      </div>
    </main>
  );
}
