import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  const handleLogin = () => navigate(`${createPageUrl("Authentication")}?mode=signin`);
  const handleSignup = () => navigate(`${createPageUrl("Authentication")}?mode=signup`);

  const sections = [
    {
      id: "overview",
      title: "1. Overview",
      content: (
        <>
          <p>
            Burgundy Bid ("we," "us," or "our") operates the Burgundy Bid wine pricing platform (the "Service").
            This Privacy Policy explains what personal information we collect, how we use it, with whom we share it,
            and the choices you have regarding your information.
          </p>
          <p className="mt-3">
            By using the Service, you agree to the collection and use of information as described in this policy.
            We will not use or share your information in ways other than those described here.
          </p>
          <p className="mt-3">
            This policy applies to all users of the Service, including visitors to our website, registered account
            holders, and subscribers to any paid plan.
          </p>
        </>
      ),
    },
    {
      id: "information-collected",
      title: "2. Information We Collect",
      content: (
        <>
          <p className="font-medium text-gray-700 mb-2">2.1 Account Information</p>
          <p>When you create an account, we collect:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li>Full name</li>
            <li>Email address</li>
            <li>Password (encrypted)</li>
            <li>Email verification status</li>
          </ul>

          <p className="font-medium text-gray-700 mt-5 mb-2">2.2 Usage and Lookup Data</p>
          <p>When you use the Service, we collect:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li>Wine lookup queries and results (text entries, uploaded files, AI OCR image data)</li>
            <li>Batch lookup history and metadata</li>
            <li>Lookup method used (single, paste list, file upload, image)</li>
            <li>Timestamps and activity logs associated with your account</li>
          </ul>

          <p className="font-medium text-gray-700 mt-5 mb-2">2.3 AI Image Search Data</p>
          <p>
            When you use the AI Image Search (OCR) feature, we process images you upload with AI
            to extract wine information. We collect and store:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li>A cryptographic hash (SHA-256) of each uploaded image for caching purposes — the image itself is not stored on our servers</li>
            <li>The structured wine data extracted from the image (wine name, vintage, bottle size)</li>
            <li>Token usage metadata for billing and quota tracking</li>
            <li>Credit usage counts against your monthly AI Image Search allowance</li>
          </ul>
          <p className="mt-3">
            Images are transmitted to AI for processing. We do not retain the raw image content after processing.
          </p>

          <p className="font-medium text-gray-700 mt-5 mb-2">2.4 Third-Party Credentials (Optional)</p>
          <p>
            If you choose to connect your accounts, we store your credentials
            for those platforms. These credentials are:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li>Encrypted at rest</li>
            <li>Used solely to retrieve wine pricing data on your behalf</li>
            <li>Never shared with third parties outside of the specific platform authentication</li>
            <li>Removable at any time from your Connections settings page</li>
          </ul>

          <p className="font-medium text-gray-700 mt-5 mb-2">2.5 Subscription and Payment Data</p>
          <p>
            When you subscribe to a paid plan, payment processing is handled entirely by Stripe. We do not store
            your full credit card number, CVV, or payment card details on our servers. We retain only your Stripe
            customer ID and your current subscription plan status.
          </p>

          <p className="font-medium text-gray-700 mt-5 mb-2">2.6 Support and Communications</p>
          <p>If you contact us, we collect:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li>Your name and email address</li>
            <li>The content of your support tickets or contact form submissions</li>
            <li>Ticket category (general, billing, bug, account, data)</li>
          </ul>

          <p className="font-medium text-gray-700 mt-5 mb-2">2.7 Technical Information</p>
          <p>We may automatically collect certain technical data when you use the Service, including:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li>Authentication tokens</li>
            <li>Session and connection metadata</li>
            <li>Browser type and version (via standard HTTP headers)</li>
          </ul>
        </>
      ),
    },
    {
      id: "how-we-use",
      title: "3. How We Use Your Information",
      content: (
        <>
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-5 mt-3 space-y-1.5">
            <li>Create and manage your account, including authentication and password resets</li>
            <li>Process your wine price lookup requests and return results</li>
            <li>Manage subscription billing and provide access to plan-appropriate features</li>
            <li>Store and retrieve your third-party site credentials to query external pricing data on your behalf</li>
            <li>Send transactional emails such as email verification, password reset links, and subscription receipts</li>
            <li>Respond to support tickets and contact form inquiries</li>
            <li>Enforce our Terms of Service and prevent abuse</li>
            <li>Monitor and improve the reliability, performance, and security of the Service</li>
          </ul>
          <p className="mt-3">
            We do not use your personal information for advertising purposes and do not sell your data to
            third parties.
          </p>
        </>
      ),
    },
    {
      id: "sharing",
      title: "4. Sharing of Information",
      content: (
        <>
          <p>
            We do not sell, trade, or rent your personal information to third parties. We share information only
            in the following limited circumstances:
          </p>

          <p className="font-medium text-gray-700 mt-4 mb-2">4.1 Service Providers</p>
          <p>
            We use trusted third-party service providers who process data on our behalf, including:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li>
              <strong>Stripe</strong> — Payment processing for subscriptions. Stripe's privacy policy governs
              how Stripe handles your payment information.
            </li>
          </ul>

          <p className="font-medium text-gray-700 mt-4 mb-2">4.2 Third-Party Platform Authentication</p>
          <p>
            If you provide credentials for third-party platforms, those credentials are transmitted
            to the respective platform to authenticate on your behalf. We do not share your credentials with any
            other party.
          </p>

          <p className="font-medium text-gray-700 mt-4 mb-2">4.3 Legal Requirements</p>
          <p>
            We may disclose your information if required to do so by law or in good-faith belief that such
            disclosure is necessary to comply with a legal obligation, protect the rights or safety of Burgundy
            Bid, our users, or the public, or respond to a valid legal request from authorities.
          </p>

          <p className="font-medium text-gray-700 mt-4 mb-2">4.4 Business Transfers</p>
          <p>
            In the event of a merger, acquisition, or sale of all or a portion of our assets, your information
            may be transferred as part of that transaction. We will notify you of any such change in ownership
            or use of your personal information.
          </p>
        </>
      ),
    },
    {
      id: "data-retention",
      title: "5. Data Retention",
      content: (
        <>
          <p>We retain your data for the following periods:</p>
          <ul className="list-disc pl-5 mt-3 space-y-1.5">
            <li>
              <strong>Free plan users:</strong> Account data and lookup history are retained indefinitely while
              your account remains active.
            </li>
            <li>
              <strong>Basic and Pro plan users:</strong> Lookup records are soft-deleted 6 months after creation
              and permanently deleted 1 month after soft deletion (approximately 7 months total).
            </li>
            <li>
              <strong>Account deletion:</strong> When you delete your account through the Profile settings, it is
              permanently and immediately removed from our systems. All associated data — including lookup history,
              connections, activity logs, sessions, and payment records — is deleted. Any active Stripe subscription
              is cancelled automatically. AI Image Search (OCR) request records are retained in anonymised form
              (with your user identity removed) for internal usage analytics. Contact submissions and support
              tickets submitted before account deletion may be retained to comply with applicable legal obligations.
            </li>
            <li>
              <strong>Support tickets and contact submissions:</strong> Retained as needed to maintain support
              history and comply with applicable legal obligations.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "security",
      title: "6. Data Security",
      content: (
        <>
          <p>We implement technical and organizational measures to protect your information, including:</p>
          <ul className="list-disc pl-5 mt-3 space-y-1.5">
            <li>Passwords are hashed using bcrypt with a salt before storage</li>
            <li>Third-party credentials are encrypted</li>
            <li>Authentication is handled via short-lived JSON Web Tokens (JWT) with 7-day expiry</li>
            <li>HTTPS is enforced for all data transmission</li>
            <li>External site session cookies are rotated regularly</li>
          </ul>
          <p className="mt-3">
            While we take reasonable steps to protect your information, no method of transmission or storage is
            100% secure. We cannot guarantee absolute security. If you believe your account has been compromised,
            please contact us immediately at support@burgundybid.com.
          </p>
        </>
      ),
    },
    {
      id: "your-rights",
      title: "7. Your Rights and Choices",
      content: (
        <>
          <p>You have the following rights with respect to your personal information:</p>
          <ul className="list-disc pl-5 mt-3 space-y-2">
            <li>
              <strong>Access:</strong> You may request a copy of the personal data we hold about you.
            </li>
            <li>
              <strong>Correction:</strong> You may update your name and email address through your Profile
              settings at any time.
            </li>
            <li>
              <strong>Deletion:</strong> You may permanently delete your account directly from your Profile
              settings page. Deletion is immediate and irreversible — all personal data is removed from our systems.
              Certain data (e.g. prior support tickets) may be retained to comply with legal obligations.
            </li>
            <li>
              <strong>Credential removal:</strong> You may remove any stored third-party credentials at any time
              through the Connections settings page.
            </li>
            <li>
              <strong>Subscription cancellation:</strong> You may cancel your subscription at any time through
              your Profile settings or by contacting us.
            </li>
            <li>
              <strong>Opt-out of non-essential communications:</strong> We only send transactional emails. If
              you wish to stop receiving support-related communications, you may contact us to request this.
            </li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, please contact us at{" "}
            <a href="mailto:support@burgundybid.com" className="text-[#800020] underline underline-offset-2">
              support@burgundybid.com
            </a>
            . We will respond to your request within a reasonable timeframe.
          </p>
        </>
      ),
    },
    {
      id: "cookies",
      title: "8. Cookies and Local Storage",
      content: (
        <>
          <p>
            Burgundy Bid uses browser localStorage to store your authentication token (JWT) for session
            management. This is required for the Service to function and allows you to remain logged in between
            sessions.
          </p>
          <p className="mt-3">
            We do not currently use advertising cookies, tracking pixels, or cross-site tracking technologies.
            Third-party providers integrated with the Service (such as Stripe) may use their own cookies
            subject to their respective privacy policies.
          </p>
          <p className="mt-3">
            You may clear your browser's localStorage at any time to remove your authentication token, which
            will log you out of the Service.
          </p>
        </>
      ),
    },
    {
      id: "minors",
      title: "9. Children's Privacy",
      content: (
        <p>
          The Service is not directed to children under the age of 18 and is intended only for individuals who
          are of legal drinking age in their jurisdiction. We do not knowingly collect personal information from
          minors. If you believe we have inadvertently collected data from a minor, please contact us at
          support@burgundybid.com and we will promptly delete the information.
        </p>
      ),
    },
    {
      id: "third-party-links",
      title: "10. Third-Party Links and Services",
      content: (
        <p>
          The Service integrates with or references third-party platforms. These platforms have their own privacy 
          policies and terms of service that govern how they handle your data. We are not responsible for the privacy 
          practices of any third-party platforms. We encourage you to review the privacy policies of any third-party 
          services you use in connection with Burgundy Bid.
        </p>
      ),
    },
    {
      id: "changes",
      title: "11. Changes to This Policy",
      content: (
        <>
          <p>
            We may update this Privacy Policy from time to time. When we make material changes, we will update
            the "Last updated" date at the top of this page and, where appropriate, notify you by email or via a
            prominent notice within the Service.
          </p>
          <p className="mt-3">
            Your continued use of the Service after any changes to this policy constitutes your acceptance of
            the revised Privacy Policy. We encourage you to review this page periodically.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      title: "12. Contact Us",
      content: (
        <p>
          If you have any questions, concerns, or requests regarding this Privacy Policy or how we handle your
          personal information, please contact us at:{" "}
          <a href="mailto:support@burgundybid.com" className="text-[#800020] underline underline-offset-2">
            support@burgundybid.com
          </a>
          . Our team is available Monday through Friday, 9am–6pm, and we aim to respond within 24 hours.
        </p>
      ),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#f0f0f0]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');
        .font-serif { font-family: 'Playfair Display', Georgia, serif; }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; }
      `}</style>

      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="px-6 lg:px-14">
          <div className="flex items-center justify-between h-14">
            <a href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
              <img src="/logo.png" alt="Burgundy Bid" className="w-6 h-6 object-contain" />
              <span className="font-serif text-lg font-bold text-gray-900 tracking-tight">Burgundy Bid</span>
            </a>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                onClick={handleLogin}
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Log in
              </Button>
              <Button
                onClick={handleSignup}
                className="bg-[#800020] hover:bg-[#6b001b] text-white text-sm font-medium h-9 px-4"
              >
                Sign up
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 px-6 lg:px-14 py-12 md:py-16">
        <div className="max-w-3xl mx-auto">

          {/* Back link */}
          <button
            onClick={() => navigate(createPageUrl("Home"))}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </button>

          {/* Header */}
          <div className="mb-10">
            <h1 className="font-serif text-3xl md:text-4xl font-bold text-gray-900 tracking-tight leading-tight mb-3">
              Privacy Policy
            </h1>
            <p className="text-sm text-gray-400">Last updated: April 4, 2026</p>
            <p className="text-gray-500 font-light leading-relaxed mt-4">
              Your privacy is important to us. This policy explains how Burgundy Bid collects, uses, and protects
              your personal information when you use our platform.
            </p>
          </div>

          {/* Table of contents */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 mb-10">
            <h2 className="font-serif text-base font-semibold text-gray-900 mb-4">Table of Contents</h2>
            <ol className="space-y-2">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="text-sm text-[#800020] hover:text-[#6b001b] underline underline-offset-2 transition-colors"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>

          {/* Sections */}
          <div className="flex flex-col gap-8">
            {sections.map((s) => (
              <section
                key={s.id}
                id={s.id}
                className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 md:p-8"
              >
                <h2 className="font-serif text-lg font-semibold text-gray-900 mb-4">{s.title}</h2>
                <div className="text-sm text-gray-600 leading-relaxed">{s.content}</div>
              </section>
            ))}
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="shrink-0 bg-white border-t border-gray-100 px-6 lg:px-14 py-3 md:py-4 mt-8">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-serif text-xs md:text-sm font-semibold text-gray-900">Burgundy Bid</span>
          <div className="flex items-center gap-3 md:gap-6">
            <a href="/ContactUs"      className="font-serif text-xs md:text-sm text-gray-500 hover:text-gray-900 transition-colors">Contact Us</a>
            <a href="/TermsOfService" className="font-serif text-xs md:text-sm text-gray-500 hover:text-gray-900 transition-colors">Terms of Service</a>
            <a href="/PrivacyPolicy"  className="font-serif text-xs md:text-sm text-gray-500 hover:text-gray-900 transition-colors">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
