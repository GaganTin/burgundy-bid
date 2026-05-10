import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Trash2, Download } from "lucide-react";
import WineResultsTable from "@/components/wine/WineResultsTable";
import { format, isToday, isThisMonth } from "date-fns";

function getMonthKey(dateStr) {
  return format(new Date(dateStr), "MMMM yyyy");
}

function getMatchedName(wine) {
  if (wine.matched_as && typeof wine.matched_as === 'string' && wine.matched_as.trim()) return wine.matched_as.trim();
  return null;
}

function exportToCSV(wines, filename, includeDate = false) {
  const headers = ["Size", "Vintage", "Wine", "CT Avg Value", "CT Auction Avg", "WS Avg Price", "WS Min Price", "WS Currency", "Matched As", "Offer"];
  if (includeDate) headers.push("Searched Date");
  const rows = (wines || []).filter(w => !w.is_deleted).map(w => {
    const matchedName = getMatchedName(w);
    const matchedCell = matchedName ? (w.ct_url ? `${matchedName} (${w.ct_url})` : matchedName) : "";
    const row = [w.size, w.vintage, w.wine_name, w.ct_avg, w.ct_auction, w.ws_avg, w.ws_min, w.ws_currency || "USD", matchedCell, w.offer_price];
    if (includeDate) row.push(w.created_date ? new Date(w.created_date).toLocaleDateString() : "");
    return row.map(v => `"${(v || "").toString().replace(/"/g, '""')}"`).join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function CollapsibleBatch({ label, wines, onClear, onUpdateOfferPrice, onUpdateOfferCurrency, onUpdateCtCurrency, onDeleteRow, highlightBatchId, defaultOpen = false, prefix = 'history', downloadFilename }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
          <span className="text-xs text-gray-400">({wines.length} wines)</span>
        </div>
      </div>
      {open && (
        <div className="p-0">
          <WineResultsTable
            results={wines}
            onUpdateOfferPrice={onUpdateOfferPrice}
            onUpdateOfferCurrency={onUpdateOfferCurrency}
            onUpdateCtCurrency={onUpdateCtCurrency}
            onDelete={onDeleteRow}
            onClear={onClear}
            highlightBatchId={highlightBatchId}
            filenamePrefix={prefix}
            downloadFilename={downloadFilename}
          />
        </div>
      )}
    </div>
  );
}

// Groups: Today (all in one), This Month (each batch separately), older grouped by Month-Year DESC
export default function BatchHistorySection({ batches, onClearBatch, onClearAll, onUpdateOfferPrice, onUpdateOfferCurrency, onUpdateCtCurrency, onDeleteRow, latestBatchId, prefix = 'full' }) {
  if (!batches || batches.length === 0) return null;

  // Today's batches (merged into one group)
  const todayBatches = batches.filter(b => isToday(new Date(b.date)));
  const todayWines = todayBatches.flatMap(b => b.wines);

  // This month but NOT today
  const thisMonthNotToday = batches.filter(b => isThisMonth(new Date(b.date)) && !isToday(new Date(b.date)));

  // Older than this month
  const olderBatches = batches.filter(b => !isThisMonth(new Date(b.date)));

  // Group older by month-year
  const olderByMonth = {};
  olderBatches.forEach(b => {
    const key = getMonthKey(b.date);
    if (!olderByMonth[key]) olderByMonth[key] = [];
    olderByMonth[key].push(b);
  });
  const sortedMonthKeys = Object.keys(olderByMonth).sort((a, b) => new Date(b) - new Date(a));

  const allHistoryWines = batches.flatMap(b => b.wines);

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            onClick={() => exportToCSV(allHistoryWines, `${prefix}_full_history.csv`, true)}
            className="text-gray-400 hover:text-blue-500 gap-1.5 text-xs h-7"
          >
            <Download className="w-3 h-3" /> Export All CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={onClearAll} className="text-gray-400 hover:text-red-500 gap-1.5 text-xs h-7">
            <Trash2 className="w-3 h-3" /> Clear All History
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {/* Today — all merged into one group */}
        {todayWines.length > 0 && (
          <CollapsibleBatch
            label="Today"
            wines={todayWines}
            onClear={() => todayBatches.forEach(b => onClearBatch(b.id))}
            onUpdateOfferPrice={onUpdateOfferPrice}
            onUpdateOfferCurrency={onUpdateOfferCurrency}
            onUpdateCtCurrency={onUpdateCtCurrency}
            onDeleteRow={onDeleteRow}
            highlightBatchId={latestBatchId}
            defaultOpen={false}
            prefix={prefix}
            downloadFilename={`${prefix}_today_${format(new Date(), 'yyyy_MM_dd')}.csv`}
          />
        )}

        {/* This month (not today) — grouped by Month-Year */}
        {thisMonthNotToday.length > 0 && (() => {
          const allWines = thisMonthNotToday.flatMap(b => b.wines);
          const label = format(new Date(thisMonthNotToday[0].date), "MMMM yyyy");
          const filename = `${prefix}_${label.replace(/\s+/g, '_')}.csv`;
          return (
            <CollapsibleBatch
              key="this-month"
              label={label}
              wines={allWines}
              onClear={() => thisMonthNotToday.forEach(b => onClearBatch(b.id))}
              onUpdateOfferPrice={onUpdateOfferPrice}
              onUpdateOfferCurrency={onUpdateOfferCurrency}
              onUpdateCtCurrency={onUpdateCtCurrency}
              onDeleteRow={onDeleteRow}
              highlightBatchId={latestBatchId}
              defaultOpen={false}
              prefix={prefix}
              downloadFilename={filename}
            />
          );
        })()}

        {/* Older months grouped by Month-Year */}
        {sortedMonthKeys.map(monthKey => {
          const monthBatches = olderByMonth[monthKey];
          const allWines = monthBatches.flatMap(b => b.wines);
          const filename = `${prefix}_${monthKey.replace(/\s+/g, '_')}.csv`;
          return (
            <CollapsibleBatch
              key={monthKey}
              label={monthKey}
              wines={allWines}
              onClear={() => monthBatches.forEach(b => onClearBatch(b.id))}
              onUpdateOfferPrice={onUpdateOfferPrice}
              onUpdateOfferCurrency={onUpdateOfferCurrency}
              onUpdateCtCurrency={onUpdateCtCurrency}
              onDeleteRow={onDeleteRow}
              highlightBatchId={latestBatchId}
              defaultOpen={false}
              prefix={prefix}
              downloadFilename={filename}
            />
          );
        })}
      </div>
    </div>
  );
}