import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Wine, Mail, Clock, Calendar, ArrowLeft } from "lucide-react";

const API_BASE = (import.meta.env && import.meta.env.VITE_API_BASE_URL) || "";

export default function ContactUs() {
  const navigate = useNavigate();

  const handleLogin = () => navigate(`${createPageUrl("Authentication")}?mode=signin`);
  const handleSignup = () => navigate(`${createPageUrl("Authentication")}?mode=signup`);

  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [status, setStatus] = useState(null); // null | "success" | "error"
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          subject: form.subject,
          message: form.message,
        }),
      });
      if (!res.ok) throw new Error("Request failed");
      setStatus("success");
      setForm({ name: "", email: "", subject: "", message: "" });
    } catch {
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const contactDetails = [
    {
      title: "Email",
      value: "support@burgundybid.com",
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#f0f0f0]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');
        .font-serif { font-family: 'Playfair Display', Georgia, serif; }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; }
      `}</style>

      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 shrink-0">
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
        <div className="max-w-5xl mx-auto">

          {/* Back link */}
          <button
            onClick={() => navigate(createPageUrl("Home"))}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </button>

          {/* Two-column grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-start">

            {/* Left — contact info */}
            <div>
              <h1 className="font-serif text-3xl md:text-4xl font-bold text-gray-900 tracking-tight leading-tight mb-4">
                Get in touch
              </h1>
              <p className="text-gray-500 font-light leading-relaxed mb-10">
                Have a question about Burgundy Bid, or need help with your account?
                Send us a message and our team will get back to you promptly.
              </p>

              <div className="flex flex-col gap-4">
                {contactDetails.map(({title, value }) => (
                  <div
                    key={title}
                    className="flex items-center gap-4 bg-white border border-gray-100 rounded-xl px-5 py-4 shadow-sm"
                  >
                    <div>
                      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">{title}</p>
                      <p className="text-sm font-medium text-gray-800">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — contact form */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 md:p-8">
              <h2 className="font-serif text-xl font-semibold text-gray-900 mb-6">Send us a message</h2>

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name" className="text-sm font-medium text-gray-700">Full Name</Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Jane Smith"
                    className="h-10 text-sm border-gray-200 focus:border-[#800020] focus:ring-[#800020]/20"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={form.email}
                    onChange={handleChange}
                    placeholder="jane@example.com"
                    className="h-10 text-sm border-gray-200 focus:border-[#800020] focus:ring-[#800020]/20"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="subject" className="text-sm font-medium text-gray-700">Subject</Label>
                  <Input
                    id="subject"
                    name="subject"
                    type="text"
                    required
                    value={form.subject}
                    onChange={handleChange}
                    placeholder="e.g. Question about pricing"
                    className="h-10 text-sm border-gray-200 focus:border-[#800020] focus:ring-[#800020]/20"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="message" className="text-sm font-medium text-gray-700">Message</Label>
                  <Textarea
                    id="message"
                    name="message"
                    required
                    rows={4}
                    value={form.message}
                    onChange={handleChange}
                    placeholder="Tell us how we can help..."
                    className="text-sm border-gray-200 focus:border-[#800020] focus:ring-[#800020]/20 resize-none"
                  />
                </div>

                {status === "success" && (
                  <p className="text-sm text-green-600 bg-green-50 border border-green-100 rounded-lg px-4 py-3">
                    Your message has been sent. We'll get back to you within 48 hours.
                  </p>
                )}

                {status === "error" && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                    Something went wrong. Please try again or email us directly at support@burgundybid.com.
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="bg-[#800020] hover:bg-[#6b001b] text-white text-sm font-medium h-10 w-full mt-1 disabled:opacity-60"
                >
                  {loading ? "Sending…" : "Send message"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="shrink-0 bg-white border-t border-gray-100 px-6 lg:px-14 py-3 md:py-4">
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
