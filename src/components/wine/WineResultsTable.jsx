// @ts-nocheck
import React, { useState, useEffect, useCallback } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ExternalLink, Loader2, Download, Settings2, GripVertical,
  Check, X, Pencil, Trash2, Plus, Calculator, RefreshCw, Copy,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { getExchangeRates, convertAmount, getRate } from "@/lib/exchangeRates";
import { getApiBase } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Tab IDs used for per-tab config. */
const ALL_TAB_IDS = ["single", "list", "image", "file", "default"];

/** Storage keys. */
const GLOBAL_KEY = "wine_table_global_v2";
const TAB_KEY    = (tabId) => `wine_table_tab_v2_${tabId}`;

/** Built-in column definitions (id + label). Currency columns hidden by default. */
const BUILT_IN_COLUMNS = [
  { id: "size",           label: "Size" },
  { id: "vintage",        label: "Vintage" },
  { id: "wine",           label: "Wine" },
  { id: "ct_avg",         label: "CT Avg Value" },
  { id: "ct_auction",     label: "CT Auction Avg" },
  { id: "ct_currency",    label: "CT Currency" },    // hidden by default
  { id: "ws_avg",         label: "WS Avg Price" },
  { id: "ws_min",         label: "WS Min Price" },
  { id: "ws_currency",    label: "WS Currency" },
  { id: "matched",        label: "Matched As" },
  { id: "status",         label: "Status" },
  // { id: "lookup_source",  label: "Source" },
  { id: "offer",          label: "Offer" },
  { id: "offer_currency", label: "Offer Currency" }, // hidden by default
];
const BUILT_IN_IDS   = new Set(BUILT_IN_COLUMNS.map(c => c.id));
const DEFAULT_HIDDEN = new Set(["ct_currency", "offer_currency"]); // hidden by default for new configs

/** Fields usable in calculated column formulas. */
const CALC_FIELDS = [
  { id: "ct_avg",     label: "CT Avg Value",   prop: "ct_avg",            curr: "ct"    },
  { id: "ct_auction", label: "CT Auction Avg",  prop: "ct_auction",        curr: "ct"    },
  { id: "ws_avg",     label: "WS Avg Price",    prop: "ws_avg",            curr: "ws"    },
  { id: "ws_min",     label: "WS Min Price",          prop: "ws_min",            curr: "ws"    },
  { id: "offer",      label: "Offer Price",     prop: "offer_price",       curr: "offer" },
  { id: "literal",    label: "Fixed Number",    prop: null,                curr: null    },
];

const OPERATORS = [
  { id: "-", label: "− Subtract" },
  { id: "+", label: "+ Add" },
  { id: "*", label: "× Multiply" },
  { id: "/", label: "÷ Divide" },
];

/** Tooltip definitions for built-in column headers. */
const COLUMN_TOOLTIPS = {
  ct_avg:     "Cellar Tracker Community Average Value",
  ct_auction: "Cellar Tracker Auction (Wine Market Journal)",
  ws_avg:     "Wine Searcher Avg Price (ex-tax)",
  ws_min:     "Wine Searcher Lowest listed price, could be the price of a single bottle, or a case of bottles",
};

/** Build a human-readable formula string for a calculated column tooltip. */
function formatFormula(col) {
  const leftDef  = CALC_FIELDS.find(f => f.id === col.leftField);
  const rightDef = CALC_FIELDS.find(f => f.id === col.rightField);
  const left  = col.leftField  === "literal" ? col.leftLiteral  : (leftDef?.label  || col.leftField);
  const right = col.rightField === "literal" ? col.rightLiteral : (rightDef?.label || col.rightField);
  const op = { "-": "−", "+": "+", "*": "×", "/": "÷" }[col.operator] || col.operator;
  return `${left} ${op} ${right}`;
}

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "CHF", "HKD", "SGD", "JPY"];
const CURRENCY_SYMBOLS = {
  USD: "US$", EUR: "EU€", GBP: "GB£", AUD: "AU$",  CAD: "CA$",
  CHF: "CHF", HKD: "HK$", SGD:  "SG$", JPY: "JP¥",
};

const RIGHT_ALIGNED  = new Set(["ct_avg", "ct_auction", "ws_avg", "ws_min", "offer"]);
const CENTER_ALIGNED = new Set(["status", "ct_currency", "ws_currency", "offer_currency"]);

const DEFAULT_CALC_DEF = {
  label: "",
  leftField:    "ct_avg",
  leftLiteral:  "",
  operator:     "-",
  rightField:   "offer",
  rightLiteral: "",
  forceCurrency: "auto",
};

// ─── Server helpers ───────────────────────────────────────────────────────────

async function fetchCalcColumnsFromServer() {
  try {
    const token = localStorage.getItem('app_access_token');
    if (!token) return null;
    const res = await fetch(`${getApiBase()}/user/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.calc_columns) ? data.calc_columns : null;
  } catch { return null; }
}

async function saveCalcColumnsToServer(calcColumns) {
  try {
    const token = localStorage.getItem('app_access_token');
    if (!token) return;
    await fetch(`${getApiBase()}/user/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ calc_columns: calcColumns }),
    });
  } catch {}
}

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

function loadGlobalConfig() {
  try {
    const raw = localStorage.getItem(GLOBAL_KEY);
    if (!raw) return { calcColumns: [] };
    const p = JSON.parse(raw);
    return { calcColumns: Array.isArray(p.calcColumns) ? p.calcColumns : [] };
  } catch { return { calcColumns: [] }; }
}

function saveGlobalConfig(calcColumns) {
  try { localStorage.setItem(GLOBAL_KEY, JSON.stringify({ calcColumns })); } catch {}
  saveCalcColumnsToServer(calcColumns);
}

function loadTabConfig(tabId, calcColumns) {
  try {
    const raw = localStorage.getItem(TAB_KEY(tabId));
    if (!raw) return null;
    const p   = JSON.parse(raw);
    const allCalcIds = (calcColumns || []).map(c => c.id);
    const existing   = new Set(Array.isArray(p.columnOrder) ? p.columnOrder : []);
    // Append any calc columns that were added after this tab config was last saved
    const missing = allCalcIds.filter(id => !existing.has(id));
    const order   = [...(p.columnOrder || []).filter(id =>
      BUILT_IN_IDS.has(id) || allCalcIds.includes(id)
    ), ...missing];
    return {
      columnOrder:   order,
      hiddenColumns: new Set(Array.isArray(p.hiddenColumns) ? p.hiddenColumns : []),
    };
  } catch { return null; }
}

function saveTabConfig(tabId, columnOrder, hiddenColumns) {
  try {
    localStorage.setItem(TAB_KEY(tabId), JSON.stringify({
      columnOrder,
      hiddenColumns: [...hiddenColumns],
    }));
  } catch {}
}

function defaultTabConfig(calcColumns) {
  const order  = [...BUILT_IN_COLUMNS.map(c => c.id), ...(calcColumns || []).map(c => c.id)];
  const hidden = new Set(DEFAULT_HIDDEN);
  return { columnOrder: order, hiddenColumns: hidden };
}

// ─── Price / currency helpers ─────────────────────────────────────────────────

/** Strip currency symbols / codes and parse float. Returns null if not a number. */
function parsePrice(str) {
  if (str === null || str === undefined || str === "" || str === "—") return null;
  const s = String(str)
    .replace(/[A-Z]{2,3}\s*/g, "")   // strip USD, EUR, HKD etc.
    .replace(/[A-a]\$/g, "")         // strip A$, S$, C$, HK$
    .replace(/[$€£¥]/g, "")
    .replace(/Fr\s*/g, "")
    .replace(/,/g, "")
    .trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** Returns the currency for a calc field given the current wine row. */
function getFieldCurrency(wine, fieldDef) {
  if (!fieldDef || fieldDef.id === "literal") return null;
  if (fieldDef.curr === "ct")    return wine?.ct_currency || "USD";
  if (fieldDef.curr === "ws")    return wine?.ws_currency || "USD";
  if (fieldDef.curr === "offer") return wine?.offer_price_currency || "USD";
  return null;
}

/**
 * Evaluate a calculated column formula against a wine row.
 * Returns { value: number|null, currency: string|null, ratesMissing: bool }
 */
function evaluateCalcColumn(wine, col, rates) {
  const leftDef  = CALC_FIELDS.find(f => f.id === col.leftField);
  const rightDef = CALC_FIELDS.find(f => f.id === col.rightField);

  // Raw numeric values
  const leftRaw  = col.leftField === "literal"  ? col.leftLiteral  : wine[leftDef?.prop];
  const rightRaw = col.rightField === "literal" ? col.rightLiteral : wine[rightDef?.prop];
  const leftVal  = parsePrice(leftRaw);
  const rightVal = parsePrice(rightRaw);

  if (leftVal === null || rightVal === null) return { value: null, currency: null, ratesMissing: false };

  // Source currencies
  const leftCurr  = getFieldCurrency(wine, leftDef);
  const rightCurr = getFieldCurrency(wine, rightDef);

  // Target (result/display) currency
  let targetCurr;
  if (col.forceCurrency === "none") {
    targetCurr = null;
  } else if (col.forceCurrency && col.forceCurrency !== "auto") {
    targetCurr = col.forceCurrency;
  } else {
    targetCurr = leftCurr || rightCurr || null;
  }

  // Convert both values to target currency
  let leftConverted  = leftVal;
  let rightConverted = rightVal;
  let ratesMissing   = false;

  if (targetCurr) {
    if (leftCurr && leftCurr !== targetCurr) {
      const c = convertAmount(leftVal, leftCurr, targetCurr, rates);
      if (c === null) ratesMissing = true;
      else leftConverted = c;
    }
    if (rightCurr && rightCurr !== targetCurr) {
      const c = convertAmount(rightVal, rightCurr, targetCurr, rates);
      if (c === null) ratesMissing = true;
      else rightConverted = c;
    }
  }

  if (ratesMissing) return { value: null, currency: targetCurr, ratesMissing: true };

  let result;
  switch (col.operator) {
    case "+": result = leftConverted + rightConverted; break;
    case "-": result = leftConverted - rightConverted; break;
    case "*": result = leftConverted * rightConverted; break;
    case "/": result = rightConverted !== 0 ? leftConverted / rightConverted : null; break;
    default:  result = null;
  }

  return { value: result, currency: targetCurr, ratesMissing: false };
}

function formatCalcValue(value, currency, ratesMissing) {
  if (ratesMissing) return "—";
  if (value === null || value === undefined || isNaN(value)) return null;
  const sym = currency ? (CURRENCY_SYMBOLS[currency] || (currency + " ")) : "";
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "−" : ""}${sym}${formatted}`;
}

// ─── CalcColumnDialog ─────────────────────────────────────────────────────────

function CalcColumnDialog({ open, onClose, onSave, initial, sampleWine, rates, ratesLoading }) {
  const [form, setForm] = useState(initial || DEFAULT_CALC_DEF);
  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  React.useEffect(() => {
    if (open) setForm(initial || DEFAULT_CALC_DEF);
  }, [open, initial]);

  const leftDef  = CALC_FIELDS.find(f => f.id === form.leftField);
  const rightDef = CALC_FIELDS.find(f => f.id === form.rightField);

  // Detected currencies (using sample wine if available; CT/WS default to USD if no sample)
  const lc = sampleWine ? getFieldCurrency(sampleWine, leftDef)
    : (leftDef?.curr === "ct" || leftDef?.curr === "ws") ? "USD" : null;
  const rc = sampleWine ? getFieldCurrency(sampleWine, rightDef)
    : (rightDef?.curr === "ct" || rightDef?.curr === "ws") ? "USD" : null;
  const hasMismatch = lc && rc && lc !== rc;

  // Target currency for preview
  const targetCurr = form.forceCurrency === "none" ? null
    : (form.forceCurrency && form.forceCurrency !== "auto") ? form.forceCurrency
    : (lc || rc || null);

  // Live rate display when currencies differ
  let rateDisplay = null;
  if (hasMismatch && rates) {
    const r = getRate(rc, lc, rates); // 1 rc = X lc
    rateDisplay = r ? `1 ${rc} ≈ ${r.toFixed(4)} ${lc}` : null;
    // If target differs from lc/rc, also show those conversions
    if (targetCurr && targetCurr !== lc) {
      const r2 = getRate(rc, targetCurr, rates);
      rateDisplay = r2 ? `1 ${rc} ≈ ${r2.toFixed(4)} ${targetCurr}` : rateDisplay;
    }
  }

  // Live preview
  const preview = sampleWine
    ? evaluateCalcColumn(sampleWine, form, rates)
    : null;
  const previewStr = preview ? formatCalcValue(preview.value, preview.currency, preview.ratesMissing) : null;

  const handleSave = () => {
    if (!form.label.trim()) return;
    onSave(form);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={isOpen => !isOpen && onClose()}>
      <DialogContent className="max-w-md dark:bg-gray-900 dark:border-gray-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-[#800020]" />
            {initial?.id ? "Edit Calculated Column" : "Add Calculated Column"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Column Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Column Name</Label>
            <Input
              value={form.label}
              onChange={e => set("label", e.target.value)}
              placeholder="e.g. CT Avg − Offer"
              className="dark:bg-gray-800 dark:border-gray-700"
            />
          </div>

          {/* Formula builder */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Formula</Label>

            {/* Left operand */}
            <div className="flex gap-2">
              <Select value={form.leftField} onValueChange={v => set("leftField", v)}>
                <SelectTrigger className="flex-1 text-sm dark:bg-gray-800 dark:border-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="dark:bg-gray-900 dark:border-gray-700">
                  {CALC_FIELDS.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {form.leftField === "literal" && (
                <Input
                  value={form.leftLiteral}
                  onChange={e => set("leftLiteral", e.target.value)}
                  placeholder="0.00"
                  className="w-24 text-sm text-right dark:bg-gray-800 dark:border-gray-700"
                />
              )}
            </div>

            {/* Operator */}
            <Select value={form.operator} onValueChange={v => set("operator", v)}>
              <SelectTrigger className="text-sm dark:bg-gray-800 dark:border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="dark:bg-gray-900 dark:border-gray-700">
                {OPERATORS.map(op => <SelectItem key={op.id} value={op.id}>{op.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Right operand */}
            <div className="flex gap-2">
              <Select value={form.rightField} onValueChange={v => set("rightField", v)}>
                <SelectTrigger className="flex-1 text-sm dark:bg-gray-800 dark:border-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="dark:bg-gray-900 dark:border-gray-700">
                  {CALC_FIELDS.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {form.rightField === "literal" && (
                <Input
                  value={form.rightLiteral}
                  onChange={e => set("rightLiteral", e.target.value)}
                  placeholder="0.00"
                  className="w-24 text-sm text-right dark:bg-gray-800 dark:border-gray-700"
                />
              )}
            </div>
          </div>

          {/* Result Currency selector */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Result Currency</Label>
            <Select value={form.forceCurrency} onValueChange={v => set("forceCurrency", v)}>
              <SelectTrigger className="text-sm dark:bg-gray-800 dark:border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="dark:bg-gray-900 dark:border-gray-700">
                <SelectItem value="auto">Auto (from left field)</SelectItem>
                <SelectItem value="none">None (plain number)</SelectItem>
                {CURRENCIES.map(c => (
                  <SelectItem key={c} value={c}>{c} ({CURRENCY_SYMBOLS[c]})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Currency info + live rate */}
          {(lc || rc) && (
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-2 space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold">Currency Detection</p>
                {ratesLoading && <Loader2 className="w-3 h-3 text-gray-400 animate-spin" />}
                {rates && !ratesLoading && <span className="text-[11px] text-emerald-600 dark:text-emerald-400"></span>}
                {!rates && !ratesLoading && <span className="text-[11px] text-amber-600">Rates unavailable</span>}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                {lc && <p>Left field: <span className="font-medium">{lc}</span></p>}
                {rc && <p>Right field: <span className="font-medium">{rc}</span></p>}
                {targetCurr && <p>Result currency: <span className="font-medium">{targetCurr}</span></p>}
                {hasMismatch && rateDisplay && (
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
                    Exchange rate applied: {rateDisplay}
                  </p>
                )}
                {hasMismatch && !rates && !ratesLoading && (
                  <p className="text-[11px] text-amber-600">
                    Cannot convert currencies — exchange rate unavailable. Results will show —.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Live preview */}
          {sampleWine && (
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-2">
              <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">Preview (first result)</p>
              {ratesLoading && !rates ? (
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading exchange rates…
                </p>
              ) : (
                <p className={`text-sm font-mono tabular-nums font-medium ${
                  previewStr
                    ? (preview?.value < 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white")
                    : "text-gray-400"
                }`}>
                  {previewStr ?? (preview?.ratesMissing ? "—" : "— (no data)")}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="dark:border-gray-700 dark:text-gray-300">Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={!form.label.trim()}
            className="bg-[#800020] hover:bg-[#6b001b] text-white"
          >
            {initial?.id ? "Save Changes" : "Add Column"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WineResultsTable({
  results,
  onUpdateOfferPrice,
  onUpdateOfferCurrency,
  onUpdateCtCurrency,
  onDelete,
  onClear,
  highlightBatchId,
  filenamePrefix,
  downloadFilename,
}) {
  const tabId = filenamePrefix || "default";

  // ── Exchange rates ───────────────────────────────────────────────────────
  const [rates, setRates]             = useState(null);
  const [ratesLoading, setRatesLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setRatesLoading(true);
    getExchangeRates().then(r => {
      if (alive) { setRates(r); setRatesLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  // ── Config from storage ──────────────────────────────────────────────────
  const [calcColumns,   setCalcColumns]   = useState(() => loadGlobalConfig().calcColumns);
  const [columnOrder,   setColumnOrder]   = useState(() => {
    const global = loadGlobalConfig();
    const tab    = loadTabConfig(tabId, global.calcColumns);
    return tab ? tab.columnOrder : defaultTabConfig(global.calcColumns).columnOrder;
  });
  const [hiddenColumns, setHiddenColumns] = useState(() => {
    const global = loadGlobalConfig();
    const tab    = loadTabConfig(tabId, global.calcColumns);
    return tab ? tab.hiddenColumns : defaultTabConfig(global.calcColumns).hiddenColumns;
  });

  // Load calc columns from server on mount — server is source of truth.
  // Merges with localStorage so column order / visibility per tab is preserved.
  useEffect(() => {
    fetchCalcColumnsFromServer().then(serverCols => {
      if (!serverCols) return;
      saveGlobalConfig(serverCols);
      setCalcColumns(serverCols);
      setColumnOrder(prev => {
        const existing = new Set(prev);
        const missing = serverCols.map(c => c.id).filter(id => !existing.has(id));
        return missing.length ? [...prev, ...missing] : prev;
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── UI state ─────────────────────────────────────────────────────────────
  const [editingOffer,  setEditingOffer]  = useState(null);
  const [offerValue,    setOfferValue]    = useState("");
  const [deleteTarget,  setDeleteTarget]  = useState(null);
  const [calcDialogOpen, setCalcDialogOpen] = useState(false);
  const [editingCalcCol, setEditingCalcCol] = useState(null);

  const visibleResults = (results || []).filter(w => !w.is_deleted);
  const sampleWine     = visibleResults[0] || null;

  if (visibleResults.length === 0) return null;

  // ── All columns (built-in + calc) ───────────────────────────────────────
  const allColumns = [
    ...BUILT_IN_COLUMNS,
    ...calcColumns.map(c => ({ id: c.id, label: c.label, isCalc: true })),
  ];
  const getColumnLabel = (id) => allColumns.find(c => c.id === id)?.label || id;

  // ── Persistence ──────────────────────────────────────────────────────────

  const persistTab = useCallback((order, hidden) => {
    saveTabConfig(tabId, order, hidden);
  }, [tabId]);

  // ── Calc column CRUD ────────────────────────────────────────────────────

  const handleSaveCalcColumn = (formData) => {
    if (editingCalcCol?.id) {
      // Update existing
      const updated = calcColumns.map(c =>
        c.id === editingCalcCol.id ? { ...formData, id: editingCalcCol.id } : c
      );
      setCalcColumns(updated);
      saveGlobalConfig(updated);
      persistTab(columnOrder, hiddenColumns);
    } else {
      // Add new — append to all tabs
      const newCol         = { ...formData, id: `calc_${Date.now()}` };
      const updatedCalc    = [...calcColumns, newCol];
      const updatedOrder   = [...columnOrder, newCol.id];
      saveGlobalConfig(updatedCalc);
      // Append to every other tab's saved config
      ALL_TAB_IDS.forEach(tid => {
        const cfg = loadTabConfig(tid, calcColumns);
        if (cfg && tid !== tabId) {
          saveTabConfig(tid, [...cfg.columnOrder, newCol.id], cfg.hiddenColumns);
        }
      });
      setCalcColumns(updatedCalc);
      setColumnOrder(updatedOrder);
      persistTab(updatedOrder, hiddenColumns);
    }
  };

  const removeCalcColumn = (colId) => {
    const updatedCalc    = calcColumns.filter(c => c.id !== colId);
    const updatedOrder   = columnOrder.filter(id => id !== colId);
    const updatedHidden  = new Set([...hiddenColumns].filter(id => id !== colId));
    saveGlobalConfig(updatedCalc);
    // Remove from every tab
    ALL_TAB_IDS.forEach(tid => {
      const cfg = loadTabConfig(tid, calcColumns);
      if (cfg) {
        saveTabConfig(
          tid,
          cfg.columnOrder.filter(id => id !== colId),
          new Set([...cfg.hiddenColumns].filter(id => id !== colId))
        );
      }
    });
    setCalcColumns(updatedCalc);
    setColumnOrder(updatedOrder);
    setHiddenColumns(updatedHidden);
  };

  // ── Column layout helpers ────────────────────────────────────────────────

  const onDragEnd = ({ source, destination }) => {
    if (!destination) return;
    const newOrder = [...columnOrder];
    const [moved] = newOrder.splice(source.index, 1);
    newOrder.splice(destination.index, 0, moved);
    setColumnOrder(newOrder);
    persistTab(newOrder, hiddenColumns);
  };

  const toggleColumn = (id) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      persistTab(columnOrder, next);
      return next;
    });
  };

  const applyToAllTabs = () => {
    ALL_TAB_IDS.forEach(tid => saveTabConfig(tid, columnOrder, hiddenColumns));
  };

  const visibleColumns = columnOrder.filter(id => !hiddenColumns.has(id));

  // ── Offer price/currency helpers ─────────────────────────────────────────

  const saveOffer = (id) => {
    onUpdateOfferPrice?.(id, offerValue);
    setEditingOffer(null);
    setOfferValue("");
  };

  const getMatchedName = (wine) => {
    if (wine.matched_as && typeof wine.matched_as === "string" && wine.matched_as.trim())
      return wine.matched_as.trim();
    return null;
  };

  // ── CSV export ────────────────────────────────────────────────────────────

  const exportToCSV = () => {
    const exportColIds = columnOrder.filter(id => id !== "status");
    const headers      = exportColIds.map(id => getColumnLabel(id));
    headers.push("Searched Date");

    const getVal = (wine, colId) => {
      if (!BUILT_IN_IDS.has(colId)) {
        const col = calcColumns.find(c => c.id === colId);
        if (!col) return "";
        const { value, currency, ratesMissing } = evaluateCalcColumn(wine, col, rates);
        if (ratesMissing) return "(rate unavailable)";
        if (value === null) return "";
        const sym = currency ? (CURRENCY_SYMBOLS[currency] || "") : "";
        return `${value < 0 ? "-" : ""}${sym}${Math.abs(value).toFixed(2)}`;
      }
      switch (colId) {
        case "size":           return wine.size || "";
        case "vintage":        return wine.vintage || "";
        case "wine":           return wine.wine_name || "";
        case "ct_avg":         return wine.ct_avg || "";
        case "ct_auction":     return wine.ct_auction || "";
        case "ct_currency":    return wine.ct_currency || "USD";
        case "ws_avg":         return wine.ws_avg || "";
        case "ws_min":         return wine.ws_min || "";
        case "ws_currency":    return wine.ws_currency || "USD";
        case "offer":          return wine.offer_price || "";
        case "offer_currency": return wine.offer_price_currency || "USD";
        // case "lookup_source": return wine.lookup_source === "extension" ? "Extension" : wine.lookup_source === "server" ? "Server" : "";
        case "matched": {
          const name = getMatchedName(wine);
          const parts = [name].filter(Boolean);
          if (wine.ct_url) parts.push(`CT: ${wine.ct_url}`);
          if (wine.ws_url) parts.push(`WS: ${wine.ws_url}`);
          return parts.join(" | ");
        }
        default: return "";
      }
    };

    const rows = visibleResults.map(wine => {
      const vals = exportColIds.map(id => getVal(wine, id));
      vals.push(wine.created_date ? new Date(wine.created_date).toLocaleDateString() : "");
      return vals;
    });

    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const filename = downloadFilename || `${filenamePrefix || "wine"}_latest.csv`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  // ── Cell renderer ─────────────────────────────────────────────────────────

  const renderCell = (wine, colId) => {
    // ── Calculated column ──────────────────────────────────────────────────
    if (!BUILT_IN_IDS.has(colId)) {
      const col = calcColumns.find(c => c.id === colId);
      if (!col) return <TableCell key={colId} />;
      const { value, currency, ratesMissing } = evaluateCalcColumn(wine, col, rates);
      const str = formatCalcValue(value, currency, ratesMissing);
      return (
        <TableCell key={colId} className="text-right py-3">
          {ratesLoading && !rates ? (
            <Loader2 className="w-3 h-3 animate-spin text-gray-300 ml-auto" />
          ) : (
            <span className={`text-sm font-medium tabular-nums ${
              str === null || str === "—"
                ? "text-gray-400"
                : value !== null && value < 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-gray-900 dark:text-white"
            }`}>
              {str ?? "—"}
            </span>
          )}
        </TableCell>
      );
    }

    // ── Built-in columns ────────────────────────────────────────────────────
    switch (colId) {
      case "size":
        return <TableCell key={colId} className="pl-4 py-3"><span className="text-sm text-gray-800 dark:text-gray-200">{wine.size || "—"}</span></TableCell>;

      case "vintage":
        return <TableCell key={colId} className="py-3"><span className="text-sm text-gray-800 dark:text-gray-200 font-mono">{wine.vintage || "—"}</span></TableCell>;

      case "wine":
        return (
          <TableCell key={colId} className="py-3 min-w-[180px]">
            <p className="font-medium text-gray-900 dark:text-white text-[14px] leading-tight">{wine.wine_name}</p>
          </TableCell>
        );

      case "ct_avg": {
        const ctErr = wine.ct_error;
        const ctStatus = ctErr === "not enabled" || ctErr === "no connection" ? ctErr
          : (ctErr === "not paid account" || ctErr?.includes("could not parse pricing") || ctErr?.includes("subscription required")) ? "not paid account"
          : null;
        return <TableCell key={colId} className="text-right py-3">{ctStatus ? <span className="text-xs text-gray-400 italic">{ctStatus}</span> : <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{wine.ct_avg || "—"}</span>}</TableCell>;
      }

      case "ct_auction": {
        const ctErr = wine.ct_error;
        const ctStatus = ctErr === "not enabled" || ctErr === "no connection" ? ctErr
          : (ctErr === "not paid account" || ctErr?.includes("could not parse pricing") || ctErr?.includes("subscription required")) ? "not paid account"
          : null;
        return <TableCell key={colId} className="text-right py-3">{ctStatus ? <span className="text-xs text-gray-400 italic">{ctStatus}</span> : <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{wine.ct_auction || "—"}</span>}</TableCell>;
      }

      case "ws_avg": {
        const wsStatus = wine.ws_error === "not enabled" || wine.ws_error === "no connection" ? wine.ws_error : null;
        return <TableCell key={colId} className="text-right py-3">{wsStatus ? <span className="text-xs text-gray-400 italic">{wsStatus}</span> : <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{wine.ws_avg || "—"}</span>}</TableCell>;
      }

      case "ws_min": {
        const wsStatus = wine.ws_error === "not enabled" || wine.ws_error === "no connection" ? wine.ws_error : null;
        return <TableCell key={colId} className="text-right py-3">{wsStatus ? <span className="text-xs text-gray-400 italic">{wsStatus}</span> : <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{wine.ws_min || "—"}</span>}</TableCell>;
      }

      case "ct_currency":
        return (
          <TableCell key={colId} className="text-center py-3" onClick={e => e.stopPropagation()}>
            <select
              value={wine.ct_currency || "USD"}
              onChange={e => onUpdateCtCurrency?.(wine.id, e.target.value)}
              disabled={!onUpdateCtCurrency}
              className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-800 dark:text-gray-200 cursor-pointer disabled:cursor-default disabled:opacity-60"
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </TableCell>
        );

      case "ws_currency":
        return (
          <TableCell key={colId} className="text-center py-3">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{wine.ws_currency || "USD"}</span>
          </TableCell>
        );

      case "offer_currency":
        return (
          <TableCell key={colId} className="text-center py-3" onClick={e => e.stopPropagation()}>
            <select
              value={wine.offer_price_currency || "USD"}
              onChange={e => onUpdateOfferCurrency?.(wine.id, e.target.value)}
              disabled={!onUpdateOfferCurrency}
              className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-800 dark:text-gray-200 cursor-pointer disabled:cursor-default disabled:opacity-60"
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </TableCell>
        );

      case "offer":
        return (
          <TableCell key={colId} className="text-right py-3" onClick={e => e.stopPropagation()}>
            {editingOffer === wine.id ? (
              <div className="flex items-center gap-1 justify-end">
                <Input value={offerValue} onChange={e => setOfferValue(e.target.value)} placeholder="0"
                  className="w-20 h-7 text-sm text-right dark:bg-gray-800 dark:border-gray-700" autoFocus
                  onKeyDown={e => e.key === "Enter" && saveOffer(wine.id)} />
                <button onClick={() => saveOffer(wine.id)} className="text-emerald-600 hover:text-emerald-700"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => setEditingOffer(null)} className="text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => { setEditingOffer(wine.id); setOfferValue(wine.offer_price || ""); }}
                className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
                {wine.offer_price ? (
                  <span className="font-medium text-gray-900 dark:text-white tabular-nums">
                    {(() => {
                      const sym = CURRENCY_SYMBOLS[wine.offer_price_currency] || "US$";
                      const num = parsePrice(wine.offer_price);
                      return num !== null
                        ? `${sym}${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : `${sym}${wine.offer_price}`;
                    })()}
                  </span>
                ) : <><Pencil className="w-3 h-3" /><span className="text-xs">Add</span></>}
              </button>
            )}
          </TableCell>
        );

      case "status":
        return (
          <TableCell key={colId} className="text-center py-3">
            {wine.status === "pending"
              ? <Loader2 className="w-4 h-4 text-gray-300 animate-spin mx-auto" />
              : wine.status === "completed"
                ? <Badge variant="secondary" className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-0 text-[11px]">Done</Badge>
                : <Badge variant="secondary" className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-0 text-[11px]">Error</Badge>}
          </TableCell>
        );

      // case "lookup_source":
      //   return (
      //     <TableCell key={colId} className="text-center py-3">
      //       {wine.lookup_source === "extension"
      //         ? <Badge variant="secondary" className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-0 text-[11px]">Extension</Badge>
      //         : wine.lookup_source === "server"
      //           ? <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-0 text-[11px]">Server</Badge>
      //           : <span className="text-sm text-gray-400">—</span>}
      //     </TableCell>
      //   );

      case "matched": {
        const matchedName = getMatchedName(wine);
        return (
          <TableCell key={colId} className="pr-4 py-3" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-0.5">
              {matchedName && <span className="text-sm text-gray-700 dark:text-gray-300 line-clamp-1 max-w-[180px]">{matchedName}</span>}
              <div className="flex items-center gap-2">
                {wine.ct_url && (
                  <a href={wine.ct_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-xs text-[#800020] hover:text-[#6b001b] hover:underline underline-offset-2">
                    CT <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
                {wine.ws_url && (
                  <a href={wine.ws_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-800 hover:underline underline-offset-2">
                    WS <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
                {!wine.ct_url && !wine.ws_url && !matchedName && <span className="text-sm text-gray-400">—</span>}
              </div>
            </div>
          </TableCell>
        );
      }

      default: return null;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 gap-2 flex-wrap">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs border-gray-200 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <Settings2 className="w-3 h-3" /> Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2 dark:bg-gray-900 dark:border-gray-700" align="start">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 pb-2">Drag to reorder</p>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="cols">
                {(prov) => (
                  <div ref={prov.innerRef} {...prov.droppableProps} className="space-y-0.5">
                    {columnOrder.map((colId, idx) => {
                      const col    = allColumns.find(c => c.id === colId);
                      const hidden = hiddenColumns.has(colId);
                      const isCalc = col?.isCalc;
                      return (
                        <Draggable key={colId} draggableId={colId} index={idx}>
                          {(drag) => (
                            <div ref={drag.innerRef} {...drag.draggableProps}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 group">
                              <span {...drag.dragHandleProps} className="cursor-grab text-gray-300 dark:text-gray-600">
                                <GripVertical className="w-3.5 h-3.5" />
                              </span>
                              <button onClick={() => toggleColumn(colId)}
                                className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${hidden ? "border-gray-300 dark:border-gray-600" : "bg-[#800020] border-[#800020]"}`}>
                                {!hidden && <Check className="w-2.5 h-2.5 text-white" />}
                              </button>
                              <span className={`text-xs flex-1 min-w-0 truncate ${hidden ? "text-gray-400 dark:text-gray-600" : "text-gray-700 dark:text-gray-300"}`}>
                                {isCalc && <Calculator className="w-2.5 h-2.5 inline mr-1 opacity-50" />}
                                {col?.label}
                              </span>
                              {isCalc && (
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => { setEditingCalcCol(calcColumns.find(c => c.id === colId)); setCalcDialogOpen(true); }}
                                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-0.5">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => removeCalcColumn(colId)} className="text-gray-400 hover:text-red-600 p-0.5">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {prov.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            {/* Footer actions */}
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 space-y-0.5 px-2">
              <button
                onClick={() => { setEditingCalcCol(null); setCalcDialogOpen(true); }}
                className="w-full flex items-center gap-1.5 text-xs text-[#800020] hover:text-[#6b001b] dark:text-[#cc4466] font-medium py-1 transition-colors">
                <Plus className="w-3 h-3" /> Add Calculated Column
              </button>
              <button
                onClick={applyToAllTabs}
                className="w-full flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 py-1 transition-colors">
                <Copy className="w-3 h-3" /> Apply layout to all tabs
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-1.5">
          {ratesLoading && (
            <span className="flex items-center gap-1 text-[11px] text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Rates
            </span>
          )}
          {rates && !ratesLoading && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-500"></span>
          )}
          <Button variant="outline" size="sm" onClick={exportToCSV}
            className="gap-1.5 text-xs border-gray-200 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            <Download className="w-3 h-3" /> Export CSV
          </Button>
          {onClear && (
            <Button variant="outline" size="sm" onClick={onClear}
              className="gap-1.5 text-xs border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              <Trash2 className="w-3 h-3" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the wine lookup. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (deleteTarget) onDelete(deleteTarget); setDeleteTarget(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Table */}
      <div className="overflow-x-auto">
        <TooltipProvider delayDuration={300}>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#800020] border-b border-[#6b001b] hover:bg-[#800020]">
              {visibleColumns.map((colId, i) => {
                const isCalc = !BUILT_IN_IDS.has(colId);
                const tooltipText = COLUMN_TOOLTIPS[colId]
                  || (isCalc ? formatFormula(calcColumns.find(c => c.id === colId) || {}) : null);
                return (
                  <TableHead key={colId}
                    className={`text-xs font-semibold text-white/90 uppercase tracking-wider whitespace-nowrap
                      ${i === 0 ? "pl-4" : ""}
                      ${RIGHT_ALIGNED.has(colId) || isCalc ? "text-right" : ""}
                      ${CENTER_ALIGNED.has(colId) ? "text-center" : ""}`}>
                    {tooltipText ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help border-b border-dashed border-white/40 pb-px">
                            {getColumnLabel(colId)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[220px] text-center leading-snug">
                          {tooltipText}
                        </TooltipContent>
                      </Tooltip>
                    ) : getColumnLabel(colId)}
                  </TableHead>
                );
              })}
              {onDelete && (
                <TableHead className="text-xs font-semibold text-white/90 uppercase tracking-wider whitespace-nowrap pr-4 text-right">
                  Delete
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleResults.map(wine => (
              <React.Fragment key={wine.id}>
                <TableRow className={`border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/40 transition-colors ${highlightBatchId && wine.batch_id === highlightBatchId ? "bg-yellow-50 dark:bg-yellow-900/30" : ""}`}>
                  {visibleColumns.map(colId => renderCell(wine, colId))}
                  {onDelete && (
                    <TableCell className="pr-4 py-3 text-right">
                      <button onClick={e => { e.stopPropagation(); setDeleteTarget(wine.id); }}
                        className="inline-flex items-center justify-center h-6 w-6 rounded border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </TableCell>
                  )}
                </TableRow>
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
        </TooltipProvider>
      </div>

      {/* Calculated column dialog */}
      <CalcColumnDialog
        open={calcDialogOpen}
        onClose={() => { setCalcDialogOpen(false); setEditingCalcCol(null); }}
        onSave={handleSaveCalcColumn}
        initial={editingCalcCol}
        sampleWine={sampleWine}
        rates={rates}
        ratesLoading={ratesLoading}
      />
    </div>
  );
}
