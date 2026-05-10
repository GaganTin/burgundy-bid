import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  HeadphonesIcon, Lightbulb, Mail, ChevronDown, ChevronUp,
  RefreshCw, Shield, Search, Filter, AlertCircle, WifiOff,
  ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, BarChart2,
  Users, Lock, Unlock, AlertTriangle, TrendingUp, DollarSign,
  Gift, Settings2, X, Check, Edit2, BellRing, CheckCircle2,
  Activity, Database, ScanLine, Globe, KeyRound, ShieldAlert,
} from "lucide-react";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const API = (import.meta.env && import.meta.env.VITE_API_BASE_URL) || "http://localhost:3001";
const token = () => localStorage.getItem("app_access_token");
const H = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });

// ── Status options ────────────────────────────────────────────────────────────
const TICKET_STATUSES     = ["open", "in_progress", "resolved", "closed"];
const SUGGESTION_STATUSES = ["submitted", "reviewing", "planned", "implemented", "declined", "done"];
const CONTACT_STATUSES    = ["new", "read", "replied", "archived"];
const TICKET_PRIORITIES   = ["low", "normal", "high", "urgent"];

const STATUS_STYLE = {
  open:        "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  resolved:    "bg-emerald-100 text-emerald-700",
  closed:      "bg-gray-100 text-gray-500",
  submitted:   "bg-blue-100 text-blue-700",
  reviewing:   "bg-amber-100 text-amber-700",
  planned:     "bg-purple-100 text-purple-700",
  implemented: "bg-emerald-100 text-emerald-700",
  declined:    "bg-gray-100 text-gray-500",
  new:         "bg-blue-100 text-blue-700",
  read:        "bg-gray-100 text-gray-600",
  replied:     "bg-emerald-100 text-emerald-700",
  archived:    "bg-gray-100 text-gray-400",
  connected:   "bg-emerald-100 text-emerald-700",
  error:       "bg-red-100 text-red-700",
  pending:     "bg-amber-100 text-amber-700",
  done:        "bg-emerald-100 text-emerald-700",
  failed:      "bg-red-100 text-red-700",
  deleted:     "bg-gray-100 text-gray-500",
};

const PRIORITY_STYLE = {
  low:    "bg-gray-100 text-gray-500",
  normal: "bg-blue-50 text-blue-600",
  high:   "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

function StatusBadge({ status }) {
  const cls = STATUS_STYLE[status] || "bg-gray-100 text-gray-500";
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{status?.replace(/_/g, " ")}</span>;
}
function PriorityBadge({ priority }) {
  const cls = PRIORITY_STYLE[priority] || "bg-gray-100 text-gray-500";
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{priority}</span>;
}

// ── Generic select with immediate save ───────────────────────────────────────
function StatusSelect({ value, options, onSave }) {
  const [val, setVal] = useState(value);
  const [saving, setSaving] = useState(false);
  const handleChange = async (e) => {
    const next = e.target.value;
    setVal(next);
    setSaving(true);
    await onSave(next);
    setSaving(false);
  };
  return (
    <select value={val} onChange={handleChange} disabled={saving}
      className={`text-xs font-medium px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 cursor-pointer ${saving ? "opacity-50" : ""}`}>
      {options.map(o => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
    </select>
  );
}

// ── Ticket row ────────────────────────────────────────────────────────────────
function TicketRow({ ticket, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [replies, setReplies] = useState(ticket.replies || []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Keep local replies in sync if ticket prop updates
  useEffect(() => { setReplies(ticket.replies || []); }, [ticket.replies]);

  const ticketNum = ticket.id?.slice(0, 8).toUpperCase();

  const saveReply = async () => {
    if (!reply.trim()) return;
    setSaving(true);
    const updated = await onUpdate(ticket.id, { admin_reply: reply });
    if (updated?.replies) setReplies(updated.replies);
    setReply("");
    setSaving(false);
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm("Soft-delete this ticket? It will be hidden from users but visible to admins.")) return;
    setDeleting(true);
    await onDelete(ticket.id);
    setDeleting(false);
  };

  return (
    <div className={`border rounded-xl overflow-hidden ${ticket.is_deleted ? "border-red-200 dark:border-red-900/40 opacity-60" : "border-gray-100 dark:border-gray-700"}`}>
      <div className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => setOpen(o => !o)}>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">#{ticketNum}</span>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{ticket.title}</p>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {replies.length > 0 && (
              <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">{replies.length} repl{replies.length === 1 ? "y" : "ies"}</span>
            )}
            {ticket.is_deleted && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">deleted</span>}
          </div>
          <p className="text-xs text-gray-400">
            {ticket.user_name || ticket.user_email || "Unknown user"} · {ticket.category} · {new Date(ticket.created_date).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!ticket.is_deleted && (
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
              title="Soft-delete">
              {deleting ? "…" : "Delete"}
            </button>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 bg-white dark:bg-gray-900 border-t border-gray-50 dark:border-gray-800 space-y-4">
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Description</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{ticket.description}</p>
          </div>

          <div className="flex flex-wrap gap-4 items-center">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Status</p>
              <StatusSelect value={ticket.status} options={TICKET_STATUSES}
                onSave={(s) => onUpdate(ticket.id, { status: s })} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Priority</p>
              <StatusSelect value={ticket.priority} options={TICKET_PRIORITIES}
                onSave={(p) => onUpdate(ticket.id, { priority: p })} />
            </div>
          </div>

          {/* Reply history */}
          {replies.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Reply History</p>
              <div className="space-y-2">
                {replies.map(r => (
                  <div key={r.id} className={`rounded-lg px-3 py-2 text-sm ${r.author_type === "admin" ? "bg-[#800020]/5 border border-[#800020]/10" : "bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700"}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs font-semibold ${r.author_type === "admin" ? "text-[#800020]" : "text-gray-700 dark:text-gray-300"}`}>
                        {r.author_name || (r.author_type === "admin" ? "Admin" : "User")}
                      </span>
                      <span className="text-xs text-gray-400">{new Date(r.created_date).toLocaleString()}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${r.author_type === "admin" ? "bg-[#800020]/10 text-[#800020]" : "bg-gray-200 dark:bg-gray-700 text-gray-500"}`}>
                        {r.author_type}
                      </span>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{r.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New admin reply — hidden for closed tickets */}
          {ticket.status !== 'closed' ? (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">New Admin Reply</p>
              <Textarea value={reply} onChange={e => setReply(e.target.value)}
                placeholder="Write a reply to the user..."
                className="text-sm border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 min-h-[80px]" />
              <Button onClick={saveReply} disabled={saving || !reply.trim()}
                className="mt-2 bg-[#800020] hover:bg-[#6b001b] text-white h-8 text-xs px-4">
                {saving ? "Sending..." : "Send Reply"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">Ticket is closed — replies are disabled.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Suggestion row ────────────────────────────────────────────────────────────
function SuggestionRow({ suggestion, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm("Soft-delete this feedback?")) return;
    setDeleting(true); await onDelete(suggestion.id); setDeleting(false);
  };
  return (
    <div className={`border rounded-xl overflow-hidden ${suggestion.is_deleted ? "border-red-200 dark:border-red-900/40 opacity-60" : "border-gray-100 dark:border-gray-700"}`}>
      <div className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => setOpen(o => !o)}>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{suggestion.title}</p>
            <StatusBadge status={suggestion.status} />
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{suggestion.category}</span>
            {suggestion.is_deleted && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">deleted</span>}
          </div>
          <p className="text-xs text-gray-400">
            {suggestion.user_name || suggestion.user_email || "Unknown user"} · {new Date(suggestion.created_date).toLocaleDateString()}
            {suggestion.is_deleted && suggestion.deleted_date && (
              <span className="ml-1 text-red-400">· deleted {new Date(suggestion.deleted_date).toLocaleDateString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!suggestion.is_deleted && (
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors">{deleting ? "…" : "Delete"}</button>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 bg-white dark:bg-gray-900 border-t border-gray-50 dark:border-gray-800 space-y-3">
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{suggestion.description}</p>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Status</p>
            <StatusSelect value={suggestion.status} options={SUGGESTION_STATUSES}
              onSave={(s) => onUpdate(suggestion.id, { status: s })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Contact row ───────────────────────────────────────────────────────────────
function ContactRow({ submission, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm("Soft-delete this message?")) return;
    setDeleting(true); await onDelete(submission.id); setDeleting(false);
  };
  return (
    <div className={`border rounded-xl overflow-hidden ${submission.is_deleted ? "border-red-200 dark:border-red-900/40 opacity-60" : "border-gray-100 dark:border-gray-700"}`}>
      <div className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => setOpen(o => !o)}>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{submission.subject}</p>
            <StatusBadge status={submission.status} />
            {submission.is_deleted && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">deleted</span>}
          </div>
          <p className="text-xs text-gray-400">
            {submission.name} &lt;{submission.email}&gt; · {new Date(submission.created_date).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!submission.is_deleted && (
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors">{deleting ? "…" : "Delete"}</button>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 bg-white dark:bg-gray-900 border-t border-gray-50 dark:border-gray-800 space-y-3">
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-gray-400">From:</span> <span className="text-gray-700 dark:text-gray-300">{submission.name}</span></div>
            <div><span className="text-gray-400">Email:</span> <a href={`mailto:${submission.email}`} className="text-[#800020] hover:underline">{submission.email}</a></div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Message</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{submission.message}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Status</p>
            <StatusSelect value={submission.status} options={CONTACT_STATUSES}
              onSave={(s) => onUpdate(submission.id, { status: s })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Draggable status group order ─────────────────────────────────────────────
function useGroupOrder(initial) {
  const [order, setOrder] = useState(initial);
  const moveUp   = (i) => setOrder(o => { const n=[...o]; if(i>0){[n[i-1],n[i]]=[n[i],n[i-1]];} return n; });
  const moveDown = (i) => setOrder(o => { const n=[...o]; if(i<n.length-1){[n[i],n[i+1]]=[n[i+1],n[i]];} return n; });
  return [order, moveUp, moveDown];
}

// ── Section with search + filter + group-by-status (tickets/suggestions/contacts) ─
function Section({ items, statusOptions, renderRow, emptyText, storageKey = "" }) {
  const [filter, setFilter]     = useState("all");
  const [search, setSearch]     = useState("");
  const [groupBy, setGroupBy]   = useState(() => storageKey ? localStorage.getItem(storageKey) === "1" : false);
  const [groupOrder, moveUp, moveDown] = useGroupOrder(statusOptions);

  const toggleGroupBy = () => setGroupBy(g => {
    const next = !g;
    if (storageKey) localStorage.setItem(storageKey, next ? "1" : "0");
    return next;
  });

  const filtered = items.filter(item => {
    const matchStatus = filter === "all" || item.status === filter;
    const matchSearch = !search || JSON.stringify(item).toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#800020]/30" />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="h-8 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-2">
            <option value="all">All statuses</option>
            {statusOptions.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <button onClick={toggleGroupBy}
          className={`h-8 px-3 text-xs rounded-lg border transition-colors ${groupBy ? "border-[#800020]/40 bg-[#800020]/5 text-[#800020]" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 bg-white dark:bg-gray-800"}`}>
          Group by status
        </button>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} item{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Group order controls */}
      {groupBy && (
        <div className="flex flex-wrap gap-2 items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700">
          <span className="text-xs text-gray-400 mr-1">Status order:</span>
          {groupOrder.map((s, i) => (
            <div key={s} className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1">
              <span className="text-xs text-gray-600 dark:text-gray-300">{s.replace(/_/g, " ")}</span>
              <button onClick={() => moveUp(i)}   className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none" disabled={i===0}>▲</button>
              <button onClick={() => moveDown(i)} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none" disabled={i===groupOrder.length-1}>▼</button>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">{search || filter !== "all" ? "No matches found." : emptyText}</div>
      ) : groupBy ? (
        <div className="space-y-5">
          {groupOrder.map(status => {
            const group = filtered.filter(i => i.status === status);
            if (group.length === 0) return null;
            return (
              <div key={status}>
                <div className="flex items-center gap-2 mb-2">
                  <StatusBadge status={status} />
                  <span className="text-xs text-gray-400">{group.length} item{group.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="space-y-2">{group.map(item => renderRow(item))}</div>
              </div>
            );
          })}
          {/* Items with status not in statusOptions */}
          {filtered.filter(i => !groupOrder.includes(i.status)).map(item => renderRow(item))}
        </div>
      ) : (
        <div className="space-y-2">{filtered.map(item => renderRow(item))}</div>
      )}
    </div>
  );
}

// ── Connection error row ──────────────────────────────────────────────────────
function ConnectionErrorRow({ row }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-red-100 dark:border-red-900/40 rounded-xl overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 cursor-pointer hover:bg-red-50/40 dark:hover:bg-red-900/10"
        onClick={() => setOpen(o => !o)}>
        <WifiOff className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{row.site_name}</span>
            <StatusBadge status={row.status} />
            {row.is_error && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">is_error=true</span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate">
            <span className="font-medium text-gray-700 dark:text-gray-300">{row.full_name || "Unknown"}</span>
            {" · "}<span className="font-mono text-gray-400">{row.user_id?.slice(0, 8)}…</span>
            {" · "}Updated {new Date(row.updated_date).toLocaleString()}
          </p>
          {row.error_message && (
            <p className="text-xs text-red-500 mt-0.5 truncate">{row.error_message}</p>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />}
      </div>

      {open && (
        <div className="px-4 pb-4 bg-white dark:bg-gray-900 border-t border-red-50 dark:border-red-900/20 space-y-3 mt-0">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-xs">
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">User</p>
              <p className="text-gray-800 dark:text-gray-200 font-medium">{row.full_name || "—"}</p>
              <p className="text-gray-400">{row.email}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">User ID</p>
              <p className="font-mono text-gray-600 dark:text-gray-400 break-all">{row.user_id}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Site</p>
              <p className="text-gray-800 dark:text-gray-200 font-medium">{row.site_name}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Status</p>
              <StatusBadge status={row.status} />
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">is_error flag</p>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${row.is_error ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>
                {String(row.is_error)}
              </span>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Last Connected</p>
              <p className="text-gray-600 dark:text-gray-400">{row.last_connected ? new Date(row.last_connected).toLocaleString() : "Never"}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Created</p>
              <p className="text-gray-600 dark:text-gray-400">{new Date(row.created_date).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Updated</p>
              <p className="text-gray-600 dark:text-gray-400">{new Date(row.updated_date).toLocaleString()}</p>
            </div>
          </div>
          {row.error_message && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Error Message</p>
              <pre className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 whitespace-pre-wrap break-all border border-red-100 dark:border-red-800/30">
                {row.error_message}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Lookup error row ──────────────────────────────────────────────────────────
function LookupErrorRow({ row }) {
  const [open, setOpen] = useState(false);
  const hasCtErr = !!row.ct_error;
  const hasWsErr = !!row.ws_error;

  return (
    <div className="border border-amber-100 dark:border-amber-900/40 rounded-xl overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 cursor-pointer hover:bg-amber-50/40 dark:hover:bg-amber-900/10"
        onClick={() => setOpen(o => !o)}>
        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
              {row.wine_name}{row.vintage ? ` · ${row.vintage}` : ""}
            </span>
            <StatusBadge status={row.status} />
            {hasCtErr && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">CT error</span>}
            {hasWsErr && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">WS error</span>}
          </div>
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-700 dark:text-gray-300">{row.full_name || "Unknown"}</span>
            {" · "}<span className="font-mono text-gray-400">{row.user_id?.slice(0, 8)}…</span>
            {" · "}Updated {new Date(row.updated_date).toLocaleString()}
          </p>
          {(hasCtErr || hasWsErr) && (
            <p className="text-xs text-amber-600 mt-0.5 truncate">
              {hasCtErr ? `CT: ${row.ct_error}` : ""}
              {hasCtErr && hasWsErr ? " | " : ""}
              {hasWsErr ? `WS: ${row.ws_error}` : ""}
            </p>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />}
      </div>

      {open && (
        <div className="px-4 pb-4 bg-white dark:bg-gray-900 border-t border-amber-50 dark:border-amber-900/20 space-y-3 mt-0">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-xs">
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">User</p>
              <p className="text-gray-800 dark:text-gray-200 font-medium">{row.full_name || "—"}</p>
              <p className="text-gray-400">{row.email}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">User ID</p>
              <p className="font-mono text-gray-600 dark:text-gray-400 break-all">{row.user_id}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Wine</p>
              <p className="text-gray-800 dark:text-gray-200">{row.wine_name}</p>
              {row.vintage && <p className="text-gray-400">Vintage: {row.vintage}</p>}
              {row.size && <p className="text-gray-400">Size: {row.size}</p>}
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Status</p>
              <StatusBadge status={row.status} />
            </div>
            {row.batch_id && (
              <div>
                <p className="text-gray-400 uppercase tracking-wide mb-0.5">Batch ID</p>
                <p className="font-mono text-gray-500 text-xs break-all">{row.batch_id}</p>
              </div>
            )}
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Updated</p>
              <p className="text-gray-600 dark:text-gray-400">{new Date(row.updated_date).toLocaleString()}</p>
            </div>
          </div>

          {hasCtErr && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Cellar Tracker Error</p>
                {row.ct_url && (
                  <a href={row.ct_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-[#800020] hover:underline flex items-center gap-0.5">
                    <ExternalLink className="w-3 h-3" /> View CT
                  </a>
                )}
              </div>
              <pre className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 whitespace-pre-wrap break-all border border-red-100 dark:border-red-800/30">
                {row.ct_error}
              </pre>
            </div>
          )}

          {hasWsErr && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Wine Searcher Error</p>
                {row.ws_url && (
                  <a href={row.ws_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-[#800020] hover:underline flex items-center gap-0.5">
                    <ExternalLink className="w-3 h-3" /> View WS
                  </a>
                )}
              </div>
              <pre className="text-xs text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3 whitespace-pre-wrap break-all border border-orange-100 dark:border-orange-800/30">
                {row.ws_error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SecurityErrorRow({ row }) {
  const [open, setOpen] = useState(false);
  const d = row.activity_details || {};
  const site = d.site ? d.site.replace(/_/g, " ") : "unknown site";
  const message = d.message || "Account mismatch detected";

  return (
    <div className="border border-red-200 dark:border-red-800/40 rounded-xl overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 cursor-pointer hover:bg-red-50/40 dark:hover:bg-red-900/10"
        onClick={() => setOpen(o => !o)}>
        <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-red-700 dark:text-red-400 truncate">{message}</span>
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium capitalize">{site}</span>
          </div>
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-700 dark:text-gray-300">{row.full_name || "Unknown"}</span>
            {" · "}<span className="text-gray-400">{row.email}</span>
            {" · "}{new Date(row.created_date).toLocaleString()}
          </p>
          {d.expected && d.actual && (
            <p className="text-xs text-red-600 mt-0.5">
              Expected <strong>{d.expected}</strong>, got <strong>{d.actual}</strong>
            </p>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />}
      </div>

      {open && (
        <div className="px-4 pb-4 bg-white dark:bg-gray-900 border-t border-red-50 dark:border-red-900/20 space-y-3 mt-0">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-xs">
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">User</p>
              <p className="text-gray-800 dark:text-gray-200 font-medium">{row.full_name || "—"}</p>
              <p className="text-gray-400">{row.email}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">User ID</p>
              <p className="font-mono text-gray-600 dark:text-gray-400 break-all">{row.user_id}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Site</p>
              <p className="text-gray-800 dark:text-gray-200 capitalize">{site}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Expected Account</p>
              <p className="text-gray-800 dark:text-gray-200 font-medium">{d.expected || "—"}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Actual Account</p>
              <p className="text-red-700 dark:text-red-400 font-medium">{d.actual || "—"}</p>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide mb-0.5">Detected At</p>
              <p className="text-gray-600 dark:text-gray-400">{new Date(row.created_date).toLocaleString()}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Raw Details</p>
            <pre className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 whitespace-pre-wrap break-all border border-red-100 dark:border-red-800/30">
              {JSON.stringify(d, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sort control ──────────────────────────────────────────────────────────────
function SortButton({ label, field, sortField, sortDir, onSort }) {
  const active = sortField === field;
  return (
    <button onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${
        active
          ? "border-[#800020]/40 bg-[#800020]/5 text-[#800020]"
          : "border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 bg-white dark:bg-gray-800"
      }`}>
      {label}
      {active
        ? sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        : <ArrowUpDown className="w-3 h-3 opacity-50" />}
    </button>
  );
}

const CAPTCHA_KEYWORDS = ["blocked", "captcha", "bot", "perimeterx", "px"];
function isCaptchaError(r) {
  const text = [r.error_message, r.ct_error, r.ws_error].filter(Boolean).join(" ").toLowerCase();
  return CAPTCHA_KEYWORDS.some(k => text.includes(k));
}

// ── Error Tracking tab ────────────────────────────────────────────────────────
function ErrorTrackingTab({ connErrors, lookupErrors, securityErrors = [], loading, onRefresh }) {
  const [sub, setSub] = useState("connections");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("updated_date");
  const [sortDir, setSortDir] = useState("desc");
  const [range, setRange] = useState("all");

  // Fetch when range changes
  useEffect(() => { onRefresh(range); }, [range]);

  // Reset filters when switching sub-tab
  const switchSub = (s) => { setSub(s); setSearch(""); setStatusFilter("all"); setSortField(s === "security" ? "created_date" : "updated_date"); setSortDir("desc"); };

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const allErrors = [...connErrors, ...lookupErrors];
  const captchaErrors = allErrors.filter(isCaptchaError);
  const rows = sub === "connections" ? connErrors : sub === "lookups" ? lookupErrors : sub === "security" ? securityErrors : captchaErrors;

  // Unique statuses for filter dropdown
  const allStatuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort();

  const searchLower = search.toLowerCase();
  const filtered = rows
    .filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!search) return true;
      const secDetails = sub === "security" ? JSON.stringify(r.activity_details || {}) : "";
      const haystack = [
        r.error_message, r.ct_error, r.ws_error,
        r.full_name, r.email, r.user_id,
        r.site_name, r.wine_name, r.vintage, r.status, r.batch_id,
        secDetails,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(searchLower);
    })
    .sort((a, b) => {
      let av = a[sortField] ?? "";
      let bv = b[sortField] ?? "";
      if (sortField === "updated_date" || sortField === "created_date") {
        av = new Date(av).getTime() || 0;
        bv = new Date(bv).getTime() || 0;
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  const connSortFields = [
    { label: "Updated", field: "updated_date" },
    { label: "User", field: "full_name" },
    { label: "Site", field: "site_name" },
    { label: "Status", field: "status" },
  ];
  const lookupSortFields = [
    { label: "Updated", field: "updated_date" },
    { label: "User", field: "full_name" },
    { label: "Wine", field: "wine_name" },
    { label: "Status", field: "status" },
  ];
  const securitySortFields = [
    { label: "Date", field: "created_date" },
    { label: "User", field: "full_name" },
  ];
  const sortFields = sub === "connections" ? connSortFields : sub === "captcha" ? connSortFields : sub === "security" ? securitySortFields : lookupSortFields;

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex overflow-x-auto bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1">
        {[
          { id: "connections", label: "Connection Errors", count: connErrors.length },
          { id: "lookups",     label: "Lookup Errors",    count: lookupErrors.length },
          { id: "captcha",     label: "Captcha Errors",   count: captchaErrors.length },
          { id: "security",    label: "Security Errors",  count: securityErrors.length },
        ].map(s => (
          <button key={s.id} onClick={() => switchSub(s.id)}
            className={`flex-shrink-0 flex items-center gap-2 py-1.5 px-4 rounded-lg text-sm font-medium transition-all ${
              sub === s.id
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}>
            {s.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center font-semibold ${
              s.count > 0 ? "bg-red-100 text-red-700" : "bg-gray-200 text-gray-500"
            }`}>{s.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-7 h-7 border-4 border-gray-200 border-t-[#800020] rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Controls bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={sub === "connections"
                  ? "Search user, site, error message…"
                  : "Search user, wine, CT error, WS error…"}
                className="w-full h-8 pl-8 pr-8 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#800020]/30"
              />
              {search && (
                <button onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm leading-none">✕</button>
              )}
            </div>

            {/* Period filter */}
            <select value={range} onChange={e => setRange(e.target.value)}
              className="h-8 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-2">
              <option value="all">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>

            {/* Status filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-gray-400" />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="h-8 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-2">
                <option value="all">All statuses</option>
                {allStatuses.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </div>

            {/* Sort buttons */}
            <div className="flex items-center gap-1">
              {sortFields.map(sf => (
                <SortButton key={sf.field} label={sf.label} field={sf.field}
                  sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              ))}
            </div>

            <span className="text-xs text-gray-400 ml-auto">
              {filtered.length} of {rows.length} row{rows.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">
              {search || statusFilter !== "all"
                ? "No matches — try adjusting your search or filter."
                : sub === "connections"
                  ? "No connection errors found."
                  : sub === "captcha"
                    ? "No captcha/bot errors found."
                    : sub === "security"
                      ? "No security errors detected. All accounts are using the correct credentials."
                      : "No lookup errors found."}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(r =>
                sub === "security"
                  ? <SecurityErrorRow key={r.id} row={r} />
                  : sub === "connections" || (sub === "captcha" && connErrors.find(c => c.id === r.id))
                    ? <ConnectionErrorRow key={r.id} row={r} />
                    : <LookupErrorRow key={r.id} row={r} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => (n ?? 0).toLocaleString();
const fmtUsd = (n) => `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPeriod = (iso, groupBy) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (groupBy === "year")  return d.getFullYear().toString();
  if (groupBy === "month") return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
  if (groupBy === "week")  return `Wk of ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// ── Analytics Tab ─────────────────────────────────────────────────────────────
function AnalyticsTab({ summary, timeseries, loading, onFetch, users, usersLoading, onFetchUsers, adminId, lockedCount, usageUsers, usageLoading, onFetchUsage }) {
  const [groupBy, setGroupBy] = useState("day");
  const [range, setRange]     = useState("30");
  const [sortField, setSortField] = useState("period");
  const [sortDir, setSortDir]     = useState("desc");
  const [activeSection, setActiveSection] = useState("overview");
  const [userSortField, setUserSortField] = useState("days_on_app");
  const [userSortDir, setUserSortDir]     = useState("desc");
  const [userSearch, setUserSearch]       = useState("");
  const [usageSortField, setUsageSortField] = useState("lookup_total");
  const [usageSortDir, setUsageSortDir]     = useState("desc");
  const [usageSearch, setUsageSearch]       = useState("");

  useEffect(() => { onFetch(groupBy, range); }, [groupBy, range]);
  useEffect(() => { if (activeSection === "users" && users.length === 0) onFetchUsers(); }, [activeSection]);
  useEffect(() => { if (activeSection === "usage" && usageUsers.length === 0) onFetchUsage(); }, [activeSection]);

  const handleSort = (f) => {
    if (sortField === f) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(f); setSortDir("desc"); }
  };
  const handleUserSort = (f) => {
    if (userSortField === f) setUserSortDir(d => d === "asc" ? "desc" : "asc");
    else { setUserSortField(f); setUserSortDir("desc"); }
  };
  const handleUsageSort = (f) => {
    if (usageSortField === f) setUsageSortDir(d => d === "asc" ? "desc" : "asc");
    else { setUsageSortField(f); setUsageSortDir("desc"); }
  };

  const sortedRows = [...(timeseries || [])].sort((a, b) => {
    let av = a[sortField] ?? 0, bv = b[sortField] ?? 0;
    if (sortField === "period") { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const chartData = (timeseries || []).map(r => ({ ...r, label: fmtPeriod(r.period, groupBy) }));

  const filteredUsers = (users || []).filter(u => {
    if (!userSearch) return true;
    const s = userSearch.toLowerCase();
    return (u.email || "").toLowerCase().includes(s) || (u.full_name || "").toLowerCase().includes(s);
  });
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    let av = a[userSortField] ?? 0, bv = b[userSortField] ?? 0;
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return userSortDir === "asc" ? -1 : 1;
    if (av > bv) return userSortDir === "asc" ? 1 : -1;
    return 0;
  });

  const SortTh = ({ field, label }) => {
    const active = sortField === field;
    return (
      <th onClick={() => handleSort(field)}
        className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-200 whitespace-nowrap">
        <span className="flex items-center gap-1">
          {label}
          {active ? sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" /> : <ArrowUpDown className="w-3 h-3 opacity-40" />}
        </span>
      </th>
    );
  };

  // Reusable time range + group-by controls
  const TimeControls = () => (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 gap-0.5">
        {["day","week","month","year"].map(g => (
          <button key={g} onClick={() => setGroupBy(g)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
              groupBy === g ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}>{g}</button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Filter className="w-3.5 h-3.5 text-gray-400" />
        <select value={range} onChange={e => setRange(e.target.value)}
          className="h-8 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-2">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
          <option value="all">All time</option>
        </select>
      </div>
      {loading && <div className="w-4 h-4 border-2 border-gray-200 border-t-[#800020] rounded-full animate-spin ml-1" />}
      <span className="text-xs text-gray-400 ml-auto">{(timeseries||[]).length} periods</span>
    </div>
  );

  // Reusable stat card
  const StatCard = ({ label, value, color = "text-gray-800 dark:text-gray-100", sub }) => (
    <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
      <CardContent className="pt-4 pb-3 px-4">
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-gray-300 dark:text-gray-600 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );

  // Section group header
  const SectionHeader = ({ icon, label, description }) => (
    <div className="flex items-center gap-2 mb-3 mt-1">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">{label}</span>
      </div>
      {description && <span className="text-xs text-gray-400 hidden sm:inline">— {description}</span>}
    </div>
  );

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-7 h-7 border-4 border-gray-200 border-t-[#800020] rounded-full animate-spin" />
      </div>
    );
  }

  // "Actions Needed" alerts — always shown at top
  const alerts = [];
  if (summary) {
    if ((lockedCount || 0) > 0) alerts.push({ color: "red", msg: `${lockedCount} account${lockedCount !== 1 ? "s" : ""} currently locked` });
    if (summary.ct_errors > 50) alerts.push({ color: "red", msg: `High CT error count: ${fmt(summary.ct_errors)} errors` });
    if (summary.ws_errors > 50) alerts.push({ color: "orange", msg: `High WS error count: ${fmt(summary.ws_errors)} errors` });
    if (summary.connection_errors > 20) alerts.push({ color: "red", msg: `${fmt(summary.connection_errors)} users have connection errors` });
    if (summary.cancelled_subscriptions > 0) alerts.push({ color: "amber", msg: `${fmt(summary.cancelled_subscriptions)} cancelled subscription${summary.cancelled_subscriptions !== 1 ? "s" : ""}` });
  }

  const SECTIONS = [
    { id: "overview", label: "Overview",    icon: <BarChart2 className="w-3.5 h-3.5" /> },
    { id: "growth",   label: "Growth",      icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: "revenue",  label: "Revenue",     icon: <DollarSign className="w-3.5 h-3.5" /> },
    { id: "issues",   label: "Issues",      icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    { id: "users",    label: "Users",       icon: <Users className="w-3.5 h-3.5" /> },
    { id: "usage",    label: "User Usage",  icon: <Activity className="w-3.5 h-3.5" /> },
  ];

  const filteredUsageUsers = (usageUsers || []).filter(u => {
    if (!usageSearch) return true;
    const s = usageSearch.toLowerCase();
    return (u.email || "").toLowerCase().includes(s) || (u.full_name || "").toLowerCase().includes(s);
  });
  const sortedUsageUsers = [...filteredUsageUsers].sort((a, b) => {
    let av = a[usageSortField] ?? 0, bv = b[usageSortField] ?? 0;
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return usageSortDir === "asc" ? -1 : 1;
    if (av > bv) return usageSortDir === "asc" ? 1 : -1;
    return 0;
  });

  return (
    <div className="space-y-6">
      {/* Actions needed callout */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Actions Needed
          </p>
          {alerts.map((a, i) => (
            <p key={i} className={`text-xs flex items-center gap-1.5 ${a.color === "red" ? "text-red-700 dark:text-red-400" : a.color === "orange" ? "text-orange-600 dark:text-orange-400" : "text-amber-700 dark:text-amber-400"}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${a.color === "red" ? "bg-red-500" : a.color === "orange" ? "bg-orange-500" : "bg-amber-500"}`} />
              {a.msg}
            </p>
          ))}
        </div>
      )}

      {/* Section tabs */}
      <div className="flex flex-wrap gap-1">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeSection === s.id
                ? "bg-[#800020] text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}>
            {s.icon}{s.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeSection === "overview" && summary && (
        <div className="space-y-6">
          {/* Growth group */}
          <div>
            <SectionHeader icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-500" />} label="Growth" description="user base" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Active Accounts"  value={fmt(summary.active_accounts)}  color="text-emerald-600" />
              <StatCard label="Deleted Accounts" value={fmt(summary.deleted_accounts)} color="text-gray-400" />
              <StatCard label="Total Signups (all time)" value={fmt((summary.active_accounts||0) + (summary.deleted_accounts||0))} color="text-gray-700 dark:text-gray-300" />
              <StatCard label="Locked Now" value={fmt(lockedCount || 0)} color={(lockedCount||0) > 0 ? "text-red-600" : "text-gray-400"} />
            </div>
          </div>

          {/* Subscriptions group */}
          <div>
            <SectionHeader icon={<Users className="w-3.5 h-3.5 text-blue-500" />} label="Subscriptions" description="plan distribution" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard label="Free Plan"     value={fmt(summary.plan_free)}  color="text-gray-500" />
              <StatCard label="Basic Plan"    value={fmt(summary.plan_basic)} color="text-blue-600" />
              <StatCard label="Pro Plan"      value={fmt(summary.plan_pro)}   color="text-purple-600" />
              <StatCard label="Monthly Subs"  value={fmt(summary.monthly_subs)}  color="text-blue-500" />
              <StatCard label="Annual Subs"   value={fmt(summary.annual_subs)}   color="text-purple-600" />
              <StatCard label="Cancelled"     value={fmt(summary.cancelled_subscriptions)} color={summary.cancelled_subscriptions > 0 ? "text-red-500" : "text-gray-400"} />
            </div>
          </div>

          {/* Revenue group */}
          <div>
            <SectionHeader icon={<DollarSign className="w-3.5 h-3.5 text-emerald-600" />} label="Revenue" description="all-time" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total Revenue"   value={fmtUsd(summary.total_payments)}  color="text-emerald-700" />
              <StatCard label="Monthly Revenue" value={fmtUsd(summary.monthly_revenue)} color="text-emerald-600" />
              <StatCard label="Annual Revenue"  value={fmtUsd(summary.annual_revenue)}  color="text-emerald-500" />
              <StatCard label="Total Transactions" value={fmt((summary.monthly_transactions||0) + (summary.annual_transactions||0))} color="text-gray-600 dark:text-gray-300" />
            </div>
          </div>

          {/* Activity & Health group */}
          <div>
            <SectionHeader icon={<AlertCircle className="w-3.5 h-3.5 text-red-500" />} label="Activity & Health" description="errors and usage" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total Lookups"     value={fmt(summary.total_lookups)}      color="text-[#800020]" />
              <StatCard label="CT Lookup Errors"  value={fmt(summary.ct_errors)}          color={summary.ct_errors > 0 ? "text-red-600" : "text-gray-400"} />
              <StatCard label="WS Lookup Errors"  value={fmt(summary.ws_errors)}          color={summary.ws_errors > 0 ? "text-orange-500" : "text-gray-400"} />
              <StatCard label="Connection Errors" value={fmt(summary.connection_errors)}  color={summary.connection_errors > 0 ? "text-red-600" : "text-gray-400"} />
            </div>
          </div>
        </div>
      )}

      {/* ── GROWTH ── */}
      {activeSection === "growth" && (
        <div className="space-y-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">Track user acquisition and account growth over time.</p>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Active Accounts"  value={fmt(summary.active_accounts)}  color="text-emerald-600" />
              <StatCard label="Free Users"       value={fmt(summary.plan_free)}        color="text-gray-500" />
              <StatCard label="Paid Users"       value={fmt((summary.plan_basic||0) + (summary.plan_pro||0))} color="text-blue-600" />
              <StatCard label="Conversion Rate"
                value={summary.active_accounts > 0
                  ? `${Math.round(((summary.plan_basic||0) + (summary.plan_pro||0)) / summary.active_accounts * 100)}%`
                  : "—"}
                color="text-purple-600" />
            </div>
          )}
          <TimeControls />
          <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
            <CardContent className="pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">New Signups Over Time</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip formatter={(v, n) => [fmt(v), n]} />
                    <Area dataKey="signups" name="New Signups" fill="#800020" stroke="#800020" fillOpacity={0.15} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          {/* Data table */}
          <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <SortTh field="period"  label="Period" />
                    <SortTh field="signups" label="New Signups" />
                    <SortTh field="total_lookups" label="Lookups" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortedRows.length === 0 ? (
                    <tr><td colSpan={3} className="text-center py-8 text-sm text-gray-400">No data for selected range.</td></tr>
                  ) : sortedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300">{fmtPeriod(r.period, groupBy)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{fmt(r.signups)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{fmt(r.total_lookups)}</td>
                    </tr>
                  ))}
                </tbody>
                {sortedRows.length > 0 && (
                  <tfoot className="bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
                    <tr>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Totals</td>
                      <td className="px-3 py-2 text-xs font-semibold">{fmt(sortedRows.reduce((s,r)=>s+(r.signups||0),0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold">{fmt(sortedRows.reduce((s,r)=>s+(r.total_lookups||0),0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── REVENUE ── */}
      {activeSection === "revenue" && (
        <div className="space-y-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">Monitor revenue, subscription payments, and financial health.</p>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total Revenue (all time)" value={fmtUsd(summary.total_payments)} color="text-emerald-700" />
              <StatCard label="Monthly Revenue"          value={fmtUsd(summary.monthly_revenue)} color="text-emerald-600" />
              <StatCard label="Annual Revenue"           value={fmtUsd(summary.annual_revenue)}  color="text-emerald-500" />
              <StatCard label="Monthly + Annual Subs"    value={fmt((summary.monthly_subs||0) + (summary.annual_subs||0))} color="text-blue-600" />
            </div>
          )}
          <TimeControls />
          <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
            <CardContent className="pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Revenue Over Time</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                    <Tooltip formatter={(v, n) => [fmtUsd(v), n]} />
                    <Area dataKey="revenue" name="Revenue ($)" fill="#10b981" stroke="#10b981" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <SortTh field="period"       label="Period" />
                    <SortTh field="transactions" label="Payments" />
                    <SortTh field="revenue"      label="Revenue" />
                    <SortTh field="signups"      label="New Users" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortedRows.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-sm text-gray-400">No data for selected range.</td></tr>
                  ) : sortedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300">{fmtPeriod(r.period, groupBy)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{fmt(r.transactions)}</td>
                      <td className="px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">{fmtUsd(r.revenue)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{fmt(r.signups)}</td>
                    </tr>
                  ))}
                </tbody>
                {sortedRows.length > 0 && (
                  <tfoot className="bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
                    <tr>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Totals</td>
                      <td className="px-3 py-2 text-xs font-semibold">{fmt(sortedRows.reduce((s,r)=>s+(r.transactions||0),0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{fmtUsd(sortedRows.reduce((s,r)=>s+(r.revenue||0),0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold">{fmt(sortedRows.reduce((s,r)=>s+(r.signups||0),0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── ISSUES ── */}
      {activeSection === "issues" && (
        <div className="space-y-5">
          <p className="text-sm text-gray-500 dark:text-gray-400">Track errors, failed connections, and system health. Use this to spot problems that need immediate attention.</p>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="CT Lookup Errors"  value={fmt(summary.ct_errors)}          color={summary.ct_errors > 0 ? "text-red-600" : "text-gray-400"} sub={summary.ct_errors > 0 ? "Needs investigation" : "All clear"} />
              <StatCard label="WS Lookup Errors"  value={fmt(summary.ws_errors)}          color={summary.ws_errors > 0 ? "text-orange-500" : "text-gray-400"} sub={summary.ws_errors > 0 ? "Needs investigation" : "All clear"} />
              <StatCard label="Connection Errors" value={fmt(summary.connection_errors)}  color={summary.connection_errors > 0 ? "text-red-600" : "text-gray-400"} sub={summary.connection_errors > 0 ? "Users can't scrape" : "All clear"} />
              <StatCard label="Locked Accounts"   value={fmt(lockedCount || 0)}           color={(lockedCount||0) > 0 ? "text-red-600" : "text-gray-400"} sub={(lockedCount||0) > 0 ? "Review in Users tab" : "None locked"} />
            </div>
          )}
          <TimeControls />
          <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
            <CardContent className="pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Error Trends Over Time</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip formatter={(v, n) => [fmt(v), n]} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="conn_errors" name="Connection Errors" fill="#dc2626" radius={[3,3,0,0]} />
                    <Bar dataKey="ct_errors"   name="CT Errors"         fill="#ef4444" radius={[3,3,0,0]} />
                    <Bar dataKey="ws_errors"   name="WS Errors"         fill="#f97316" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <SortTh field="period"      label="Period" />
                    <SortTh field="ct_errors"   label="CT Errors" />
                    <SortTh field="ws_errors"   label="WS Errors" />
                    <SortTh field="conn_errors" label="Conn. Errors" />
                    <SortTh field="total_lookups" label="Total Lookups" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortedRows.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-sm text-gray-400">No data for selected range.</td></tr>
                  ) : sortedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300">{fmtPeriod(r.period, groupBy)}</td>
                      <td className="px-3 py-2 text-xs">{r.ct_errors > 0 ? <span className="text-red-600 font-medium">{fmt(r.ct_errors)}</span> : <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-3 py-2 text-xs">{r.ws_errors > 0 ? <span className="text-orange-500 font-medium">{fmt(r.ws_errors)}</span> : <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-3 py-2 text-xs">{r.conn_errors > 0 ? <span className="text-red-600 font-medium">{fmt(r.conn_errors)}</span> : <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{fmt(r.total_lookups)}</td>
                    </tr>
                  ))}
                </tbody>
                {sortedRows.length > 0 && (
                  <tfoot className="bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
                    <tr>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Totals</td>
                      <td className="px-3 py-2 text-xs font-semibold text-red-600">{fmt(sortedRows.reduce((s,r)=>s+(r.ct_errors||0),0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-orange-500">{fmt(sortedRows.reduce((s,r)=>s+(r.ws_errors||0),0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-red-600">{fmt(sortedRows.reduce((s,r)=>s+(r.conn_errors||0),0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold">{fmt(sortedRows.reduce((s,r)=>s+(r.total_lookups||0),0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── USERS (per-user analytics) ── */}
      {activeSection === "users" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Detailed per-user metrics: tenure, lookup activity, and total spend.</p>
          <div className="flex items-center gap-3">
            <input
              value={userSearch} onChange={e => setUserSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="h-8 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-3 w-64"
            />
            <button onClick={onFetchUsers} className="h-8 px-3 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Refresh
            </button>
            {usersLoading && <div className="w-4 h-4 border-2 border-gray-200 border-t-[#800020] rounded-full animate-spin" />}
            <span className="text-xs text-gray-400 ml-auto">{sortedUsers.length} users</span>
          </div>
          <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    {[
                      { f: "email",             l: "User" },
                      { f: "subscription_plan", l: "Plan" },
                      { f: "days_on_app",       l: "Tenure" },
                      { f: "last_login",        l: "Last Login" },
                      { f: "lookup_count",      l: "Lookups" },
                      { f: "payment_count",     l: "Payments" },
                      { f: "total_spent",       l: "Spent" },
                    ].map(({ f, l }) => {
                      const active = userSortField === f;
                      return (
                        <th key={f} onClick={() => handleUserSort(f)}
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-200 whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            {l}
                            {active ? userSortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" /> : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortedUsers.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-sm text-gray-400">{usersLoading ? "Loading…" : "No users found."}</td></tr>
                  ) : sortedUsers.map(u => {
                    const tenure = u.days_on_app >= 365
                      ? `${Math.floor(u.days_on_app/365)}y ${Math.floor((u.days_on_app%365)/30)}m`
                      : u.days_on_app >= 30 ? `${Math.floor(u.days_on_app/30)}m ${u.days_on_app%30}d` : `${u.days_on_app}d`;
                    const planBase = (u.subscription_plan || 'free').replace(/_(monthly|annually)$/, '');
                    const planColor = planBase === 'pro' ? 'text-purple-600' : planBase === 'basic' ? 'text-blue-600' : 'text-gray-400';
                    return (
                      <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="px-3 py-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{u.full_name || "—"}</span>
                            {adminId && u.id === adminId && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#800020]/10 text-[#800020] font-semibold">me</span>}
                          </div>
                          <div className="text-gray-400">{u.email}</div>
                        </td>
                        <td className={`px-3 py-2 text-xs font-medium ${planColor}`}>{u.subscription_plan || "free"}</td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 font-mono">{tenure}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{u.last_login ? new Date(u.last_login).toLocaleDateString() : "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{fmt(u.lookup_count)}</td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{fmt(u.payment_count)}</td>
                        <td className="px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">{fmtUsd(u.total_spent)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── USER USAGE ── */}
      {activeSection === "usage" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Per-user consumption metrics — OCR pages, proxy sessions, lookups, credits used, and forgot-password requests. All figures shown as overall total and current-month.</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-gray-400" />
              <input
                value={usageSearch} onChange={e => setUsageSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="h-8 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-3 w-56"
              />
            </div>
            <button onClick={onFetchUsage} className="h-8 px-3 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
            {usageLoading && <div className="w-4 h-4 border-2 border-gray-200 border-t-[#800020] rounded-full animate-spin" />}
            <span className="text-xs text-gray-400 ml-auto">{sortedUsageUsers.length} users</span>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-2.5">
            <span className="flex items-center gap-1.5"><ScanLine className="w-3 h-3 text-purple-500" /> OCR — pages scanned</span>
            <span className="flex items-center gap-1.5"><Globe className="w-3 h-3 text-blue-500" /> Proxy — scrape sessions</span>
            <span className="flex items-center gap-1.5"><Database className="w-3 h-3 text-emerald-500" /> Lookups — credits consumed</span>
            <span className="flex items-center gap-1.5"><KeyRound className="w-3 h-3 text-amber-500" /> Forgot PW — reset emails sent</span>
            <span className="text-gray-400 ml-auto italic">Total / This month</span>
          </div>

          <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">User</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Plan</th>
                    {[
                      { f: "ocr_pages_total",      l: "OCR Pages",       icon: <ScanLine className="w-3 h-3 text-purple-400" /> },
                      { f: "lookup_total",          l: "Lookups / Credits", icon: <Database className="w-3 h-3 text-emerald-400" /> },
                      { f: "proxy_total",           l: "Proxy Sessions",  icon: <Globe className="w-3 h-3 text-blue-400" /> },
                      { f: "forgot_password_total", l: "Forgot PW",       icon: <KeyRound className="w-3 h-3 text-amber-400" /> },
                      { f: "db_rows_total",         l: "DB Rows",         icon: <Database className="w-3 h-3 text-gray-400" /> },
                    ].map(({ f, l, icon }) => {
                      const active = usageSortField === f;
                      return (
                        <th key={f} onClick={() => handleUsageSort(f)}
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-200 whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            {icon}{l}
                            {active ? usageSortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" /> : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortedUsageUsers.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-sm text-gray-400">{usageLoading ? "Loading…" : "No users found."}</td></tr>
                  ) : sortedUsageUsers.map(u => {
                    const planBase = (u.subscription_plan || 'free').replace(/_(monthly|annually)$/, '');
                    const planColor = planBase === 'pro' ? 'text-purple-600' : planBase === 'basic' ? 'text-blue-600' : 'text-gray-400';
                    const TotalMo = ({ total, monthly, totalColor = "text-gray-700 dark:text-gray-300" }) => (
                      <span className="flex flex-col leading-tight">
                        <span className={`font-medium ${total > 0 ? totalColor : "text-gray-300 dark:text-gray-600"}`}>{fmt(total)}</span>
                        <span className="text-[10px] text-gray-400">{monthly > 0 ? `+${fmt(monthly)} mo` : "—"}</span>
                      </span>
                    );
                    return (
                      <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="px-3 py-2 text-xs">
                          <div className="font-medium text-gray-800 dark:text-gray-200">{u.full_name || "—"}</div>
                          <div className="text-gray-400">{u.email}</div>
                        </td>
                        <td className={`px-3 py-2 text-xs font-medium ${planColor}`}>{planBase}</td>
                        <td className="px-3 py-2 text-xs">
                          <TotalMo total={u.ocr_pages_total} monthly={u.ocr_pages_monthly} totalColor="text-purple-600 dark:text-purple-400" />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <TotalMo total={u.lookup_total} monthly={u.lookup_monthly} totalColor="text-emerald-700 dark:text-emerald-400" />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <TotalMo total={u.proxy_total} monthly={u.proxy_monthly} totalColor="text-blue-600 dark:text-blue-400" />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <TotalMo total={u.forgot_password_total} monthly={u.forgot_password_monthly} totalColor={u.forgot_password_total > 3 ? "text-amber-600" : "text-gray-700 dark:text-gray-300"} />
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-500 font-mono">{fmt(u.db_rows_total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {sortedUsageUsers.length > 0 && (
                  <tfoot className="bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Totals ({sortedUsageUsers.length} users)</td>
                      <td className="px-3 py-2 text-xs font-semibold text-purple-600">{fmt(sortedUsageUsers.reduce((s, u) => s + (Number(u.ocr_pages_total) || 0), 0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{fmt(sortedUsageUsers.reduce((s, u) => s + (Number(u.lookup_total) || 0), 0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-blue-600">{fmt(sortedUsageUsers.reduce((s, u) => s + (Number(u.proxy_total) || 0), 0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-amber-600">{fmt(sortedUsageUsers.reduce((s, u) => s + (Number(u.forgot_password_total) || 0), 0))}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-500">{fmt(sortedUsageUsers.reduce((s, u) => s + (Number(u.db_rows_total) || 0), 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Plans Tab ─────────────────────────────────────────────────────────────────
function PlansTab({ users, usersLoading }) {
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [editingPlan, setEditingPlan] = useState(null); // plan_name being edited
  const [editValues, setEditValues] = useState(/** @type {Record<string, any>} */({ monthly_lookup_limit: 0, monthly_ocr_limit: 0, monthly_price_cents: 0, annual_price_cents: 0 }));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Credit reward state
  const [creditSection, setCreditSection] = useState("add"); // "add" | "set"
  const [creditUserId, setCreditUserId] = useState("");
  const [creditUserSearch, setCreditUserSearch] = useState("");
  const [creditLookup, setCreditLookup] = useState("");
  const [creditOcr, setCreditOcr] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [creditSaving, setCreditSaving] = useState(false);
  const [creditMsg, setCreditMsg] = useState("");

  const fetchPlans = async () => {
    setPlansLoading(true);
    try {
      const r = await fetch(`${API}/admin/plans`, { headers: H() });
      const data = await r.json();
      setPlans(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[PlansTab] fetchPlans error:', e);
    } finally {
      setPlansLoading(false);
    }
  };

  useEffect(() => { fetchPlans(); }, []);

  const startEdit = (plan) => {
    setEditingPlan(plan.plan_name);
    setEditValues({
      monthly_lookup_limit: plan.monthly_lookup_limit,
      monthly_ocr_limit:    plan.monthly_ocr_limit ?? 0,
      monthly_price_cents:  plan.monthly_price_cents,
      annual_price_cents:   plan.annual_price_cents,
    });
    setSaveMsg("");
  };

  const cancelEdit = () => { setEditingPlan(null); setEditValues({ monthly_lookup_limit: 0, monthly_ocr_limit: 0, monthly_price_cents: 0, annual_price_cents: 0 }); setSaveMsg(""); };

  const savePlan = async () => {
    if (!editingPlan) return;
    setSaving(true); setSaveMsg("");
    try {
      const res = await fetch(`${API}/admin/plans/${editingPlan}`, {
        method: "PATCH", headers: H(),
        body: JSON.stringify({
          monthly_lookup_limit: parseInt(editValues.monthly_lookup_limit, 10),
          monthly_ocr_limit:    parseInt(editValues.monthly_ocr_limit,    10),
          monthly_price_cents:  parseInt(editValues.monthly_price_cents,  10),
          annual_price_cents:   parseInt(editValues.annual_price_cents,   10),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveMsg(`Error: ${data.error || "Failed to save"}`); return; }
      setSaveMsg("Saved!");
      setEditingPlan(null);
      await fetchPlans();
    } catch (e) {
      setSaveMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Filtered user list for credit target picker
  const userList = (users || []).filter(u => u.role_type !== 'admin');
  const filteredUserList = creditUserSearch
    ? userList.filter(u => (u.email||"").toLowerCase().includes(creditUserSearch.toLowerCase()) || (u.full_name||"").toLowerCase().includes(creditUserSearch.toLowerCase()))
    : userList;

  const awardCredits = async () => {
    if (!creditUserId) { setCreditMsg("Please select a user."); return; }
    if (!creditLookup && !creditOcr) { setCreditMsg("Enter at least one credit amount."); return; }
    const body = { note: creditNote, replace: creditSection === "set" };
    if (creditLookup) body.bonus_lookup_credits = parseInt(creditLookup, 10);
    if (creditOcr)    body.bonus_ocr_credits    = parseInt(creditOcr, 10);
    setCreditSaving(true); setCreditMsg("");
    try {
      const res = await fetch(`${API}/admin/users/${creditUserId}/credits`, {
        method: "POST", headers: H(), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setCreditMsg(`Error: ${data.error || "Failed"}`); return; }
      const u = data.user;
      setCreditMsg(`Done! ${u.full_name || u.email} now has ${u.bonus_lookup_credits} bonus lookup + ${u.bonus_ocr_credits} bonus OCR credits.`);
      setCreditLookup(""); setCreditOcr(""); setCreditNote(""); setCreditUserId(""); setCreditUserSearch("");
    } catch (e) {
      setCreditMsg(`Error: ${e.message}`);
    } finally {
      setCreditSaving(false);
    }
  };

  // Editable number input helper
  const NumInput = ({ field }) => (
    <input
      type="number" min="0" value={editValues[field] ?? 0}
      onChange={e => setEditValues(v => ({ ...v, [field]: e.target.value }))}
      className="w-24 text-xs px-2 py-1 rounded-lg border border-[#800020]/30 bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#800020]/40"
    />
  );

  // Plan display name normalizer
  const planLabel = (p) => {
    const map = { free: "Free", basic: "Basic", basic_monthly: "Basic (Monthly)", basic_annually: "Basic (Annual)", pro: "Pro", pro_monthly: "Pro (Monthly)", pro_annually: "Pro (Annual)", admin: "Admin" };
    return map[p] || p;
  };

  // Group plans for display (only show key canonical plans in the editor)
  const CANONICAL = ['free', 'basic_monthly', 'basic_annually', 'pro_monthly', 'pro_annually', 'admin'];
  const shownPlans = plans.filter(p => CANONICAL.includes(p.plan_name));

  const selectedUser = userList.find(u => u.id === creditUserId);

  return (
    <div className="space-y-8">
      {/* ── Plan Limits Editor ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-[#800020]" /> Plan Limits
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Adjust lookup limits, AI Image Search credits, and pricing for each plan. Changes apply immediately to all users on that plan.</p>
          </div>
          <button onClick={fetchPlans} className="h-8 px-3 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {saveMsg && (
          <div className={`mb-3 text-xs px-3 py-2 rounded-lg ${saveMsg.startsWith("Error") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
            {saveMsg}
          </div>
        )}

        {plansLoading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#800020] rounded-full animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Plan</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Lookup Limit /mo</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">AI Search Credits /mo</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Monthly Price ($)</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Annual Price ($)</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shownPlans.map(plan => {
                  const isEditing = editingPlan === plan.plan_name;
                  const planColor = plan.plan_name.startsWith('pro') ? 'text-purple-600' : plan.plan_name.startsWith('basic') ? 'text-blue-600' : plan.plan_name === 'admin' ? 'text-[#800020]' : 'text-gray-500';
                  return (
                    <tr key={plan.plan_name} className={`border-b border-gray-50 dark:border-gray-800 ${isEditing ? "bg-[#800020]/[0.02] dark:bg-[#800020]/5" : "hover:bg-gray-50/50 dark:hover:bg-gray-800/40"}`}>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${planColor}`}>{planLabel(plan.plan_name)}</span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {isEditing ? <NumInput field="monthly_lookup_limit" /> : <span className="text-gray-700 dark:text-gray-300 font-mono">{(plan.monthly_lookup_limit||0).toLocaleString()}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {isEditing ? <NumInput field="monthly_ocr_limit" /> : <span className="text-gray-700 dark:text-gray-300 font-mono">{plan.monthly_ocr_limit === 99999 ? "∞" : (plan.monthly_ocr_limit||0).toLocaleString()}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {isEditing ? <NumInput field="monthly_price_cents" /> : (
                          <span className="text-gray-700 dark:text-gray-300">
                            {plan.monthly_price_cents > 0 ? `$${(plan.monthly_price_cents/100).toFixed(2)}` : <span className="text-gray-400">—</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {isEditing ? <NumInput field="annual_price_cents" /> : (
                          <span className="text-gray-700 dark:text-gray-300">
                            {plan.annual_price_cents > 0 ? `$${(plan.annual_price_cents/100).toFixed(2)}` : <span className="text-gray-400">—</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center gap-2 justify-end">
                            <button onClick={cancelEdit} disabled={saving}
                              className="h-7 px-3 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1">
                              <X className="w-3 h-3" /> Cancel
                            </button>
                            <button onClick={savePlan} disabled={saving}
                              className="h-7 px-3 text-xs rounded-lg bg-[#800020] hover:bg-[#6b001b] text-white flex items-center gap-1">
                              {saving ? <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" /> : <Check className="w-3 h-3" />}
                              Save
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(plan)}
                            className="h-7 px-3 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-[#800020] hover:border-[#800020]/30 flex items-center gap-1 ml-auto">
                            <Edit2 className="w-3 h-3" /> Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2">Prices are stored in cents. Changing prices here does not update Stripe — Stripe prices are created on first checkout and cached. To change billing prices, update in Stripe dashboard directly.</p>
      </div>

      {/* ── Bonus Credits Reward ── */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-1">
          <Gift className="w-4 h-4 text-[#800020]" /> Reward Bonus Credits
        </h3>
        <p className="text-xs text-gray-500 mb-4">Grant extra lookup or AI Image Search credits to any user, on top of their plan's monthly allowance. These persist month-to-month until manually removed.</p>

        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-1">
            {[{ id: "add", label: "+ Add credits" }, { id: "set", label: "= Set exact amount" }].map(m => (
              <button key={m.id} onClick={() => setCreditSection(m.id)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${creditSection === m.id ? "bg-[#800020] text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            {creditSection === "add" ? "Credits will be added on top of the user's current bonus balance." : "The user's bonus balance will be set to exactly this amount, replacing any existing bonus credits."}
          </p>

          {/* User selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Target User</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={creditUserSearch} onChange={e => { setCreditUserSearch(e.target.value); setCreditUserId(""); }}
                placeholder="Search by name or email…"
                className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#800020]/30" />
            </div>
            {creditUserSearch && !creditUserId && (
              <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden max-h-48 overflow-y-auto bg-white dark:bg-gray-900">
                {filteredUserList.length === 0 ? (
                  <p className="text-xs text-gray-400 px-3 py-2">No users found.</p>
                ) : filteredUserList.slice(0, 10).map(u => (
                  <button key={u.id} onClick={() => { setCreditUserId(u.id); setCreditUserSearch(`${u.full_name || u.email} (${u.email})`); }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-gray-800 last:border-0">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{u.full_name || "—"}</span>
                    <span className="text-gray-400 ml-2">{u.email}</span>
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${u.subscription_plan?.startsWith('pro') ? 'bg-purple-100 text-purple-600' : u.subscription_plan?.startsWith('basic') ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                      {u.subscription_plan || "free"}
                    </span>
                    {(u.bonus_lookup_credits > 0 || u.bonus_ocr_credits > 0) && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        +{u.bonus_lookup_credits} lookup / +{u.bonus_ocr_credits} OCR
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {selectedUser && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#800020]/5 border border-[#800020]/10 text-xs">
                <Check className="w-3.5 h-3.5 text-[#800020]" />
                <span className="font-medium text-gray-800 dark:text-gray-200">{selectedUser.full_name || selectedUser.email}</span>
                <span className="text-gray-400">{selectedUser.email}</span>
                <span className="ml-auto text-gray-400">
                  Current bonus: <span className="text-amber-600 font-medium">{selectedUser.bonus_lookup_credits || 0}</span> lookup / <span className="text-amber-600 font-medium">{selectedUser.bonus_ocr_credits || 0}</span> OCR
                </span>
              </div>
            )}
          </div>

          {/* Credit amounts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Lookup Credits</label>
              <input type="number" min="0" value={creditLookup} onChange={e => setCreditLookup(e.target.value)}
                placeholder="e.g. 500"
                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#800020]/30" />
              <p className="text-xs text-gray-400">Extra wine lookups per month on top of plan</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">AI Image Search Credits</label>
              <input type="number" min="0" value={creditOcr} onChange={e => setCreditOcr(e.target.value)}
                placeholder="e.g. 20"
                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#800020]/30" />
              <p className="text-xs text-gray-400">Extra OCR/image search credits per month</p>
            </div>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Internal Note (optional)</label>
            <input type="text" value={creditNote} onChange={e => setCreditNote(e.target.value)}
              placeholder="Reason for granting credits…"
              className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#800020]/30" />
          </div>

          {creditMsg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${creditMsg.startsWith("Error") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
              {creditMsg}
            </div>
          )}

          <button onClick={awardCredits} disabled={creditSaving || !creditUserId || (!creditLookup && !creditOcr)}
            className="flex items-center gap-2 h-9 px-5 text-sm rounded-lg bg-[#800020] hover:bg-[#6b001b] text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {creditSaving
              ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <Gift className="w-4 h-4" />}
            {creditSection === "add" ? "Add Credits" : "Set Credits"}
          </button>
        </div>

        {/* Users with bonus credits summary */}
        {usersLoading ? null : (() => {
          const withBonus = (users || []).filter(u => (u.bonus_lookup_credits > 0 || u.bonus_ocr_credits > 0));
          if (withBonus.length === 0) return null;
          return (
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{withBonus.length} User{withBonus.length !== 1 ? "s" : ""} with Active Bonus Credits</p>
              <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700 text-left">
                      <th className="px-4 py-2 text-xs font-semibold text-gray-500">User</th>
                      <th className="px-4 py-2 text-xs font-semibold text-gray-500">Plan</th>
                      <th className="px-4 py-2 text-xs font-semibold text-gray-500">Bonus Lookups</th>
                      <th className="px-4 py-2 text-xs font-semibold text-gray-500">Bonus OCR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withBonus.map(u => (
                      <tr key={u.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                        <td className="px-4 py-2.5 text-xs">
                          <p className="font-medium text-gray-800 dark:text-gray-200">{u.full_name || "—"}</p>
                          <p className="text-gray-400">{u.email}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{u.subscription_plan || "free"}</td>
                        <td className="px-4 py-2.5 text-xs font-semibold text-amber-600">+{u.bonus_lookup_credits}</td>
                        <td className="px-4 py-2.5 text-xs font-semibold text-amber-600">+{u.bonus_ocr_credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────
// All column definitions for the users table.
// group: "standard" = base identity/status cols; "lookup"/"ocr" = credit cols.
// defaultOn: true = visible without any user selection.
const ALL_COL_DEFS = [
  // ── Standard ────────────────────────────────────────────────────────────────
  { id: "user",              label: "User",               group: "standard", sortField: "full_name",         defaultOn: true  },
  { id: "plan",              label: "Plan",               group: "standard", sortField: "subscription_plan", defaultOn: true  },
  { id: "role",              label: "Role",               group: "standard", sortField: "role_type",         defaultOn: true  },
  { id: "status",            label: "Status",             group: "standard", sortField: null,                defaultOn: true  },
  { id: "last_login",        label: "Last Login",         group: "standard", sortField: "last_login",        defaultOn: true  },
  { id: "joined",            label: "Joined",             group: "standard", sortField: "created_date",      defaultOn: true  },
  { id: "failed",            label: "Failed Logins",      group: "standard", sortField: null,                defaultOn: true  },
  // ── Lookup credits ───────────────────────────────────────────────────────────
  { id: "lookup_credits",    label: "Lookup Credits",     group: "lookup",   sortField: null, defaultOn: false, title: "Plan monthly lookup limit"                        },
  { id: "lookup_used",       label: "Lookup Used",        group: "lookup",   sortField: null, defaultOn: false, title: "Lookups consumed this month"                      },
  { id: "bonus_lookup",      label: "Bonus Lookups",      group: "lookup",   sortField: null, defaultOn: false, title: "Bonus lookup credits awarded on top of plan"       },
  { id: "bonus_lookup_used", label: "Bonus Lookup Used",  group: "lookup",   sortField: null, defaultOn: false, title: "Bonus lookup credits consumed this month"          },
  // ── OCR / AI Image Search credits ────────────────────────────────────────────
  { id: "ocr_credits",       label: "OCR Credits",        group: "ocr",      sortField: null, defaultOn: false, title: "Plan monthly AI Image Search (OCR) limit"          },
  { id: "ocr_used",          label: "OCR Used",           group: "ocr",      sortField: null, defaultOn: false, title: "AI Image Search requests used this month"          },
  { id: "bonus_ocr",         label: "Bonus OCR",          group: "ocr",      sortField: null, defaultOn: false, title: "Bonus OCR credits awarded on top of plan"          },
  { id: "bonus_ocr_used",    label: "Bonus OCR Used",     group: "ocr",      sortField: null, defaultOn: false, title: "Bonus OCR credits consumed this month"             },
];
const DEFAULT_COLS      = ALL_COL_DEFS.filter(c => c.defaultOn).map(c => c.id);
const USERS_COLS_KEY    = "admin_users_columns_v2";

function UsersTab({ users, loading, onAction, adminId }) {
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("created_date");
  const [sortDir, setSortDir] = useState("desc");
  const [lockTarget, setLockTarget] = useState(null);
  const [lockReason, setLockReason] = useState("");
  const [lockHours, setLockHours] = useState(24);
  const [acting, setActing] = useState(false);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState(() => {
    try { const s = localStorage.getItem(USERS_COLS_KEY); return s ? JSON.parse(s) : DEFAULT_COLS; }
    catch { return DEFAULT_COLS; }
  });

  const toggleCol = (id) => {
    setVisibleCols(prev => {
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id];
      localStorage.setItem(USERS_COLS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const vis = (id) => visibleCols.includes(id);

  const isLocked = (u) => u.locked_until && new Date(u.locked_until) > new Date();

  const getStatus = (u) => {
    if (isLocked(u)) return "locked";
    if (u.is_active === false) return "inactive";
    return "active";
  };

  const filtered = (users || []).filter(u => {
    const q = search.toLowerCase();
    if (q && !u.email?.toLowerCase().includes(q) && !u.full_name?.toLowerCase().includes(q)) return false;
    if (planFilter !== "all" && (u.subscription_plan || "free") !== planFilter) return false;
    if (roleFilter !== "all" && (u.role_type || "user") !== roleFilter) return false;
    if (statusFilter !== "all" && getStatus(u) !== statusFilter) return false;
    return true;
  }).sort((a, b) => {
    let av = a[sortField] ?? "";
    let bv = b[sortField] ?? "";
    if (sortField === "created_date" || sortField === "last_login") {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    } else {
      av = String(av).toLowerCase();
      bv = String(bv).toLowerCase();
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const SortTh = ({ field, label, className = "" }) => {
    const active = sortField === field;
    return (
      <th onClick={() => handleSort(field)}
        className={`px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap ${className}`}>
        <span className="flex items-center gap-1">
          {label}
          {active
            ? sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
            : <ArrowUpDown className="w-3 h-3 opacity-40" />}
        </span>
      </th>
    );
  };

  const handleConfirm = async () => {
    if (!lockTarget) return;
    setActing(true);
    await onAction(lockTarget.id, lockTarget.action, { reason: lockReason, duration_hours: lockHours });
    setActing(false);
    setLockTarget(null);
    setLockReason("");
    setLockHours(24);
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#800020] rounded-full animate-spin" /></div>;

  const allPlans = [...new Set((users || []).map(u => u.subscription_plan || "free"))].sort();
  const allRoles = [...new Set((users || []).map(u => u.role_type || "user"))].sort();

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
        <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
          className="h-7 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-2">
          <option value="all">All plans</option>
          {allPlans.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="h-7 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-2">
          <option value="all">All roles</option>
          {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-7 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-2">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="locked">Locked</option>
          <option value="inactive">Inactive</option>
        </select>
        <div className="relative ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {filtered.length} of {(users || []).length} users · {filtered.filter(isLocked).length} locked
          </span>
          <div className="relative">
            <button
              onClick={() => setColPickerOpen(o => !o)}
              className="h-7 px-2.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 bg-white dark:bg-gray-800 flex items-center gap-1.5 hover:border-[#800020] hover:text-[#800020] transition-colors"
            >
              <Filter className="w-3 h-3" /> Columns
            </button>
            {colPickerOpen && (
              <div className="absolute right-0 top-9 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-3 w-56 max-h-[420px] overflow-y-auto">
                {[
                  { key: "standard", label: "Standard" },
                  { key: "lookup",   label: "Lookup Credits" },
                  { key: "ocr",      label: "OCR / AI Image" },
                ].map(({ key, label }) => (
                  <div key={key} className="mb-3 last:mb-0">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
                    {ALL_COL_DEFS.filter(c => c.group === key).map(col => (
                      <label key={col.id} title={col.title} className="flex items-center gap-2 py-0.5 cursor-pointer">
                        <input type="checkbox" checked={vis(col.id)} onChange={() => toggleCol(col.id)}
                          className="rounded border-gray-300 text-[#800020] cursor-pointer" />
                        <span className="text-xs text-gray-600 dark:text-gray-300">{col.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
                <div className="border-t border-gray-100 dark:border-gray-700 pt-2 mt-1 flex gap-2">
                  <button onClick={() => { const all = ALL_COL_DEFS.map(c=>c.id); setVisibleCols(all); localStorage.setItem(USERS_COLS_KEY, JSON.stringify(all)); }}
                    className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">All</button>
                  <button onClick={() => { setVisibleCols(DEFAULT_COLS); localStorage.setItem(USERS_COLS_KEY, JSON.stringify(DEFAULT_COLS)); }}
                    className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">Reset</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700 text-left">
              {vis("user")       && <SortTh field="full_name"         label="User" />}
              {vis("plan")       && <SortTh field="subscription_plan" label="Plan" />}
              {vis("role")       && <SortTh field="role_type"         label="Role" />}
              {vis("status")     && <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>}
              {vis("last_login") && <SortTh field="last_login"        label="Last Login" />}
              {vis("joined")     && <SortTh field="created_date"      label="Joined" />}
              {vis("failed")     && <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">Failed</th>}
              {ALL_COL_DEFS.filter(c => c.group !== "standard" && vis(c.id)).map(col => (
                <th key={col.id} title={col.title} className="px-4 py-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 text-center whitespace-nowrap">{col.label}</th>
              ))}
              <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={visibleCols.length + 1} className="text-center py-8 text-gray-400 text-sm">No users found.</td></tr>
            )}
            {filtered.map(u => {
              const locked = isLocked(u);
              // ── credit helpers ───────────────────────────────────────────
              const lkLimit  = Number(u.monthly_lookup_limit || 20);
              const lkUsed   = Number(u.used_lookups || 0);
              const lkBonus  = Number(u.bonus_lookup_credits || 0);
              const lkBonusUsed = Math.min(lkBonus, Math.max(0, lkUsed - lkLimit));
              const ocrLimit = Number(u.monthly_ocr_limit || 2);
              const ocrUsed  = Number(u.used_ocr || 0);
              const ocrBonus = Number(u.bonus_ocr_credits || 0);
              const ocrBonusUsed = Math.min(ocrBonus, Math.max(0, ocrUsed - ocrLimit));

              const Num = ({ v, cls = "text-gray-700 dark:text-gray-300" }) => (
                <td className={`px-4 py-3 text-xs text-center whitespace-nowrap ${cls}`}>{v}</td>
              );
              const BonusNum = ({ v }) => (
                <td className="px-4 py-3 text-xs text-center whitespace-nowrap">
                  {v > 0 ? <span className="text-amber-600 font-semibold">+{v}</span> : <span className="text-gray-300">—</span>}
                </td>
              );
              const UsedNum = ({ used, limit }) => {
                const pct = limit > 0 ? used / limit : 0;
                const cls = pct >= 1 ? "text-red-600 font-semibold" : pct >= 0.8 ? "text-amber-600" : "text-gray-600 dark:text-gray-300";
                return <td className={`px-4 py-3 text-xs text-center whitespace-nowrap ${cls}`}>{used}</td>;
              };

              return (
                <tr key={u.id} className={`border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/40 ${locked ? "bg-red-50/30 dark:bg-red-900/10" : ""}`}>
                  {vis("user") && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-medium text-gray-900 dark:text-white text-xs">{u.full_name || "—"}</p>
                        {adminId && u.id === adminId && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#800020]/10 text-[#800020] font-semibold">me</span>
                        )}
                      </div>
                      <p className="text-gray-400 text-xs">{u.email}</p>
                    </td>
                  )}
                  {vis("plan") && <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 capitalize">{u.subscription_plan || "free"}</td>}
                  {vis("role") && (
                    <td className="px-4 py-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${u.role_type === "admin" ? "bg-[#800020]/10 text-[#800020]" : "bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>
                        {u.role_type || "user"}
                      </span>
                    </td>
                  )}
                  {vis("status") && (
                    <td className="px-4 py-3">
                      {locked ? (
                        <div className="flex items-center gap-1">
                          <Lock className="w-3 h-3 text-red-500" />
                          <span className="text-xs text-red-600 font-medium">Locked</span>
                          <span className="text-xs text-gray-400">until {new Date(u.locked_until).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      ) : (
                        <span className={`text-xs font-medium ${u.is_active === false ? "text-gray-400" : "text-emerald-600"}`}>
                          {u.is_active === false ? "Inactive" : "Active"}
                        </span>
                      )}
                    </td>
                  )}
                  {vis("last_login") && (
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {u.last_login ? new Date(u.last_login).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : <span className="text-gray-300">Never</span>}
                    </td>
                  )}
                  {vis("joined") && (
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{new Date(u.created_date).toLocaleDateString()}</td>
                  )}
                  {vis("failed") && (
                    <td className="px-4 py-3 text-xs text-center">
                      {(u.failed_login_attempts || 0) > 0
                        ? <span className="text-amber-600 font-semibold">{u.failed_login_attempts}</span>
                        : <span className="text-gray-300">0</span>}
                    </td>
                  )}
                  {vis("lookup_credits")    && <Num v={lkLimit} />}
                  {vis("lookup_used")       && <UsedNum used={lkUsed} limit={lkLimit + lkBonus} />}
                  {vis("bonus_lookup")      && <BonusNum v={lkBonus} />}
                  {vis("bonus_lookup_used") && <BonusNum v={lkBonusUsed} />}
                  {vis("ocr_credits")       && <Num v={ocrLimit} />}
                  {vis("ocr_used")          && <UsedNum used={ocrUsed} limit={ocrLimit + ocrBonus} />}
                  {vis("bonus_ocr")         && <BonusNum v={ocrBonus} />}
                  {vis("bonus_ocr_used")    && <BonusNum v={ocrBonusUsed} />}
                  <td className="px-4 py-3 text-right">
                    {locked ? (
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => setLockTarget({ id: u.id, name: u.full_name || u.email, action: "unlock" })}>
                        <Unlock className="w-3 h-3" /> Unlock
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => setLockTarget({ id: u.id, name: u.full_name || u.email, action: "lock" })}>
                        <Lock className="w-3 h-3" /> Lock
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Lock/Unlock confirmation dialog */}
      {lockTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className={`w-5 h-5 ${lockTarget.action === "lock" ? "text-red-500" : "text-emerald-500"}`} />
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {lockTarget.action === "lock" ? "Lock account" : "Unlock account"}
              </h3>
            </div>
            <p className="text-sm text-gray-500">
              {lockTarget.action === "lock"
                ? `Lock ${lockTarget.name}'s account? They will be unable to sign in and will receive an email notification.`
                : `Unlock ${lockTarget.name}'s account? They will immediately be able to sign in again.`}
            </p>
            {lockTarget.action === "lock" && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Reason (sent to user)</label>
                  <input
                    value={lockReason} onChange={e => setLockReason(e.target.value)}
                    placeholder="e.g. Suspicious activity detected"
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Duration</label>
                  <select value={lockHours} onChange={e => setLockHours(Number(e.target.value))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200">
                    <option value={1}>1 hour</option>
                    <option value={6}>6 hours</option>
                    <option value={24}>24 hours</option>
                    <option value={72}>3 days</option>
                    <option value={168}>7 days</option>
                    <option value={8760}>1 year (permanent)</option>
                  </select>
                </div>
              </>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 h-9 text-sm" onClick={() => { setLockTarget(null); setLockReason(""); setLockHours(24); }} disabled={acting}>Cancel</Button>
              <Button className={`flex-1 h-9 text-sm text-white ${lockTarget.action === "lock" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
                onClick={handleConfirm} disabled={acting}>
                {acting ? "Processing…" : lockTarget.action === "lock" ? "Lock account" : "Unlock account"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── System Alerts Tab ─────────────────────────────────────────────────────────
function SystemAlertsTab({ alerts, loading, onRefresh }) {
  const [resolvingId, setResolvingId] = useState(null);
  const [showResolved, setShowResolved] = useState(false);

  const resolveAlert = async (id) => {
    setResolvingId(id);
    try {
      await fetch(`${API}/admin/system-alerts/${id}/resolve`, { method: 'POST', headers: H() });
      onRefresh(showResolved);
    } catch (e) {
      console.error('resolve alert failed', e);
    } finally {
      setResolvingId(null);
    }
  };

  const shown = showResolved ? alerts : alerts.filter(a => !a.resolved);
  const unresolvedCount = alerts.filter(a => !a.resolved).length;

  const severityStyle = { critical: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30', warning: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30', info: 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30' };
  const severityText  = { critical: 'text-red-700 dark:text-red-300', warning: 'text-amber-700 dark:text-amber-300', info: 'text-blue-700 dark:text-blue-300' };
  const severityBadge = { critical: 'bg-red-100 text-red-700', warning: 'bg-amber-100 text-amber-700', info: 'bg-blue-100 text-blue-700' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">{unresolvedCount} unresolved</span>
          <button onClick={() => { setShowResolved(v => !v); onRefresh(!showResolved); }}
            className="text-xs text-[#800020] hover:underline">
            {showResolved ? 'Hide resolved' : 'Show resolved'}
          </button>
        </div>
        <button onClick={() => onRefresh(showResolved)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading && <div className="text-center py-10 text-gray-400 text-sm">Loading alerts...</div>}
      {!loading && shown.length === 0 && (
        <div className="text-center py-10 space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
          <p className="text-sm text-gray-500">No {showResolved ? '' : 'unresolved '}system alerts.</p>
        </div>
      )}

      {shown.map(alert => (
        <div key={alert.id} className={`rounded-lg border px-4 py-3 ${alert.resolved ? 'opacity-60 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/30' : (severityStyle[alert.severity] || severityStyle.warning)}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${severityBadge[alert.severity] || severityBadge.warning}`}>
                  {alert.severity}
                </span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">{alert.alert_type}</span>
                <span className="text-[10px] text-gray-400 ml-auto">{new Date(alert.created_date).toLocaleString()}</span>
              </div>
              <p className={`text-sm font-semibold ${alert.resolved ? 'text-gray-500' : (severityText[alert.severity] || severityText.warning)}`}>{alert.title}</p>
              <p className={`text-xs mt-1 ${alert.resolved ? 'text-gray-400' : (severityText[alert.severity] || severityText.warning)}`}>{alert.message}</p>
              {alert.details && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Show details</summary>
                  <pre className="mt-1 text-[10px] bg-black/10 dark:bg-white/5 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(typeof alert.details === 'string' ? JSON.parse(alert.details) : alert.details, null, 2)}
                  </pre>
                </details>
              )}
              {alert.resolved && (
                <p className="text-[10px] text-gray-400 mt-1">Resolved {alert.resolved_at ? new Date(alert.resolved_at).toLocaleString() : ''} by {alert.resolved_by || 'admin'}</p>
              )}
            </div>
            {!alert.resolved && (
              <button
                onClick={() => resolveAlert(alert.id)}
                disabled={resolvingId === alert.id}
                className="flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                {resolvingId === alert.id ? 'Resolving...' : 'Resolve'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Workspace() {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(null);
  const [activeTab, setActiveTab] = useState("tickets");
  const [tickets, setTickets] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [connErrors, setConnErrors] = useState([]);
  const [lookupErrors, setLookupErrors] = useState([]);
  const [securityErrors, setSecurityErrors] = useState([]);
  const [systemAlerts, setSystemAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorsLoading, setErrorsLoading] = useState(false);
  const [analyticsSummary, setAnalyticsSummary] = useState(null);
  const [analyticsTimeseries, setAnalyticsTimeseries] = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsUsers, setAnalyticsUsers] = useState([]);
  const [analyticsUsersLoading, setAnalyticsUsersLoading] = useState(false);
  const [usageUsers, setUsageUsers] = useState([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [adminId, setAdminId] = useState(null);

  useEffect(() => {
    fetch(`${API}/admin/me`, { headers: H() })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { setIsAdmin(true); setAdminId(data.id); })
      .catch(() => setIsAdmin(false));
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s, c] = await Promise.all([
        fetch(`${API}/admin/tickets`, { headers: H() }).then(r => r.json()),
        fetch(`${API}/admin/suggestions`, { headers: H() }).then(r => r.json()),
        fetch(`${API}/admin/contact-submissions`, { headers: H() }).then(r => r.json()),
      ]);
      setTickets(Array.isArray(t) ? t : []);
      setSuggestions(Array.isArray(s) ? s : []);
      setContacts(Array.isArray(c) ? c : []);
    } catch (e) {
      console.error('[Workspace] fetchAll error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchErrors = useCallback(async (range = "all") => {
    setErrorsLoading(true);
    try {
      const q = range !== "all" ? `?range=${range}` : "";
      const [ce, le, se] = await Promise.all([
        fetch(`${API}/admin/errors/connections${q}`, { headers: H() }).then(r => r.json()),
        fetch(`${API}/admin/errors/lookups${q}`, { headers: H() }).then(r => r.json()),
        fetch(`${API}/admin/errors/security`, { headers: H() }).then(r => r.json()),
      ]);
      setConnErrors(Array.isArray(ce) ? ce : []);
      setLookupErrors(Array.isArray(le) ? le : []);
      setSecurityErrors(Array.isArray(se) ? se : []);
    } catch (e) {
      console.error('[Workspace] fetchErrors error:', e);
    } finally {
      setErrorsLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async (groupBy = "day", range = "30") => {
    setAnalyticsLoading(true);
    try {
      const [summary, ts] = await Promise.all([
        fetch(`${API}/admin/analytics/summary`, { headers: H() }).then(r => r.json()),
        fetch(`${API}/admin/analytics/timeseries?group_by=${groupBy}&range=${range}`, { headers: H() }).then(r => r.json()),
      ]);
      setAnalyticsSummary(summary);
      setAnalyticsTimeseries(Array.isArray(ts) ? ts : []);
    } catch (e) {
      console.error('[Workspace] fetchAnalytics error:', e);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const fetchAnalyticsUsers = useCallback(async () => {
    setAnalyticsUsersLoading(true);
    try {
      const data = await fetch(`${API}/admin/analytics/users`, { headers: H() }).then(r => r.json());
      setAnalyticsUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[Workspace] fetchAnalyticsUsers error:', e);
    } finally {
      setAnalyticsUsersLoading(false);
    }
  }, []);

  const fetchUsageUsers = useCallback(async () => {
    setUsageLoading(true);
    try {
      const data = await fetch(`${API}/admin/analytics/user-usage`, { headers: H() }).then(r => r.json());
      setUsageUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[Workspace] fetchUsageUsers error:', e);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const r = await fetch(`${API}/admin/users`, { headers: H() });
      const data = await r.json();
      setAllUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[Workspace] fetchUsers error:', e);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const fetchSystemAlerts = useCallback(async (showResolved = false) => {
    setAlertsLoading(true);
    try {
      const r = await fetch(`${API}/admin/system-alerts?resolved=${showResolved}`, { headers: H() });
      const data = await r.json();
      setSystemAlerts(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[Workspace] fetchSystemAlerts error:', e);
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  const handleUserAction = async (userId, action, opts = {}) => {
    await fetch(`${API}/admin/users/${userId}/${action}`, {
      method: "POST", headers: H(),
      body: JSON.stringify(opts),
    });
    await fetchUsers();
  };

  useEffect(() => {
    if (isAdmin) {
      fetchAll();
      fetchErrors();
      fetchAnalytics();
      fetchUsers();
      fetchSystemAlerts();
    }
  }, [isAdmin, fetchAll, fetchErrors, fetchAnalytics, fetchUsers, fetchSystemAlerts]);

  const handleRefresh = () => {
    fetchAll();
    fetchErrors();
    fetchAnalytics();
    fetchUsers();
    fetchSystemAlerts();
  };

  const updateTicket = async (id, patch) => {
    const res = await fetch(`${API}/admin/tickets/${id}`, {
      method: "PATCH", headers: H(), body: JSON.stringify(patch),
    });
    const updated = await res.json();
    setTickets(prev => prev.map(t => t.id === id ? updated : t));
    return updated;
  };

  const updateSuggestion = async (id, patch) => {
    const res = await fetch(`${API}/admin/suggestions/${id}`, {
      method: "PATCH", headers: H(), body: JSON.stringify(patch),
    });
    const updated = await res.json();
    setSuggestions(prev => prev.map(s => s.id === id ? updated : s));
  };

  const updateContact = async (id, patch) => {
    const res = await fetch(`${API}/admin/contact-submissions/${id}`, {
      method: "PATCH", headers: H(), body: JSON.stringify(patch),
    });
    const updated = await res.json();
    setContacts(prev => prev.map(c => c.id === id ? updated : c));
  };

  const deleteTicket = async (id) => {
    await fetch(`${API}/admin/tickets/${id}`, { method: "DELETE", headers: H() });
    setTickets(prev => prev.map(t => t.id === id ? { ...t, is_deleted: true } : t));
  };

  const deleteSuggestion = async (id) => {
    await fetch(`${API}/admin/suggestions/${id}`, { method: "DELETE", headers: H() });
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, is_deleted: true } : s));
  };

  const deleteContact = async (id) => {
    await fetch(`${API}/admin/contact-submissions/${id}`, { method: "DELETE", headers: H() });
    setContacts(prev => prev.map(c => c.id === id ? { ...c, is_deleted: true } : c));
  };

  if (isAdmin === false) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <Shield className="w-7 h-7 text-red-400" />
          </div>
          <h1 className="text-xl font-serif font-bold text-gray-900 dark:text-white">Access Denied</h1>
          <p className="text-sm text-gray-500">You do not have admin access to this page.</p>
          <Button onClick={() => navigate(createPageUrl("Lookup"))}
            className="bg-[#800020] hover:bg-[#6b001b] text-white">
            Back to app
          </Button>
        </div>
      </div>
    );
  }

  if (isAdmin === null || loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-[#800020] rounded-full animate-spin" />
      </div>
    );
  }

  const totalErrors = connErrors.length + lookupErrors.length + securityErrors.length;

  const lockedUsersCount = allUsers.filter(u => u.locked_until && new Date(u.locked_until) > new Date()).length;

  const unresolvedAlerts = systemAlerts.filter(a => !a.resolved).length;

  const TABS = [
    { id: "tickets",    label: "Support Tickets",  icon: <HeadphonesIcon className="w-4 h-4" />, count: tickets.filter(t => t.status === "open" || t.status === "in_progress").length },
    { id: "suggestions",label: "Feedback",          icon: <Lightbulb className="w-4 h-4" />,      count: suggestions.filter(s => s.status === "submitted").length },
    { id: "contacts",   label: "Contact Messages", icon: <Mail className="w-4 h-4" />,            count: contacts.filter(c => c.status === "new").length },
    { id: "alerts",     label: "System Alerts",    icon: <BellRing className="w-4 h-4" />,        count: unresolvedAlerts },
    { id: "errors",     label: "Error Tracking",   icon: <AlertCircle className="w-4 h-4" />,     count: totalErrors },
    { id: "analytics",  label: "Analytics",        icon: <BarChart2 className="w-4 h-4" />,       count: 0 },
    { id: "plans",      label: "Plans & Credits",  icon: <Settings2 className="w-4 h-4" />,       count: 0 },
    { id: "users",      label: "Users",             icon: <Users className="w-4 h-4" />,           count: lockedUsersCount },
  ];

  const TAB_GROUPS = [
    { label: "User Messages", ids: ["tickets", "suggestions", "contacts"] },
    { label: "Monitoring",    ids: ["alerts", "errors"] },
    { label: "Analytics",     ids: ["analytics"] },
    { label: "Management",    ids: ["plans", "users"] },
  ];

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-black">
      <div className="px-6 lg:px-12 xl:px-16 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-[#800020]" />
              <span className="text-xs font-semibold text-[#800020] uppercase tracking-widest">Admin</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-serif font-bold text-gray-900 dark:text-white tracking-tight">Workspace</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm font-light mt-1">
              User messages, monitoring, analytics, and account management
            </p>
          </div>
          <Button variant="outline" onClick={handleRefresh}
            className="gap-2 border-gray-200 dark:border-gray-700 dark:text-gray-300 h-9 text-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Open Tickets",    value: tickets.filter(t => t.status === "open").length,          color: "text-blue-600" },
            { label: "New Feedback",    value: suggestions.filter(s => s.status === "submitted").length, color: "text-amber-600" },
            { label: "Unread Messages", value: contacts.filter(c => c.status === "new").length,          color: "text-[#800020]" },
            { label: "Total Errors",    value: totalErrors,                                               color: totalErrors > 0 ? "text-red-600" : "text-gray-400" },
            { label: "Locked Accounts",  value: lockedUsersCount,  color: lockedUsersCount > 0 ? "text-red-600" : "text-gray-400" },
            { label: "System Alerts",    value: unresolvedAlerts, color: unresolvedAlerts > 0 ? "text-red-600" : "text-gray-400" },
          ].map(stat => (
            <Card key={stat.label} className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
              <CardContent className="pt-5 pb-4 px-5">
                <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Grouped tabs */}
        <div className="flex overflow-x-auto bg-gray-100 dark:bg-gray-800 rounded-xl p-1.5 mb-6 gap-2 items-end [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TAB_GROUPS.map((group, gi) => (
            <div key={group.label} className="flex-shrink-0 flex items-end gap-2">
              {gi > 0 && (
                <div className="flex-shrink-0 self-stretch flex items-center pb-0.5 pr-1">
                  <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-1.5 leading-none">{group.label}</span>
                <div className="flex gap-1">
                  {group.ids.map(id => {
                    const t = TABS.find(x => x.id === id);
                    return (
                      <button key={t.id} onClick={() => setActiveTab(t.id)}
                        className={`flex-shrink-0 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                          activeTab === t.id
                            ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}>
                        {t.icon}
                        <span className="hidden sm:inline">{t.label}</span>
                        {t.count > 0 && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${
                            t.id === "errors" ? "bg-red-500 text-white" : "bg-[#800020] text-white"
                          }`}>
                            {t.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tab content */}
        <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold dark:text-white flex items-center gap-2">
              {TABS.find(t => t.id === activeTab)?.icon}
              {TABS.find(t => t.id === activeTab)?.label}
            </CardTitle>
            <CardDescription>
              {activeTab === "tickets"     && "Support tickets submitted by registered users. Reply and update status directly."}
              {activeTab === "suggestions" && "Feedback, ideas, and requests from users. Update status to track progress."}
              {activeTab === "contacts"    && "Messages from the public Contact Us form — no login required to send these."}
              {activeTab === "alerts"      && "Automated system alerts — login selector failures, systemic PerimeterX blocks, and other critical monitoring events."}
              {activeTab === "errors"      && "Connection and lookup errors across all users. Search, filter, and sort to debug issues quickly."}
              {activeTab === "analytics"   && "Platform-wide metrics — growth, revenue, subscriptions, errors, and per-user insights."}
              {activeTab === "plans"       && "Edit plan limits and pricing, and reward bonus lookup or AI Image Search credits to individual users."}
              {activeTab === "users"       && "All registered users. Lock or unlock accounts and view failed login attempts."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeTab === "tickets" && (
              <Section
                items={tickets}
                statusOptions={TICKET_STATUSES}
                renderRow={(t) => <TicketRow key={t.id} ticket={t} onUpdate={updateTicket} onDelete={deleteTicket} />}
                emptyText="No support tickets yet."
                storageKey="admin_groupby_tickets"
              />
            )}
            {activeTab === "suggestions" && (
              <Section
                items={suggestions}
                statusOptions={SUGGESTION_STATUSES}
                renderRow={(s) => <SuggestionRow key={s.id} suggestion={s} onUpdate={updateSuggestion} onDelete={deleteSuggestion} />}
                emptyText="No feedback yet."
                storageKey="admin_groupby_suggestions"
              />
            )}
            {activeTab === "contacts" && (
              <Section
                items={contacts}
                statusOptions={CONTACT_STATUSES}
                renderRow={(c) => <ContactRow key={c.id} submission={c} onUpdate={updateContact} onDelete={deleteContact} />}
                emptyText="No contact messages yet."
                storageKey="admin_groupby_contacts"
              />
            )}
            {activeTab === "analytics" && (
              <AnalyticsTab
                summary={analyticsSummary}
                timeseries={analyticsTimeseries}
                loading={analyticsLoading}
                onFetch={fetchAnalytics}
                users={analyticsUsers}
                usersLoading={analyticsUsersLoading}
                onFetchUsers={fetchAnalyticsUsers}
                adminId={adminId}
                lockedCount={lockedUsersCount}
                usageUsers={usageUsers}
                usageLoading={usageLoading}
                onFetchUsage={fetchUsageUsers}
              />
            )}
            {activeTab === "plans" && (
              <PlansTab users={allUsers} usersLoading={usersLoading} />
            )}
            {activeTab === "alerts" && (
              <SystemAlertsTab
                alerts={systemAlerts}
                loading={alertsLoading}
                onRefresh={fetchSystemAlerts}
              />
            )}
            {activeTab === "errors" && (
              <ErrorTrackingTab
                connErrors={connErrors}
                lookupErrors={lookupErrors}
                securityErrors={securityErrors}
                loading={errorsLoading}
                onRefresh={fetchErrors}
              />
            )}
            {activeTab === "users" && (
              <UsersTab
                users={allUsers}
                loading={usersLoading}
                onAction={handleUserAction}
                adminId={adminId}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
