import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Search, TrendingUp, BarChart3, ArrowRight } from "lucide-react";

export default function Home() {
  const navigate = useNavigate();

  const handleLogin = () => navigate(`${createPageUrl("Authentication")}?mode=signin`);
  const handleSignup = () => navigate(`${createPageUrl("Authentication")}?mode=signup`);
  const handleContactUs = () => navigate(createPageUrl("ContactUs"));

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
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="Burgundy Bid" className="w-6 h-6 object-contain" />
              <span className="font-serif text-lg font-bold text-gray-900 tracking-tight">Burgundy Bid</span>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handleLogin}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 border-[#800020] h-9 px-4">
                Log in
              </Button>
              <Button onClick={handleSignup}
                className="bg-[#800020] hover:bg-[#6b001b] text-white text-sm font-medium h-9 px-4">
                Sign up
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 flex flex-col px-6 lg:px-14">

        {/* Hero */}
        <section className="flex-1 flex flex-col items-center justify-center text-center">
          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-gray-900 tracking-tight leading-tight mb-4">
            Know the true value
            <br />
            <span className="text-[#800020]">of every bottle</span>
          </h1>

          <p className="text-base md:text-lg text-gray-500 font-light max-w-xl mx-auto mb-8 leading-relaxed">
            Compare wine prices in seconds. Make informed decisions on every offer you receive.
          </p>

          <div className="flex items-center justify-center gap-3">
            <Button onClick={handleSignup} size="lg"
              className="bg-[#800020] hover:bg-[#6b001b] text-white font-medium h-11 px-7 gap-2 shadow-sm">
              Get started for free
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button onClick={handleLogin} variant="outline" size="lg"
              className="border-gray-200 text-gray-600 hover:bg-gray-50 font-medium h-11 px-7">
              Log in
            </Button>
          </div>
          <div className="flex justify-center mt-3">
            <Button onClick={handleContactUs} variant="outline" size="lg"
              className="border-gray-200 bg-white text-gray-600 hover:bg-gray-50 font-medium h-11 px-7">
              Contact us
            </Button>
          </div>
        </section>

        {/* Features — horizontal scroll on mobile, grid on md+ */}
        <section className="shrink-0 py-3 md:py-5">
          <div className="flex md:grid md:grid-cols-3 gap-3 md:gap-6 overflow-x-auto md:overflow-visible -mx-6 md:mx-0 px-6 md:px-0 pb-1 md:pb-0">
            <div className="flex items-center md:items-start gap-3 md:gap-4 px-3 py-2.5 md:px-4 md:py-4 rounded-xl bg-white border border-gray-100 flex-shrink-0 w-52 md:w-auto">
              <div className="w-8 h-8 md:w-10 md:h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                <Search className="w-4 h-4 md:w-5 md:h-5 text-gray-600" strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="font-serif text-sm md:text-base font-semibold text-gray-900 mb-0.5 md:mb-1">Quick Lookups</h3>
                <p className="text-gray-500 text-xs md:text-sm font-light leading-relaxed">
                  Search for single wines, paste a full list, upload a file, or use AI image search.
                </p>
              </div>
            </div>

            <div className="flex items-center md:items-start gap-3 md:gap-4 px-3 py-2.5 md:px-4 md:py-4 rounded-xl bg-white border border-gray-100 flex-shrink-0 w-52 md:w-auto">
              <div className="w-8 h-8 md:w-10 md:h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                <BarChart3 className="w-4 h-4 md:w-5 md:h-5 text-gray-600" strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="font-serif text-sm md:text-base font-semibold text-gray-900 mb-0.5 md:mb-1">Market Data</h3>
                <p className="text-gray-500 text-xs md:text-sm font-light leading-relaxed">
                  Real-time prices from community values and listings.
                </p>
              </div>
            </div>

            <div className="flex items-center md:items-start gap-3 md:gap-4 px-3 py-2.5 md:px-4 md:py-4 rounded-xl bg-white border border-gray-100 flex-shrink-0 w-52 md:w-auto">
              <div className="w-8 h-8 md:w-10 md:h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-gray-600" strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="font-serif text-sm md:text-base font-semibold text-gray-900 mb-0.5 md:mb-1">AI Image Search</h3>
                <p className="text-gray-500 text-xs md:text-sm font-light leading-relaxed">
                  Upload photos of wine menus or labels and let AI instantly identify wines and pull live market prices.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <div className="bg-white border-t border-gray-100 px-6 lg:px-14 py-3 md:py-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-serif text-xs md:text-sm font-semibold text-gray-900">Burgundy Bid</span>
          <div className="flex items-center gap-3 md:gap-6">
            <a href="/ContactUs"      className="font-serif text-xs md:text-sm text-gray-500 hover:text-gray-900 transition-colors">Contact Us</a>
            <a href="/TermsOfService" className="font-serif text-xs md:text-sm text-gray-500 hover:text-gray-900 transition-colors">Terms of Service</a>
            <a href="/PrivacyPolicy"  className="font-serif text-xs md:text-sm text-gray-500 hover:text-gray-900 transition-colors">Privacy Policy</a>
          </div>
        </div>
      </div>
    </div>
  );
}
