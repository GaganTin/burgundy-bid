import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { client } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { User, Trash2, Lock, Moon, Sun, ChevronDown, ChevronUp, BarChart2, Save, ArrowUpCircle, Settings, HeadphonesIcon, Lightbulb, Plus, CheckCircle2, CreditCard, Receipt, ExternalLink, ShieldCheck, ImageIcon, Calendar, RefreshCw, XCircle, AlertTriangle, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import SubscriptionPlans from "@/components/SubscriptionPlans";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PASSWORD_RULES, checkPassword } from "@/utils";

function CollapsibleCard({ title, icon, description, defaultOpen = true, borderClass = "", titleClass = "", children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className={`border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm ${borderClass}`}>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className={`text-lg font-semibold dark:text-white flex items-center gap-2 ${titleClass}`}>
            {icon}
            {title}
          </CardTitle>
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}

const TICKET_CATEGORIES = ['general', 'billing', 'bug', 'account', 'data', 'other'];
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const FEEDBACK_CATEGORIES = ['feature', 'improvement', 'removal', 'design', 'performance', 'other'];

const STATUS_BADGE = {
  open:        { label: 'Open',        cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  in_progress: { label: 'In Progress', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  resolved:    { label: 'Resolved',    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  closed:      { label: 'Closed',      cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  submitted:   { label: 'Submitted',   cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  reviewing:   { label: 'Reviewing',   cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  planned:     { label: 'Planned',     cls: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  implemented: { label: 'Implemented', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  declined:    { label: 'Declined',    cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  done:        { label: 'Done',        cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

function StatusBadge({ status }) {
  const s = STATUS_BADGE[status] || { label: status, cls: 'bg-gray-100 text-gray-500' };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

function ContactSupport() {
  const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const token = () => localStorage.getItem('app_access_token');

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [replyText, setReplyText] = useState({});
  const [sendingReply, setSendingReply] = useState({});

  const fetchTickets = () => {
    fetch(`${API}/support/tickets`, { headers: { Authorization: `Bearer ${token()}` } })
      .then(r => r.json()).then(setTickets).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchTickets(); }, []);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) { setError('Title and description are required.'); return; }
    setSubmitting(true); setError(''); setSuccess('');
    try {
      const res = await fetch(`${API}/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ title, category, priority, description }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error || 'Failed to submit ticket.'); return; }
      setSuccess('Ticket submitted! We\'ll get back to you within 24 hours.');
      setTitle(''); setCategory('general'); setPriority('normal'); setDescription('');
      setShowForm(false);
      fetchTickets();
    } catch { setError('Something went wrong. Please try again.'); }
    finally { setSubmitting(false); }
  };

  const handleClose = async (id) => {
    await fetch(`${API}/support/tickets/${id}/close`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token()}` },
    });
    fetchTickets();
  };

  const handleReply = async (ticketId) => {
    const body = (replyText[ticketId] || '').trim();
    if (!body) return;
    setSendingReply(p => ({ ...p, [ticketId]: true }));
    try {
      const res = await fetch(`${API}/support/tickets/${ticketId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setReplyText(p => ({ ...p, [ticketId]: '' }));
        fetchTickets();
      }
    } finally {
      setSendingReply(p => ({ ...p, [ticketId]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {success && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      {!showForm ? (
        <Button onClick={() => { setShowForm(true); setSuccess(''); setError(''); }}
          className="bg-[#800020] hover:bg-[#6b001b] text-white gap-2 h-9">
          <Plus className="w-3.5 h-3.5" /> New Ticket
        </Button>
      ) : (
        <div className="space-y-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">New Support Ticket</h4>
          <div>
            <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Brief summary of your issue"
              className="mt-1.5 h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Category</Label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="mt-1.5 w-full h-10 rounded-md border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 px-3 text-sm bg-white">
                {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Priority</Label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="mt-1.5 w-full h-10 rounded-md border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 px-3 text-sm bg-white">
                {TICKET_PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Describe your issue in detail..."
              className="mt-1.5 border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 min-h-[100px]" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={submitting}
              className="bg-[#800020] hover:bg-[#6b001b] text-white h-9 text-sm">
              {submitting ? 'Submitting...' : 'Submit Ticket'}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setError(''); }}
              className="h-9 text-sm border-gray-200">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading tickets...</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-gray-400">No support tickets yet.</p>
      ) : (
        <div className="space-y-3">
          {tickets.map(t => (
            <div key={t.id} className="border border-gray-100 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden">
              {/* Header */}
              <div className="px-4 pt-4 pb-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t.title}</p>
                    <span className="text-xs text-gray-400 font-mono">#{t.id.slice(0,8).toUpperCase()}</span>
                  </div>
                  <StatusBadge status={t.status} />
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  {t.category} · {t.priority} priority · {new Date(t.created_date).toLocaleDateString()}
                </p>
                {/* Original description as the first message */}
                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2.5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Your message</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{t.description}</p>
                </div>
              </div>

              {/* Reply thread */}
              {t.replies && t.replies.length > 0 && (
                <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-2.5">
                  {t.replies.map(r => (
                    <div key={r.id} className={`rounded-lg px-3 py-2.5 ${
                      r.author_type === 'admin'
                        ? 'bg-[#800020]/5 dark:bg-[#800020]/10 border border-[#800020]/10 dark:border-[#800020]/20'
                        : 'bg-gray-50 dark:bg-gray-900/50'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <p className={`text-xs font-medium ${r.author_type === 'admin' ? 'text-[#800020] dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                          {r.author_type === 'admin' ? `Support` : 'You'}
                        </p>
                        <p className="text-xs text-gray-400">{new Date(r.created_date).toLocaleDateString()}</p>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{r.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply input + close */}
              <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3">
                {t.status !== 'closed' ? (
                  <div className="space-y-2">
                    <textarea
                      value={replyText[t.id] || ''}
                      onChange={e => setReplyText(p => ({ ...p, [t.id]: e.target.value }))}
                      placeholder="Write a reply…"
                      rows={2}
                      className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 resize-none focus:outline-none focus:ring-1 focus:ring-[#800020]"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleReply(t.id)}
                        disabled={!replyText[t.id]?.trim() || sendingReply[t.id]}
                        className="text-xs px-3 py-1.5 rounded-lg bg-[#800020] text-white hover:bg-[#6b001b] disabled:opacity-40 transition-colors">
                        {sendingReply[t.id] ? 'Sending…' : 'Send Reply'}
                      </button>
                      <button onClick={() => handleClose(t.id)}
                        className="text-xs text-gray-400 hover:text-gray-600 underline ml-auto">
                        Close ticket
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">This ticket is closed.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackBox() {
  const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const token = () => localStorage.getItem('app_access_token');

  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('feature');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchSuggestions = () => {
    fetch(`${API}/suggestions`, { headers: { Authorization: `Bearer ${token()}` } })
      .then(r => r.json()).then(setSuggestions).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchSuggestions(); }, []);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) { setError('Title and description are required.'); return; }
    setSubmitting(true); setError(''); setSuccess('');
    try {
      const res = await fetch(`${API}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ title, category, description }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error || 'Failed to submit.'); return; }
      setSuccess('Thanks for your idea! We review all feedback carefully.');
      setTitle(''); setCategory('feature'); setDescription('');
      setShowForm(false);
      fetchSuggestions();
    } catch { setError('Something went wrong. Please try again.'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      {success && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      {!showForm ? (
        <Button onClick={() => { setShowForm(true); setSuccess(''); setError(''); }}
          className="bg-[#800020] hover:bg-[#6b001b] text-white gap-2 h-9">
          <Plus className="w-3.5 h-3.5" /> Share an Idea
        </Button>
      ) : (
        <div className="space-y-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Share Your Thoughts</h4>
          <div>
            <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="What would you like to see?"
              className="mt-1.5 h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Category</Label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="mt-1.5 w-full h-10 rounded-md border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 px-3 text-sm bg-white">
              {FEEDBACK_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Tell us more about your idea and why it would be useful..."
              className="mt-1.5 border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 min-h-[100px]" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={submitting}
              className="bg-[#800020] hover:bg-[#6b001b] text-white h-9 text-sm">
              {submitting ? 'Submitting...' : 'Submit Idea'}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setError(''); }}
              className="h-9 text-sm border-gray-200">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-gray-400">No feedback submitted yet. Be the first to share!</p>
      ) : (
        <div className="space-y-3">
          {suggestions.map(s => (
            <div key={s.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{s.title}</p>
                <StatusBadge status={s.status} />
              </div>
              <p className="text-xs text-gray-400 mb-2">
                {s.category} · {new Date(s.created_date).toLocaleDateString()}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{s.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Profile() {
  const [user, setUser] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [usage, setUsage] = useState(null);
  const [ocrUsage, setOcrUsage] = useState(null);
  const [subscriptionMessage, setSubscriptionMessage] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  const loadUser = () => client.auth.me().then(u => {
    setUser(u);
    const displayName = u?.full_name || (u?.email ? u.email.split("@")[0] : "");
    setEditName(displayName);
    setEditPhone(u?.phone || "");
    setDarkMode(u?.preferred_theme === 'dark');
    if (u?.preferred_theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }).catch(() => {});

  const loadUsage = () => {
    const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
    const token = localStorage.getItem("app_access_token");
    if (!token) return;
    fetch(`${API}/subscription/usage`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setUsage).catch(() => {});
    fetch(`${API}/subscription/ocr-usage`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setOcrUsage).catch(() => {});
  };

  useEffect(() => {
    loadUser();
    loadUsage();
  }, []);

  // Handle Stripe checkout success/cancel redirect
  useEffect(() => {
    const status = searchParams.get("subscription");
    const sessionId = searchParams.get("session_id");
    if (status === "success" && sessionId) {
      const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
      const token = localStorage.getItem("app_access_token");
      fetch(`${API}/stripe/verify-session?session_id=${sessionId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            setSubscriptionMessage(`Subscription activated! Welcome to the ${data.plan} plan.`);
            loadUser();
            loadUsage();
          }
        }).catch(() => {});
      // Clean up URL params
      setSearchParams({}, { replace: true });
    } else if (status === "cancelled") {
      setSubscriptionMessage("Subscription checkout was cancelled.");
      setSearchParams({}, { replace: true });
    }
  }, []);

  // Usage stats from server (authoritative)
  const monthlyCount = usage?.used ?? 0;
  const MONTHLY_LIMIT = usage?.limit ?? 20;
  const monthlyPct = MONTHLY_LIMIT > 0 ? Math.min((monthlyCount / MONTHLY_LIMIT) * 100, 100) : 0;

  // Derive subscription plan from user data
  const userPlan = (user?.subscription_plan || "free").toLowerCase().replace(/_(monthly|annually|annual|yearly)$/, "");
  const isUpgradable = userPlan === "free" || userPlan === "basic";

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setProfileMessage("");
    try {
      await client.auth.updateMe({ full_name: editName, phone: editPhone });
      setProfileMessage("Profile updated successfully");
      // Refresh user so the name in header card updates too
      const updated = await client.auth.me();
      setUser(updated);
      setEditName(updated?.full_name || (updated?.email ? updated.email.split("@")[0] : ""));
      setEditPhone(updated?.phone || "");
      // Notify layout to refresh user display
      window.dispatchEvent(new Event("bb_profile_updated"));
    } catch (err) {
      setProfileMessage("Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const navigate = useNavigate();
  const { logout } = useAuth();

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) { setPasswordMessage("Passwords do not match"); return; }
    if (!checkPassword(newPassword).valid) { setPasswordMessage("Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character."); return; }
    setChangingPassword(true);
    setPasswordMessage("");
    try {
      await client.auth.changePassword(currentPassword, newPassword);
      setPasswordMessage("Password changed successfully");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err) {
      setPasswordMessage(err?.message || String(err));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE") return;
    setDeleteError("");
    try {
      const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
      const token = localStorage.getItem("app_access_token");
      const res = await fetch(`${API}/auth/me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete account");
      }
      // Clear React auth state AND localStorage together so no stale isAuthenticated=true
      // remains in context after navigate, which would auto-redirect the user back to Lookup.
      logout(false);
      navigate('/');
    } catch (err) {
      setDeleteError(err?.message || String(err));
    }
  };

  const toggleDarkMode = (enabled) => {
    setDarkMode(enabled);
    // persist to DB (preferred_theme) and apply immediately
    client.auth.updateMe({ preferred_theme: enabled ? 'dark' : 'light' }).then(() => {
      document.documentElement.classList.toggle("dark", enabled);
    }).catch((e) => {
      console.error('Failed to update theme', e);
      // fallback: still apply locally
      document.documentElement.classList.toggle("dark", enabled);
    });
  };

  const validTabs = ['overview', 'billing', 'settings', 'contact'];
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    return validTabs.includes(t) ? t : 'overview';
  });
  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [subDetails, setSubDetails] = useState(null);
  const [subDetailsLoading, setSubDetailsLoading] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [billingMessage, setBillingMessage] = useState('');

  const loadInvoices = () => {
    const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
    const token = localStorage.getItem('app_access_token');
    if (!token) return;
    setInvoicesLoading(true);
    fetch(`${API}/invoices`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setInvoices).catch(() => {}).finally(() => setInvoicesLoading(false));
  };

  const loadSubDetails = () => {
    const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
    const token = localStorage.getItem('app_access_token');
    if (!token) return;
    setSubDetailsLoading(true);
    fetch(`${API}/subscription/details`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setSubDetails).catch(() => {}).finally(() => setSubDetailsLoading(false));
  };

  const handleCancelSubscription = async () => {
    const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
    const token = localStorage.getItem('app_access_token');
    setCancelling(true);
    setBillingMessage('');
    try {
      const res = await fetch(`${API}/stripe/cancel-subscription`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel');
      setBillingMessage(`Your subscription will end on ${new Date(data.cancel_at).toLocaleDateString()}.`);
      setCancelConfirmOpen(false);
      loadSubDetails();
    } catch (e) {
      setBillingMessage(e.message || 'Failed to cancel subscription.');
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'billing') { loadInvoices(); loadSubDetails(); }
  }, [activeTab]);

  const TABS = [
    { id: 'overview',  label: 'Overview',              short: 'Overview' },
    { id: 'billing',   label: 'Billing & Subscription', short: 'Billing' },
    { id: 'settings',  label: 'Account Settings',       short: 'Settings' },
    { id: 'contact',   label: 'Contact Us',              short: 'Contact' },
  ];

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-black">
      <div className="px-4 sm:px-6 lg:px-12 xl:px-16 py-6 sm:py-10 lg:py-12">
        <div className="mb-6 sm:mb-10">
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-gray-900 dark:text-white tracking-tight">Profile</h1>
          <p className="hidden sm:block text-gray-500 dark:text-gray-400 text-base font-light mt-1">Manage your account, subscription, and preferences</p>
        </div>

        {subscriptionMessage && (
          <Alert className={`mb-6 ${subscriptionMessage.includes("activated") ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20" : "border-amber-300 bg-amber-50 dark:bg-amber-900/20"}`}>
            <AlertDescription className={subscriptionMessage.includes("activated") ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
              {subscriptionMessage}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column — always visible */}
          <div className="lg:col-span-1 space-y-6">
            {/* User Info + Edit */}
            <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#800020]/10 flex items-center justify-center">
                    <User className="w-6 h-6 text-[#800020]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg font-semibold dark:text-white">{user?.full_name || (user?.email ? user.email.split("@")[0] : "User")}</CardTitle>
                      {user?.role_type === 'admin' && (
                        <Badge className="bg-[#800020] text-white text-[10px] flex items-center gap-1 px-1.5 py-0.5">
                          <ShieldCheck className="w-3 h-3" /> Admin
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-sm mt-0.5">{user?.email}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Full Name</Label>
                    <Input value={editName} onChange={e => setEditName(e.target.value)}
                      className="mt-1.5 h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Phone Number</Label>
                    <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+1 234 567 8900"
                      className="mt-1.5 h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
                  </div>
                  {profileMessage && (
                    <p className={`text-xs ${profileMessage.includes("success") ? "text-emerald-600" : "text-red-500"}`}>{profileMessage}</p>
                  )}
                  <Button onClick={handleSaveProfile} disabled={savingProfile}
                    className="w-full bg-[#800020] hover:bg-[#6b001b] text-white gap-2 h-9">
                    <Save className="w-3.5 h-3.5" /> {savingProfile ? "Saving..." : "Save Profile"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Appearance */}
            <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg font-semibold dark:text-white flex items-center gap-2">
                  {darkMode ? <Moon className="w-5 h-5 text-[#800020]" /> : <Sun className="w-5 h-5 text-[#800020]" />}
                  Appearance
                </CardTitle>
                <CardDescription>Choose your preferred theme</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Dark Mode</p>
                    <p className="text-xs text-gray-400 mt-0.5">Use dark theme across the app</p>
                  </div>
                  <Switch checked={darkMode} onCheckedChange={toggleDarkMode} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column — tabbed */}
          <div className="lg:col-span-2">
            {/* Tab bar — flex-1 with short labels on mobile, full labels on sm+ */}
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6 gap-1">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex-1 py-2 px-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                    activeTab === t.id
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}>
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>

            {/* ── Overview tab ─────────────────────────────────────────────── */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Current Usage card */}
                <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg font-semibold dark:text-white flex items-center gap-2">
                          <BarChart2 className="w-5 h-5 text-[#800020]" />
                          Current Usage
                        </CardTitle>
                        <CardDescription>Your monthly usage this billing period</CardDescription>
                      </div>
                      {isUpgradable ? (
                        <Button size="sm" className="bg-[#800020] hover:bg-[#6b001b] text-white gap-1.5"
                          onClick={() => setActiveTab('billing')}>
                          <ArrowUpCircle className="w-3.5 h-3.5" /> Upgrade Plan
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="gap-1.5 border-gray-200 dark:border-gray-700 dark:text-gray-300"
                          onClick={() => setActiveTab('billing')}>
                          <Settings className="w-3.5 h-3.5" /> Manage Subscription
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {/* Wine Lookups */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                          <BarChart2 className="w-4 h-4 text-[#800020]" /> Lookup Usage
                          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold uppercase">{(usage?.plan || userPlan).replace(/_(monthly|annually|annual|yearly)$/i, '')}</span>
                          {usage?.bonus_lookup_credits > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700 font-semibold border border-amber-200">+{usage.bonus_lookup_credits} bonus</span>
                          )}
                        </p>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 tabular-nums">{monthlyCount} <span className="font-normal text-gray-400 text-xs">/ {MONTHLY_LIMIT}</span></p>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5">
                        <div className={`h-2.5 rounded-full transition-all duration-500 ${monthlyPct >= 90 ? "bg-red-500" : monthlyPct >= 70 ? "bg-amber-500" : "bg-[#800020]"}`}
                          style={{ width: `${monthlyPct}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {usage?.credits_expired
                          ? <span className="text-red-500">Credits expired. Upgrade to continue.</span>
                          : monthlyCount >= MONTHLY_LIMIT
                            ? <span className="text-red-500">Limit reached. Upgrade to continue.</span>
                            : `${Math.max(0, MONTHLY_LIMIT - monthlyCount)} lookups remaining`}
                      </p>
                    </div>
                    {/* AI Image Search */}
                    {ocrUsage && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                            <ImageIcon className="w-4 h-4 text-[#800020]" /> AI Image Search
                            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold uppercase">{(ocrUsage.plan || 'free').replace(/_(monthly|annually|annual|yearly)$/i, '')}</span>
                            {ocrUsage.bonus_ocr_credits > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700 font-semibold border border-amber-200">+{ocrUsage.bonus_ocr_credits} bonus</span>
                            )}
                          </p>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 tabular-nums">{ocrUsage.used} <span className="font-normal text-gray-400 text-xs">/ {ocrUsage.limit === 99999 ? '∞' : ocrUsage.limit}</span></p>
                        </div>
                        {ocrUsage.limit < 99999 ? (
                          <>
                            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5">
                              <div className={`h-2.5 rounded-full transition-all duration-500 ${(ocrUsage.used / ocrUsage.limit) >= 0.9 ? "bg-red-500" : (ocrUsage.used / ocrUsage.limit) >= 0.7 ? "bg-amber-500" : "bg-[#800020]"}`}
                                style={{ width: `${Math.min((ocrUsage.used / ocrUsage.limit) * 100, 100)}%` }} />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                              {ocrUsage.credits_expired
                                ? <span className="text-red-500">Credits expired. Upgrade to continue.</span>
                                : ocrUsage.remaining === 0
                                  ? <span className="text-red-500">No credits remaining. Upgrade to continue using AI Image Search.</span>
                                  : `${ocrUsage.remaining} credits remaining`}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-gray-400">Unlimited credits</p>
                        )}
                      </div>
                    )}
                    {/* Credits expiry warning */}
                    {usage?.credits_expiry_date && (() => {
                      const days = usage.days_until_expiry;
                      if (usage.credits_expired) {
                        return (
                          <div className="flex items-start gap-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3.5 py-3">
                            <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-red-700 dark:text-red-400">Credits expired</p>
                              <p className="text-xs text-red-500 dark:text-red-500 mt-0.5">Your free credits expired on {new Date(usage.credits_expiry_date).toLocaleDateString()}. <button className="underline font-medium" onClick={() => setActiveTab('billing')}>Upgrade</button> to continue using Burgundy Bid.</p>
                            </div>
                          </div>
                        );
                      }
                      if (days !== null && days <= 7) {
                        return (
                          <div className="flex items-start gap-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3.5 py-3">
                            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-red-700 dark:text-red-400">Credits expire in {days <= 0 ? 'less than a day' : `${days} day${days === 1 ? '' : 's'}`}</p>
                              <p className="text-xs text-red-500 dark:text-red-500 mt-0.5">Your credits expire on {new Date(usage.credits_expiry_date).toLocaleDateString()}. <button className="underline font-medium" onClick={() => setActiveTab('billing')}>Upgrade</button> to keep access.</p>
                            </div>
                          </div>
                        );
                      }
                      if (days !== null && days <= 30) {
                        return (
                          <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3.5 py-3">
                            <Calendar className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Credits expire in {days} day{days === 1 ? '' : 's'}</p>
                              <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">Use your credits before {new Date(usage.credits_expiry_date).toLocaleDateString()} or <button className="underline font-medium" onClick={() => setActiveTab('billing')}>upgrade</button> to continue.</p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </CardContent>
                </Card>

                {/* Current plan summary */}
                {(() => {
                  const planDetails = {
                    free:  { label: "Free",  color: "text-gray-500" },
                    basic: { label: "Basic", color: "text-blue-600" },
                    pro:   { label: "Pro",   color: "text-[#800020]" },
                    admin: { label: "Admin", color: "text-[#800020]" },
                  };
                  const plan = planDetails[userPlan] || planDetails.free;
                  const planLookupLimit = MONTHLY_LIMIT === 9999 || MONTHLY_LIMIT >= 99999 ? "Unlimited" : MONTHLY_LIMIT.toLocaleString();
                  return (
                    <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
                      <CardContent className="pt-5 pb-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-[#800020]" />
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">Current Plan</span>
                            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${userPlan === "pro" || userPlan === "admin" ? "bg-[#800020]/10 text-[#800020]" : userPlan === "basic" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"}`}>
                              {plan.label}
                            </span>
                          </div>
                          {isUpgradable && (
                            <button onClick={() => setActiveTab('billing')} className="text-xs text-[#800020] hover:underline font-medium">
                              Upgrade →
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                            <p className="text-xs text-gray-400 mb-0.5">Wine Lookups</p>
                            <p className={`text-lg font-bold ${plan.color}`}>{planLookupLimit}<span className="text-xs font-normal text-gray-400 ml-1">/ month</span></p>
                            {(usage?.bonus_lookup_credits > 0) && (
                              <p className="text-xs text-amber-600 font-medium mt-0.5">+{usage.bonus_lookup_credits} bonus credits</p>
                            )}
                          </div>
                          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                            <p className="text-xs text-gray-400 mb-0.5">AI Image Search</p>
                            <p className={`text-lg font-bold ${plan.color}`}>
                              {ocrUsage
                                ? (ocrUsage.limit === 99999
                                  ? "Unlimited"
                                  : (ocrUsage.limit - (ocrUsage.bonus_ocr_credits || 0)).toLocaleString())
                                : "—"}
                              <span className="text-xs font-normal text-gray-400 ml-1">credits / month</span>
                            </p>
                            {(ocrUsage?.bonus_ocr_credits > 0) && (
                              <p className="text-xs text-amber-600 font-medium mt-0.5">+{ocrUsage.bonus_ocr_credits} bonus credits</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Subscription plans (all plans)
                <div id="subscription-plans-overview">
                  <CollapsibleCard title="Subscription Plans" icon={<CreditCard className="w-5 h-5 text-[#800020]" />}
                    description="Choose the plan that works best for you" defaultOpen={false}>
                    <SubscriptionPlans hideHeader currentPlan={userPlan} />
                  </CollapsibleCard>
                </div> */}
              </div>
            )}

            {/* ── Billing & Subscription tab ────────────────────────────────── */}
            {activeTab === 'billing' && (
              <div className="space-y-6">
                {billingMessage && (
                  <div className={`rounded-lg px-4 py-3 text-sm ${billingMessage.includes('end on') ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'}`}>
                    {billingMessage}
                  </div>
                )}

                {/* 1 — Subscription Plans */}
                <div id="subscription-plans">
                  <CollapsibleCard title="Subscription Plans" icon={<CreditCard className="w-5 h-5 text-[#800020]" />}
                    description="Choose the plan that works best for you" defaultOpen={true}>
                    <SubscriptionPlans
                      hideHeader
                      currentPlan={user?.subscription_plan || "free"}
                      subDetails={subDetails}
                      onUpgradeSuccess={(newPlan) => {
                        loadUser();
                        loadSubDetails();
                        setBillingMessage(`Plan upgraded to ${newPlan.replace(/_/g, ' ')}! Your new plan is active.`);
                      }}
                    />
                  </CollapsibleCard>
                </div>

                {/* 2 — Current Subscription */}
                <CollapsibleCard title="Current Subscription" icon={<RefreshCw className="w-5 h-5 text-[#800020]" />}
                  description="Your active plan and renewal information" defaultOpen={true}>
                  {subDetailsLoading ? (
                    <p className="text-sm text-gray-400">Loading subscription details…</p>
                  ) : (() => {
                    const plan = subDetails?.plan || user?.subscription_plan || 'free';
                    const isFree = plan === 'free';
                    const interval = subDetails?.interval || (plan.endsWith('_annually') ? 'annually' : isFree ? 'none' : 'monthly');
                    const planLabel = plan.replace(/_monthly|_annually/g, '').replace(/^\w/, c => c.toUpperCase());
                    const renewalDate = subDetails?.renewal_date;
                    const cancelAtEnd = subDetails?.cancel_at_period_end;
                    const recurring = (isFree || cancelAtEnd) ? 'None' : interval === 'annually' ? 'Yearly' : 'Monthly';
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Plan</p>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{planLabel}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Billing</p>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 capitalize">
                            {(isFree || cancelAtEnd) ? '—' : interval === 'annually' ? 'Annually' : 'Monthly'}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Recurring</p>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{recurring}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                            {cancelAtEnd ? 'Access Until' : 'Auto-renews On'}
                          </p>
                          {renewalDate ? (
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-gray-400" />
                              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                                {new Date(renewalDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">{isFree ? '—' : 'Not available'}</p>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </CollapsibleCard>

                {/* 3 — Payment Method */}
                <CollapsibleCard title="Payment" icon={<Wallet className="w-5 h-5 text-[#800020]" />}
                  description="Your saved payment method" defaultOpen={true}>
                  {subDetailsLoading ? (
                    <p className="text-sm text-gray-400">Loading…</p>
                  ) : subDetails?.payment_method ? (
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-7 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                          <CreditCard className="w-4 h-4 text-gray-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-100 capitalize">
                            {subDetails.payment_method.brand} ···· {subDetails.payment_method.last4}
                          </p>
                          <p className="text-xs text-gray-400">
                            Expires {subDetails.payment_method.exp_month}/{subDetails.payment_method.exp_year}
                          </p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="text-xs border-gray-200 dark:border-gray-700 dark:text-gray-300 shrink-0"
                        onClick={async () => {
                          const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
                          const token = localStorage.getItem('app_access_token');
                          try {
                            const r = await fetch(`${API}/stripe/billing-portal`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                            const d = await r.json();
                            if (d.url) window.location.href = d.url;
                          } catch (e) { setBillingMessage('Could not open billing portal.'); }
                        }}>
                        Manage
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <Wallet className="w-7 h-7 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No payment method on file.</p>
                      <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">A card will be saved when you subscribe to a paid plan.</p>
                    </div>
                  )}
                </CollapsibleCard>

                {/* 4 — Cancellation */}
                {(subDetails?.plan && subDetails.plan !== 'free') && (
                  <CollapsibleCard title="Cancellation" icon={<XCircle className="w-5 h-5 text-[#800020]" />}
                    description="Cancel your current subscription" defaultOpen={false}
                    borderClass="border-red-100 dark:border-red-900/40">
                    {subDetails?.cancel_at_period_end ? (
                      <div className="space-y-3">
                        <p className="text-sm text-amber-600 dark:text-amber-400">
                          Your subscription has been cancelled. Your credits will remain active until{' '}
                          <strong>{
                            (subDetails.credits_expiry_date || subDetails.renewal_date)
                              ? new Date(subDetails.credits_expiry_date || subDetails.renewal_date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
                              : '—'
                          }</strong>.
                        </p>
                      </div>
                    ) : cancelConfirmOpen ? (
                      <div className="space-y-4">
                        <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>
                            Your subscription will remain active until{' '}
                            <strong>{subDetails?.renewal_date ? new Date(subDetails.renewal_date).toLocaleDateString() : 'the end of your billing period'}</strong>,
                            then revert to the free plan.
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleCancelSubscription} disabled={cancelling}
                            className="bg-red-600 hover:bg-red-700 text-white text-xs h-8">
                            {cancelling ? 'Cancelling…' : 'Confirm Cancellation'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setCancelConfirmOpen(false)}
                            className="text-xs h-8 border-gray-200 dark:border-gray-700">
                            Keep Subscription
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          Cancelling will keep your plan active until the end of the current billing period.
                          You won't be charged again after that.
                        </p>
                        <Button size="sm" variant="outline" onClick={() => setCancelConfirmOpen(true)}
                          className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 text-xs h-8">
                          Cancel Plan
                        </Button>
                      </div>
                    )}
                  </CollapsibleCard>
                )}

                {/* 5 — Payment History */}
                <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg font-semibold dark:text-white flex items-center gap-2">
                      <Receipt className="w-5 h-5 text-[#800020]" />
                      Payment History
                    </CardTitle>
                    <CardDescription>All invoices and payments for your account</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {invoicesLoading ? (
                      <p className="text-sm text-gray-400">Loading invoices…</p>
                    ) : invoices.length === 0 ? (
                      <div className="text-center py-8">
                        <Receipt className="w-8 h-8 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">No payment history yet.</p>
                        <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Invoices will appear here once you subscribe to a paid plan.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 dark:border-gray-800">
                              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide pb-3">Date</th>
                              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide pb-3">Description</th>
                              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide pb-3">Recurring</th>
                              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide pb-3">Amount</th>
                              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide pb-3">Status</th>
                              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide pb-3">Reference</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                            {invoices.map(inv => {
                              const recurringLabel = inv.billing_interval === 'annual' ? 'Yearly'
                                : inv.billing_interval === 'monthly' ? 'Monthly' : 'None';
                              return (
                                <tr key={inv.id}>
                                  <td className="py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                    {new Date(inv.date).toLocaleDateString()}
                                  </td>
                                  <td className="py-3 text-gray-700 dark:text-gray-200">{inv.description}</td>
                                  <td className="py-3 text-sm text-gray-600 dark:text-gray-300">
                                    {recurringLabel}
                                  </td>
                                  <td className="py-3 text-gray-700 dark:text-gray-200 tabular-nums font-medium">
                                    {inv.currency?.toUpperCase()} {Number(inv.amount).toFixed(2)}
                                  </td>
                                  <td className="py-3 text-sm text-gray-600 dark:text-gray-300 capitalize">
                                    {inv.status}
                                  </td>
                                  <td className="py-3">
                                    {inv.invoice_url ? (
                                      <a href={inv.invoice_url} target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-xs text-[#800020] hover:underline">
                                        View <ExternalLink className="w-3 h-3" />
                                      </a>
                                    ) : (
                                      <span className="text-xs text-gray-400 font-mono truncate max-w-[120px] block">
                                        {inv.reference ? String(inv.reference).slice(0, 16) + '…' : '—'}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Account Settings tab ─────────────────────────────────────── */}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                {!user?.google_id && <CollapsibleCard title="Change Password" icon={<Lock className="w-5 h-5 text-[#800020]" />}
                  description="Update your account password" defaultOpen={false}>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Current Password</Label>
                      <Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                        className="mt-1.5 h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">New Password</Label>
                      <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                        className="mt-1.5 h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
                      {newPassword && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                          {PASSWORD_RULES.map(r => {
                            const met = r.test(newPassword);
                            return (
                              <span key={r.id} className={`flex items-center gap-1 text-xs transition-colors ${met ? 'text-emerald-600' : 'text-gray-400'}`}>
                                <span className={`inline-block w-1.5 h-1.5 rounded-full ${met ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                {r.label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Confirm New Password</Label>
                      <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                        className="mt-1.5 h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
                    </div>
                    {passwordMessage && (
                      <Alert className="bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                        <AlertDescription className="text-sm text-gray-600 dark:text-gray-400">{passwordMessage}</AlertDescription>
                      </Alert>
                    )}
                    <Button onClick={handlePasswordChange} disabled={!currentPassword || !newPassword || !confirmPassword || changingPassword}
                      className="bg-[#800020] hover:bg-[#6b001b] text-white">
                      {changingPassword ? "Changing..." : "Change Password"}
                    </Button>
                  </div>
                </CollapsibleCard>}

                {/* Delete Account */}
                <Card className="border-red-200 dark:border-red-900 dark:bg-gray-900 shadow-sm">
                  <CardHeader className="cursor-pointer select-none" onClick={() => setDeleteOpen(o => !o)}>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg font-semibold text-red-600 flex items-center gap-2">
                        <Trash2 className="w-5 h-5" />
                        Delete Account
                      </CardTitle>
                      {deleteOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                    <CardDescription>Permanently delete your account and all data</CardDescription>
                  </CardHeader>
                  {deleteOpen && (
                    <CardContent>
                      <div className="space-y-4">
                        <Alert className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
                          <AlertDescription className="text-sm text-red-800 dark:text-red-400">
                            This action is irreversible. All your wine lookups, credentials, and account data will be permanently deleted.
                          </AlertDescription>
                        </Alert>
                        <div>
                          <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Type "DELETE" to confirm</Label>
                          <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="DELETE"
                            className="mt-1.5 h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
                        </div>
                        {deleteError && (
                          <p className="text-sm text-red-500">{deleteError}</p>
                        )}
                        <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleteConfirm !== "DELETE"}
                          className="bg-red-600 hover:bg-red-700 gap-2">
                          <Trash2 className="w-4 h-4" /> Delete Account
                        </Button>
                      </div>
                    </CardContent>
                  )}
                </Card>
              </div>
            )}

            {/* ── Contact Us tab ───────────────────────────────────────────── */}
            {activeTab === 'contact' && (
              <div className="space-y-6">
                <CollapsibleCard title="Contact Support" icon={<HeadphonesIcon className="w-5 h-5 text-[#800020]" />}
                  description="Submit a support ticket and we'll get back to you within 24 hours"
                  defaultOpen={true}>
                  <ContactSupport />
                </CollapsibleCard>

                <CollapsibleCard title="Share Your Thoughts" icon={<Lightbulb className="w-5 h-5 text-[#800020]" />}
                  description="Share ideas to improve Burgundy Bid, we read every submission"
                  defaultOpen={true}>
                  <FeedbackBox />
                </CollapsibleCard>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}