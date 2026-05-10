import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function TermsOfService() {
  const navigate = useNavigate();

  const handleLogin = () => navigate(`${createPageUrl("Authentication")}?mode=signin`);
  const handleSignup = () => navigate(`${createPageUrl("Authentication")}?mode=signup`);

  const sections = [
    {
      id: "acceptance",
      title: "1. Acceptance of Terms",
      content: (
        <>
          <p>
            By accessing or using Burgundy Bid (the "Service"), operated by Burgundy Bid ("we," "us," or "our"), you
            agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not access
            or use the Service.
          </p>
          <p className="mt-3">
            These Terms apply to all visitors, registered users, and any other individuals who access or use the
            Service. We reserve the right to update or modify these Terms at any time. Continued use of the Service
            after changes are posted constitutes your acceptance of the revised Terms.
          </p>
        </>
      ),
    },
    {
      id: "description",
      title: "2. Description of Service",
      content: (
        <>
          <p>
            Burgundy Bid is a wine pricing intelligence platform that aggregates market data from multiple sources
            to help users evaluate the fair market value of wine bottles. The Service includes:
          </p>
          <ul className="list-disc pl-5 mt-3 space-y-1.5">
            <li>Single and bulk wine price lookups via multiple input methods</li>
            <li>Aggregated pricing data sourced from various platforms</li>
            <li>Batch history for reviewing past lookup results</li>
            <li>Subscription-based access tiers with configurable lookup limits</li>
            <li>
              <strong>AI Image Search (OCR):</strong> Upload photos of wine lists, cellar labels, or bottle images
              and our AI will identify wines and retrieve live market pricing. Each image
              processed consumes one AI Image Search credit from your monthly plan allowance.
            </li>
          </ul>
          <p className="mt-3">
            Pricing data is provided for informational purposes only and does not constitute financial, investment,
            or professional advice. Actual market prices may differ. We make no guarantees as to the accuracy,
            completeness, or timeliness of any pricing information.
          </p>
        </>
      ),
    },
    {
      id: "accounts",
      title: "3. User Accounts",
      content: (
        <>
          <p>
            To access certain features of the Service, you must register for an account. You agree to:
          </p>
          <ul className="list-disc pl-5 mt-3 space-y-1.5">
            <li>Provide accurate, current, and complete registration information</li>
            <li>Maintain the security of your password and account credentials</li>
            <li>Notify us immediately of any unauthorized use of your account at support@burgundybid.com</li>
            <li>Accept responsibility for all activity that occurs under your account</li>
          </ul>
          <p className="mt-3">
            You must be at least 18 years of age, and of legal age to purchase or handle alcohol in your
            jurisdiction, to create an account and use the Service. By registering, you represent that you meet
            these requirements.
          </p>
          <p className="mt-3">
            We reserve the right to suspend or terminate accounts that violate these Terms, engage in fraudulent
            activity, or are otherwise misused.
          </p>
        </>
      ),
    },
    {
      id: "subscriptions",
      title: "4. Subscriptions and Billing",
      content: (
        <>
          <p>
            Burgundy Bid offers paid subscription plans in addition to a free tier.
          </p>
          <p className="mt-3">
            Subscriptions are billed on a recurring monthly and annually basis through our payment processor, Stripe. By
            subscribing, you authorize us to charge your payment method on a recurring basis until you cancel.
          </p>
          <p className="mt-3">
            All subscription fees are non-refundable except where required by applicable law. You may cancel your
            subscription at any time through your Profile settings or by contacting us at support@burgundybid.com.
            Cancellation takes effect at the end of the current billing period; you will retain access to paid
            features until that date.
          </p>
          <p className="mt-3">
            We reserve the right to change subscription pricing with reasonable advance notice. Continued use of
            the Service after a price change constitutes acceptance of the new pricing.
          </p>
        </>
      ),
    },
    {
      id: "external-credentials",
      title: "5. Third-Party Site Credentials",
      content: (
        <>
          <p>
            The Service allows you to optionally connect credentials for third-party platforms to enhance lookup results. By providing these credentials, you acknowledge
            and agree that:
          </p>
          <ul className="list-disc pl-5 mt-3 space-y-1.5">
            <li>You are the authorized account holder for the credentials provided</li>
            <li>
              Credentials are stored using encryption and used solely to retrieve pricing
              data on your behalf
            </li>
            <li>
              You are responsible for ensuring your use of these integrations complies with the terms of service
              of the respective third-party platforms
            </li>
            <li>We are not affiliated with, endorsed by, or responsible for any other third-party platform</li>
          </ul>
          <p className="mt-3">
            You may remove stored credentials at any time through the Connections settings page. We will not use
            your credentials for any purpose other than retrieving data for your wine lookups.
          </p>
        </>
      ),
    },
    {
      id: "acceptable-use",
      title: "6. Acceptable Use",
      content: (
        <>
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc pl-5 mt-3 space-y-1.5">
            <li>Violate any applicable law or regulation</li>
            <li>
              Attempt to scrape, harvest, or systematically extract data from the Service beyond normal usage
            </li>
            <li>
              Use automated tools, bots, or scripts to access the Service in a manner that places excessive load
              on our infrastructure
            </li>
            <li>Circumvent any lookup limits, subscription restrictions, or access controls</li>
            <li>Upload malicious files, malware, or harmful content</li>
            <li>Impersonate any person or entity, or misrepresent your affiliation with any person or entity</li>
            <li>Interfere with or disrupt the integrity or performance of the Service</li>
            <li>Attempt to gain unauthorized access to any portion of the Service or its related systems</li>
          </ul>
          <p className="mt-3">
            Violations of this section may result in immediate account suspension or termination without refund.
          </p>
        </>
      ),
    },
    {
      id: "intellectual-property",
      title: "7. Intellectual Property",
      content: (
        <>
          <p>
            The Service, including its interface, design, software, logos, and all content created by Burgundy Bid,
            is the exclusive property of Burgundy Bid and its licensors. These materials are protected by copyright,
            trademark, and other applicable intellectual property laws.
          </p>
          <p className="mt-3">
            You are granted a limited, non-exclusive, non-transferable, revocable license to access and use the
            Service for personal, non-commercial purposes in accordance with these Terms. You may not copy,
            reproduce, distribute, modify, create derivative works of, or otherwise exploit any content or
            materials from the Service without our prior written consent.
          </p>
          <p className="mt-3">
            Wine pricing data aggregated through the Service originates from third-party sources. We do not claim
            ownership over third-party data and make no representations regarding the intellectual property rights
            of such data.
          </p>
        </>
      ),
    },
    {
      id: "data-retention",
      title: "8. Data Retention",
      content: (
        <>
          <p>We retain your lookup data and account information according to the following policy:</p>
          <ul className="list-disc pl-5 mt-3 space-y-1.5">
            <li>
              <strong>Free plan:</strong> Lookup history and account data are retained indefinitely while your
              account remains active.
            </li>
            <li>
              <strong>Basic and Pro plans:</strong> Lookup records are soft-deleted 6 months after creation and
              permanently deleted 1 month after soft deletion (7 months total retention).
            </li>
          </ul>
          <p className="mt-3">
            You may permanently delete your account at any time through your Profile settings. Account deletion is
            immediate and irreversible. All associated data — including lookup history, connections, and payment
            records — is permanently removed. Any active subscription is cancelled automatically upon deletion.
            Support tickets submitted prior to deletion may be retained for legal compliance purposes.
          </p>
        </>
      ),
    },
    {
      id: "disclaimers",
      title: "9. Disclaimers and Limitation of Liability",
      content: (
        <>
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
            IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
            PURPOSE, AND NON-INFRINGEMENT.
          </p>
          <p className="mt-3">
            We do not warrant that: (a) the Service will be uninterrupted, error-free, or secure; (b) pricing data
            will be accurate, complete, or current; (c) results obtained from the Service will meet your
            expectations.
          </p>
          <p className="mt-3">
            TO THE FULLEST EXTENT PERMITTED BY LAW, BURGUNDY BID SHALL NOT BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR
            GOODWILL, ARISING FROM YOUR USE OF OR INABILITY TO USE THE SERVICE, EVEN IF WE HAVE BEEN ADVISED
            OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING
            TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID TO US IN THE 12 MONTHS PRECEDING
            THE CLAIM.
          </p>
        </>
      ),
    },
    {
      id: "indemnification",
      title: "10. Indemnification",
      content: (
        <p>
          You agree to indemnify, defend, and hold harmless Burgundy Bid and its officers, directors, employees,
          agents, and licensors from and against any claims, liabilities, damages, judgments, awards, losses,
          costs, expenses, or fees (including reasonable attorneys' fees) arising out of or relating to your
          violation of these Terms, your use of the Service, or your violation of any rights of a third party,
          including any third-party platform whose credentials you have provided.
        </p>
      ),
    },
    {
      id: "termination",
      title: "11. Termination",
      content: (
        <>
          <p>
            We may suspend or terminate your access to the Service at any time, with or without cause, and with
            or without notice. Upon termination, your right to use the Service ceases immediately.
          </p>
          <p className="mt-3">
            You may terminate your account at any time through your Profile settings or by contacting
            support@burgundybid.com. Sections of these Terms that by their nature should survive termination
            (including Intellectual Property, Disclaimers, Limitation of Liability, and Indemnification) shall
            survive.
          </p>
        </>
      ),
    },
    {
      id: "governing-law",
      title: "12. Governing Law and Disputes",
      content: (
        <>
          <p>
            These Terms shall be governed by and construed in accordance with applicable law. Any dispute arising
            out of or relating to these Terms or the Service that cannot be resolved informally shall be subject
            to binding arbitration or the exclusive jurisdiction of the courts in the applicable jurisdiction,
            as determined by applicable law.
          </p>
          <p className="mt-3">
            We encourage you to contact us at support@burgundybid.com before initiating any formal dispute
            resolution process. Many concerns can be addressed quickly through direct communication.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      title: "13. Contact",
      content: (
        <p>
          If you have any questions about these Terms of Service, please contact us at{" "}
          <a href="mailto:support@burgundybid.com" className="text-[#800020] underline underline-offset-2">
            support@burgundybid.com
          </a>
          .
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
              Terms of Service
            </h1>
            <p className="text-sm text-gray-400">Last updated: April 4, 2026</p>
            <p className="text-gray-500 font-light leading-relaxed mt-4">
              Please read these Terms of Service carefully before using Burgundy Bid. By accessing or using our
              platform, you agree to be bound by these Terms.
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
