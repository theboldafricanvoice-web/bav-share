import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | BAV Network",
  description: "Privacy Policy for the BAV Network mobile application.",
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

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-3xl bg-neutral-950 px-6 py-8 text-white shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">
            BAV Network
          </p>
          <h1 className="mt-3 text-3xl font-bold">Privacy Policy</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-300">
            This Privacy Policy explains how BAV Network collects, uses, stores, and
            protects information when you use the BAV Network mobile application and
            related services.
          </p>
          <p className="mt-4 text-sm text-neutral-400">Last updated: April 18, 2026</p>
        </header>

        <Section title="Information We Collect">
          <p>
            We may collect account information such as your email address, profile
            details, and Google sign-in details if you choose that login method.
          </p>
          <p>
            We may also collect usage information, including app interactions, saved
            content, chat activity, notifications, and media uploads that are necessary
            to provide the service.
          </p>
          <p>
            Technical information such as device type, operating system version, app
            version, IP address, and crash diagnostics may also be processed.
          </p>
        </Section>

        <Section title="How We Use Information">
          <p>
            We use information to operate the app, support news, radio, TV, chat,
            calls, notifications, media sharing, security monitoring, and customer
            support.
          </p>
          <p>We do not sell personal data.</p>
        </Section>

        <Section title="Storage and Security">
          <p>
            Data is stored using cloud infrastructure and protected with security
            measures designed to reduce unauthorized access. No system can guarantee
            absolute security, but we aim to apply reasonable industry-standard
            protections.
          </p>
        </Section>

        <Section title="Third-Party Services">
          <p>
            BAV Network relies on third-party providers for infrastructure and delivery,
            including streaming, cloud storage, authentication, notifications, and
            analytics-related services.
          </p>
        </Section>

        <Section title="Your Rights">
          <p>
            You may contact us to request access, correction, or deletion of your
            personal data, subject to applicable law and operational requirements.
          </p>
        </Section>

        <Section title="Contact">
          <p>Email: privacy@bavnetwork.com</p>
          <p>Website: https://bavnetwork.com</p>
        </Section>
      </div>
    </main>
  );
}
