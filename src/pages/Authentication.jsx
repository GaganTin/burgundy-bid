import { useState, useEffect } from "react";
import validator from 'validator';
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPageUrl, PASSWORD_RULES, checkPassword } from "@/utils";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useAuth } from '@/lib/AuthContext';


const WINE_QUOTES = [
  { quote: "Wine is bottled poetry.", author: "Robert Louis Stevenson" },
  { quote: "Either give me more wine or leave me alone.", author: "Rumi" },
  { quote: "In vino veritas.", author: "Pliny the Elder" },
  { quote: "Wine makes daily living easier, less hurried, with fewer tensions and more tolerance.", author: "Benjamin Franklin" },
  { quote: "I cook with wine; sometimes I even add it to the food.", author: "W.C. Fields" },
  { quote: "Wine is the most healthful and most hygienic of beverages.", author: "Louis Pasteur" },
  { quote: "Men are like wine — some turn to vinegar, but the best improve with age.", author: "Pope John XXIII" },
  { quote: "A meal without wine is like a day without sunshine.", author: "Anthelme Brillat-Savarin" },
  { quote: "Wine is the divine juice of September.", author: "Voltaire" },
  { quote: "One not only drinks wine, one smells it, observes it, tastes it, sips it and — one talks about it.", author: "King Edward VII" },
  { quote: "Wine is sunlight held together by water.", author: "Galileo Galilei" },
  { quote: "Accept what life offers you and try to drink from every cup. All wines should be tasted; some should only be sipped, but with others, drink the whole bottle.", author: "Paulo Coelho" },
  { quote: "To take wine into our mouths is to savour a droplet of the river of human history.", author: "Clifton Fadiman" },
  { quote: "Wine is proof that God loves us and wants us to be happy.", author: "Benjamin Franklin" },
  { quote: "Quickly, bring me a beaker of wine, so that I may wet my mind and say something clever.", author: "Aristophanes" },
  { quote: "Where there is no wine there is no love.", author: "Euripides" },
  { quote: "Wine is the most civilised thing in the world.", author: "Ernest Hemingway" },
  { quote: "My only regret in life is that I did not drink more wine.", author: "Ernest Hemingway" },
  { quote: "Beer is made by men, wine by God.", author: "Martin Luther" },
  { quote: "The discovery of a good wine is increasingly better for mankind than the discovery of a new star.", author: "Leonardo da Vinci" },
  { quote: "Life is too short to drink bad wine.", author: "Johann Wolfgang von Goethe" },
  { quote: "From wine what sudden friendship springs!", author: "John Gay" },
  { quote: "I love everything that is old: old friends, old times, old manners, old books, old wine.", author: "Oliver Goldsmith" },
  { quote: "Wine is a living liquid containing no preservatives. Its life cycle comprises youth, maturity, old age, and death.", author: "Julia Child" },
  { quote: "There must be always wine and fellowship or we are truly lost.", author: "Ann Fairbairn" },
  { quote: "Penicillin cures, but wine makes people happy.", author: "Alexander Fleming" },
  { quote: "The first glass is for myself, the second for my friends, the third for good humor, and the fourth for my enemies.", author: "William Temple" },
  { quote: "Wine makes every meal an occasion, every table more elegant, every day more civilised.", author: "Andre Simon" },
  { quote: "A bottle of wine contains more philosophy than all the books in the world.", author: "Louis Pasteur" },
  { quote: "Age is just a number. It's totally irrelevant unless, of course, you happen to be a bottle of wine.", author: "Joan Collins" },
  { quote: "Wine gives courage and makes men more apt for passion.", author: "Ovid" },
  { quote: "Nothing makes the future look so rosy as to contemplate it through a glass of Chambertin.", author: "Napoleon Bonaparte" },
  { quote: "Soul and wine — and love — together are the sum of happiness.", author: "Omar Khayyam" },
  { quote: "Wine can be a better teacher than ink, and banter is often better than books.", author: "Stephen Fry" },
  { quote: "Burgundy makes you think of silly things, Bordeaux makes you talk of them, and Champagne makes you do them.", author: "Jean-Anthelme Brillat-Savarin" },
  { quote: "I could not live without Champagne. In victory I deserve it; in defeat I need it.", author: "Napoleon Bonaparte" },
  { quote: "Drinking good wine with good food in good company is one of life's most civilised pleasures.", author: "Michael Broadbent" },
  { quote: "What though youth gave love and roses, age still leaves us friends and wine.", author: "Thomas Moore" },
  { quote: "Wine is just a conversation waiting to happen.", author: "Anonymous" },
  { quote: "The best wine is the wine you drink with people you love.", author: "Anonymous" },
];

function validateEmail(email) {
  if (!validator.isEmail(email.trim())) return 'Please enter a valid email address.';
  return null;
}

function PasswordRequirements({ password }) {
  if (!password) return null;
  const { failed } = checkPassword(password);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
      {PASSWORD_RULES.map(r => {
        const met = !failed.includes(r.id);
        return (
          <span key={r.id} className={`flex items-center gap-1 text-xs transition-colors ${met ? 'text-emerald-600' : 'text-gray-400'}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${met ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            {r.label}
          </span>
        );
      })}
    </div>
  );
}

export default function AuthPreview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') || 'signin';
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    const m = searchParams.get('mode');
    if (m && ['signin', 'signup', 'forgot', 'reset', 'verify'].includes(m)) setMode(m);
  }, [searchParams]);

  const navigate = useNavigate();
  const { refreshAuthFromLocal, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated && !['verify', 'reset'].includes(mode)) {
      navigate(createPageUrl('Lookup'), { replace: true });
    }
  }, [isAuthenticated, navigate, mode]);

  // Handle Google OAuth callback — server redirects back with ?token=... or ?oauth_error=...
  useEffect(() => {
    /** @type {Record<string, string>} */
    const OAUTH_ERROR_MESSAGES = {
      account_deleted: 'This Google account is linked to a Burgundy Bid account that was deleted. Please use a different Google account or sign up with a new email.',
      cancelled:       "Google sign-in was cancelled. Tap the button again whenever you're ready.",
      token_failed:    "We couldn't complete your Google sign-in. Please try again.",
      no_email:        "Google didn't share your email address. Please check your Google account permissions and try again.",
      server_error:    'Something went wrong on our end. Please try again in a moment.',
    };

    const handleCallback = async () => {
      const oauthError = searchParams.get('oauth_error');
      if (oauthError) {
        setSigninError(OAUTH_ERROR_MESSAGES[oauthError] || "We couldn't complete your Google sign-in. Please try again.");
        setSearchParams({ mode: searchParams.get('mode') || 'signin' });
        return;
      }

      // If this is a password-reset link (?mode=reset&token=...) the token belongs
      // to the reset flow, not OAuth — bail out so we don't corrupt auth state.
      if (searchParams.get('mode') === 'reset') return;

      const token = searchParams.get('token');
      const refreshToken = searchParams.get('refreshToken');
      const user = searchParams.get('user');
      if (!token) return;

      try {
        // Clear any stale tokens first so checkAppState (running in parallel)
        // doesn't race against our new tokens when it reads localStorage.
        localStorage.removeItem('app_access_token');
        localStorage.removeItem('app_refresh_token');
        localStorage.removeItem('app_current_user');

        // Now set the fresh tokens from the OAuth callback
        localStorage.setItem('app_access_token', token);
        if (refreshToken) localStorage.setItem('app_refresh_token', refreshToken);
        if (user) localStorage.setItem('app_current_user', user);

        // Await so auth state is fully set before we navigate
        await refreshAuthFromLocal();
        navigate(createPageUrl('Lookup'), { replace: true });
      } catch (e) {
        setSigninError("We couldn't complete your Google sign-in. Please try again.");
      }
    };

    handleCallback();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * WINE_QUOTES.length));
  const [quoteVisible, setQuoteVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setQuoteVisible(false);
      setTimeout(() => {
        setQuoteIndex(i => (i + 1) % WINE_QUOTES.length);
        setQuoteVisible(true);
      }, 600);
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  // Signin / signup
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signinError, setSigninError] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState(false);

  // Password visibility toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  // Forgot password
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");

  // Reset password
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resetDone, setResetDone] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");

  // Email verification
  const [pendingEmail, setPendingEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyDone, setVerifyDone] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  const API_BASE = (import.meta.env && import.meta.env.VITE_API_BASE_URL) || '';

  const switchMode = (m) => {
    setMode(m);
    setSearchParams({ mode: m });
    setSigninError("");
    setUnverifiedEmail(false);
  };

  const getAuthHeader = () => {
    const token = localStorage.getItem('app_access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  const handleForgotSubmit = async () => {
    if (!email.trim()) return;
    setForgotLoading(true);
    setForgotError("");
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setForgotError(json?.error || "Failed to send reset email. Please try again.");
        return;
      }
      setForgotSent(true);
    } catch (err) {
      setForgotError("Failed to send reset email. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResetSubmit = async () => {
    const token = searchParams.get('token');
    if (!token) { setResetError("Missing reset token. Request a new link."); return; }
    if (!checkPassword(newPassword).valid) { setResetError("Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character."); return; }
    if (newPassword !== confirmNewPassword) { setResetError("Passwords do not match."); return; }
    setResetLoading(true);
    setResetError("");
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: newPassword }),
      });
      const json = await res.json();
      if (!res.ok) { setResetError(json?.error || "Reset failed. The link may have expired."); return; }
      setResetDone(true);
    } catch (err) {
      setResetError("Something went wrong. Please try again.");
    } finally {
      setResetLoading(false);
    }
  };

  const handleVerifySubmit = async () => {
    if (!verifyCode.trim()) return;
    setVerifyLoading(true);
    setVerifyError("");
    try {
      const verifyEmail = pendingEmail || email;
      const res = await fetch(`${API_BASE}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ code: verifyCode, email: verifyEmail }),
      });
      const json = await res.json();
      if (!res.ok) { setVerifyError(json?.error || "Invalid code. Please try again."); return; }
      // If server returned credentials, store them and navigate directly
      if (json.token) {
        localStorage.setItem('app_current_user', JSON.stringify(json.user));
        localStorage.setItem('app_access_token', json.token);
        if (json.refreshToken) localStorage.setItem('app_refresh_token', json.refreshToken);
        try { await refreshAuthFromLocal(); } catch (e) { console.warn('refreshAuthFromLocal failed', e); }
        navigate(createPageUrl('Lookup'), { replace: true });
        return;
      }
      setVerifyDone(true);
    } catch (err) {
      setVerifyError("Something went wrong. Please try again.");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleResendVerify = async () => {
    setResendLoading(true);
    setResendSent(false);
    try {
      const verifyEmail = pendingEmail || email;
      await fetch(`${API_BASE}/auth/send-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ email: verifyEmail }),
      });
      setResendSent(true);
    } catch (err) {
      // silently fail — user can try again
    } finally {
      setResendLoading(false);
    }
  };

  const renderForm = () => {
    // ── Forgot password ──────────────────────────────────────────────────────
    if (mode === 'forgot') {
      if (forgotSent) {
        return (
          <div className="space-y-6">
            <div className="mb-7">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-serif font-bold text-gray-900 tracking-tight">Check your email</h1>
              <p className="text-gray-500 text-sm font-light mt-1">
                We've sent a password reset link to <strong>{email}</strong>. Check your inbox (and spam folder).
              </p>
            </div>
            <button onClick={() => switchMode('signin')}
              className="text-sm text-[#800020] hover:underline">
              Back to sign in
            </button>
          </div>
        );
      }
      return (
        <div>
          <div className="mb-7">
            <h1 className="text-2xl font-serif font-bold text-gray-900 tracking-tight">Reset your password</h1>
            <p className="text-gray-500 text-sm font-light mt-1">
              Enter your email and we'll send you a reset link.
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" className="mt-1.5 h-11 border-gray-200 text-gray-900"
                onKeyDown={e => e.key === 'Enter' && !forgotLoading && handleForgotSubmit()} />
            </div>
            {forgotError && <p className="text-sm text-red-500">{forgotError}</p>}
            <Button onClick={handleForgotSubmit} disabled={!email.trim() || forgotLoading}
              className="w-full h-11 bg-[#800020] hover:bg-[#6b001b] text-white font-medium text-sm !mt-6">
              {forgotLoading ? "Sending..." : "Send reset link"}
            </Button>
            <button onClick={() => switchMode('signin')}
              className="w-full text-center text-sm text-gray-400 hover:text-gray-600 mt-2">
              Back to sign in
            </button>
          </div>
        </div>
      );
    }

    // ── Reset password ───────────────────────────────────────────────────────
    if (mode === 'reset') {
      if (resetDone) {
        return (
          <div className="space-y-6">
            <div className="mb-7">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-serif font-bold text-gray-900 tracking-tight">Password updated!</h1>
              <p className="text-gray-500 text-sm font-light mt-1">Your password has been set. You can now sign in.</p>
            </div>
            <Button onClick={() => switchMode('signin')}
              className="w-full h-11 bg-[#800020] hover:bg-[#6b001b] text-white font-medium text-sm">
              Sign in
            </Button>
          </div>
        );
      }
      return (
        <div>
          <div className="mb-7">
            <h1 className="text-2xl font-serif font-bold text-gray-900 tracking-tight">Set a new password</h1>
            <p className="text-gray-500 text-sm font-light mt-1">Choose a new password for your account.</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">New Password</Label>
              <div className="relative mt-1.5">
                <Input type={showNewPassword ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  placeholder="••••••••" className="h-11 border-gray-200 text-gray-900 pr-10" />
                <button type="button" onClick={() => setShowNewPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <PasswordRequirements password={newPassword} />
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Confirm Password</Label>
              <div className="relative mt-1.5">
                <Input type={showConfirmNewPassword ? "text" : "password"} value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)}
                  placeholder="••••••••" className="h-11 border-gray-200 text-gray-900 pr-10"
                  onKeyDown={e => e.key === 'Enter' && !resetLoading && handleResetSubmit()} />
                <button type="button" onClick={() => setShowConfirmNewPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showConfirmNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {resetError && <p className="text-sm text-red-500">{resetError}</p>}
            <Button onClick={handleResetSubmit} disabled={!newPassword || !confirmNewPassword || resetLoading}
              className="w-full h-11 bg-[#800020] hover:bg-[#6b001b] text-white font-medium text-sm !mt-6">
              {resetLoading ? "Saving..." : "Set new password"}
            </Button>
          </div>
        </div>
      );
    }

    // ── Email verification ───────────────────────────────────────────────────
    if (mode === 'verify') {
      if (verifyDone) {
        return (
          <div className="space-y-6">
            <div className="mb-7">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-serif font-bold text-gray-900 tracking-tight">Email verified!</h1>
              <p className="text-gray-500 text-sm font-light mt-1">Your email address has been confirmed.</p>
            </div>
            <Button onClick={() => navigate(createPageUrl('Lookup'), { replace: true })}
              className="w-full h-11 bg-[#800020] hover:bg-[#6b001b] text-white font-medium text-sm">
              Continue to app
            </Button>
          </div>
        );
      }
      return (
        <div>
          <div className="mb-7">
            <h1 className="text-2xl font-serif font-bold text-gray-900 tracking-tight">Verify your email</h1>
            <p className="text-gray-500 text-sm font-light mt-1">
              We sent a 6-character code to <strong>{pendingEmail || email || "your email address"}</strong>. Enter it below.
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Verification Code</Label>
              <Input value={verifyCode} onChange={e => setVerifyCode(e.target.value.toUpperCase())}
                placeholder="A1B2C3" maxLength={6}
                className="mt-1.5 h-11 border-gray-200 text-gray-900 font-mono text-center text-lg tracking-widest"
                onKeyDown={e => e.key === 'Enter' && !verifyLoading && handleVerifySubmit()} />
            </div>
            {verifyError && <p className="text-sm text-red-500">{verifyError}</p>}
            <Button onClick={handleVerifySubmit} disabled={verifyCode.length < 6 || verifyLoading}
              className="w-full h-11 bg-[#800020] hover:bg-[#6b001b] text-white font-medium text-sm !mt-6">
              {verifyLoading ? "Verifying..." : "Verify email"}
            </Button>
            <div className="flex items-center justify-between pt-1">
              <button onClick={handleResendVerify} disabled={resendLoading}
                className="text-sm text-[#800020] hover:underline disabled:opacity-50">
                {resendLoading ? "Sending..." : resendSent ? "Code resent!" : "Resend code"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── Sign in / Sign up ────────────────────────────────────────────────────
    return (
      <>
        {/* Tab switcher */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
          {["signin", "signup"].map((tab) => (
            <button key={tab} onClick={() => switchMode(tab)}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all ${
                mode === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}>
              {tab === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <h1 className="text-xl font-serif font-bold text-gray-900 tracking-tight">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-gray-500 text-sm font-light mt-0.5">
            {mode === "signin"
              ? "Sign in to your Burgundy Bid account"
              : "Start looking up wine prices in minutes"}
          </p>
        </div>

        <div className="space-y-2.5">
          {mode === "signup" && (
            <div>
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Full Name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith" className="mt-1 h-9 border-gray-200 text-gray-900 text-sm" />
            </div>
          )}

          <div>
            <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" className="mt-1 h-9 border-gray-200 text-gray-900 text-sm" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Password</Label>
              {mode === "signin" && (
                <button onClick={() => { setForgotSent(false); setForgotError(""); switchMode('forgot'); }}
                  className="text-xs text-[#800020] hover:underline">
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative">
              <Input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" className="h-9 border-gray-200 text-gray-900 pr-10 text-sm" />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {mode === "signup" && <PasswordRequirements password={password} />}
          </div>

          {mode === "signup" && (
            <div>
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Confirm Password</Label>
              <div className="relative mt-1">
                <Input type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••" className="h-9 border-gray-200 text-gray-900 pr-10 text-sm" />
                <button type="button" onClick={() => setShowConfirmPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {unverifiedEmail && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 leading-relaxed">
              <p className="font-medium mb-1">Please verify your email before signing in.</p>
              <p className="font-light">We've sent a fresh verification code to <strong>{email}</strong>. Check your inbox (and spam folder), then{" "}
                <button type="button" onClick={() => { setUnverifiedEmail(false); setSigninError(""); setVerifyCode(""); setVerifyDone(false); setVerifyError(""); setResendSent(false); switchMode('verify'); }}
                  className="underline font-medium hover:text-amber-900">
                  enter the code here
                </button>.
              </p>
            </div>
          )}

          {signinError && !unverifiedEmail && (
            <p className="text-sm text-red-500">
              {signinError}
              {mode === 'signup' && signinError.includes('already exists') && (
                <> <button type="button" onClick={() => switchMode('signin')}
                  className="underline font-medium hover:text-red-700">Sign in</button></>
              )}
            </p>
          )}

          <Button onClick={async () => {
            setSigninError("");
            setUnverifiedEmail(false);
            try {
              if (!API_BASE) {
                setSigninError('Backend API not configured. Set VITE_API_BASE_URL in your .env and restart the dev server.');
                return;
              }
              if (mode === 'signup') {
                const emailErr = validateEmail(email);
                if (emailErr) { setSigninError(emailErr); return; }
              }
              if (mode === 'signup' && password !== confirmPassword) {
                setSigninError('Passwords do not match.');
                return;
              }
              if (mode === 'signup' && !checkPassword(password).valid) {
                setSigninError('Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.');
                return;
              }
              const url = `${API_BASE}/auth/${mode === 'signin' ? 'signin' : 'signup'}`;
              const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: fullName, email, password }) });
              const json = await res.json();
              if (!res.ok) {
                if (mode === 'signin' && json?.email_not_verified) {
                  setPendingEmail(email);
                  setUnverifiedEmail(true);
                  return;
                }
                if (mode === 'signin' && res.status === 423) {
                  setSigninError(json?.error || 'Account temporarily locked due to too many failed attempts. Please try again later or contact support.');
                  return;
                }
                if (mode === 'signup' && res.status === 410) {
                  setSigninError(json?.error || 'This email address belongs to a deleted account and cannot be reused.');
                  return;
                }
                if (mode === 'signup' && res.status === 409) {
                  setSigninError('An account with that email already exists. Sign in instead?');
                  return;
                }
                setSigninError(json?.error || 'Something went wrong. Please try again.');
                return;
              }
              if (mode === 'signup' && json.verification_required) {
                // Email verification required — don't issue JWT yet
                setPendingEmail(json.email || email);
                setVerifyCode("");
                setVerifyDone(false);
                setVerifyError("");
                setResendSent(false);
                switchMode('verify');
              } else {
                // Signed in successfully
                localStorage.setItem('app_current_user', JSON.stringify(json.user));
                localStorage.setItem('app_access_token', json.token);
                if (json.refreshToken) localStorage.setItem('app_refresh_token', json.refreshToken);
                try { await refreshAuthFromLocal(); } catch (e) { console.warn('refreshAuthFromLocal failed', e); }
                navigate(createPageUrl('Lookup'), { replace: true });
              }
            } catch (err) {
              console.error(err);
              setSigninError('Something went wrong. Please try again.');
            }
          }} className="w-full h-9 bg-[#800020] hover:bg-[#6b001b] text-white font-medium text-sm !mt-3">
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>

          <div className="relative my-0.5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-white text-xs text-gray-400">or</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => { window.location.href = `${API_BASE}/auth/google`; }}
            className="w-full h-9 flex items-center justify-center gap-3 border border-gray-200 rounded-md bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          By continuing, you agree to our{" "}
          <a href="/TermsOfService" className="underline hover:text-gray-600 transition-colors">Terms of Service</a> and{" "}
          <a href="/PrivacyPolicy"  className="underline hover:text-gray-600 transition-colors">Privacy Policy</a>.
        </p>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');
        .font-serif { font-family: 'Playfair Display', Georgia, serif; }
      `}</style>

      {/* Header */}
      <nav className="bg-white border-b border-gray-100">
        <div className="px-6 lg:px-12 xl:px-16">
          <div className="flex items-center justify-between h-14">
            <div>
              <Link to={'/'} aria-label="Go to Home" className="flex items-center gap-2.5">
                <img src="/logo.png" alt="Burgundy Bid" className="w-6 h-6 object-contain" />
                <span className="font-serif text-lg font-bold text-gray-900 tracking-tight">Burgundy Bid</span>
              </Link>
            </div>
            <div className="flex items-center gap-3">{/** no auth buttons on this page */}</div>
          </div>
        </div>
      </nav>

      <div className="flex w-full min-h-[calc(100vh-56px)]">
        {/* Left panel — branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-gray-900 relative overflow-hidden flex-col justify-between p-10">
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage: `url('https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900&auto=format&fit=crop')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-gray-900/60 via-gray-900/50 to-gray-900/90" />

          {/* Quote */}
          <div className="relative z-10 mt-auto" style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.6s ease' }}>
            <p className="text-white/80 text-xl font-light leading-relaxed font-serif italic mb-4">
              "{WINE_QUOTES[quoteIndex].quote}"
            </p>
            <p className="text-white/50 text-sm">— {WINE_QUOTES[quoteIndex].author}</p>
          </div>
        </div>

        {/* Right panel — form */}
        <div className="flex-1 flex items-start lg:items-center justify-center px-6 py-8 lg:py-10">
          <div className="w-full max-w-md">

            {/* Mobile logo */}
            <div className="lg:hidden mb-6 text-center">
              <span className="font-serif text-2xl font-bold text-gray-900 tracking-tight">
                Burgundy Bid
              </span>
            </div>

            {renderForm()}
          </div>
        </div>
      </div>
    </div>
  );
}
