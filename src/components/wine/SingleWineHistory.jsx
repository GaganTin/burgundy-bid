import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import WineResultsTable from "./WineResultsTable";
import OfferSummary from "./OfferSummary";

function getMonthYearLabel(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}
function getMonthYearKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function isCurrentMonth(dateStr) {
  const now = new Date();
  const d = new Date(dateStr);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function CollapsibleSection({ title, subtitle, results, onClear, onUpdateOfferPrice, onUpdateOfferCurrency, onUpdateCtCurrency, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</span>
          {subtitle && <span className="text-xs text-gray-400">({subtitle})</span>}
        </div>
        {onClear && (
          <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); onClear(); }}
            className="text-gray-400 hover:text-red-500 gap-1 h-7 px-2 text-xs">
            <Trash2 className="w-3 h-3" /> Clear
          </Button>
        )}
      </div>
      {open && (
        <div className="p-3 space-y-3">
          <OfferSummary results={results} />
          <WineResultsTable results={results} onUpdateOfferPrice={onUpdateOfferPrice} onUpdateOfferCurrency={onUpdateOfferCurrency} onUpdateCtCurrency={onUpdateCtCurrency} />
        </div>
      )}
    </div>
  );
}

/**
 * SingleWineHistory
 * 
 * Props:
 *   - latestBatchId: the batch ID of the latest search (shown as the main result above, not here)
 *   - allBatchIds: all batch IDs (persisted)
 *   - allLookups: all fetched wine lookup records
 *   - onClearBatch(batchId)
 *   - onClearAll()
 *   - onUpdateOfferPrice(id, price)
 */
export default function SingleWineHistory({ latestBatchId, allBatchIds, allLookups, onClearBatch, onClearAll, onUpdateOfferPrice, onUpdateOfferCurrency, onUpdateCtCurrency }) {
  // Previous batch IDs = all except the latest
  const prevBatchIds = allBatchIds.filter(id => id !== latestBatchId);
  if (prevBatchIds.length === 0) return null;

  // For each prev batch, get its items
  const prevBatches = prevBatchIds.map(id => {
    const items = allLookups.filter(l => l.batch_id === id);
    const firstItem = items[0];
    return { id, items, createdAt: firstItem?.created_date || new Date().toISOString() };
  }).filter(b => b.items.length > 0);

  if (prevBatches.length === 0) return null;

  // Split current month vs prev months
  const currentMonthBatches = prevBatches.filter(b => isCurrentMonth(b.createdAt));
  const oldBatches = prevBatches.filter(b => !isCurrentMonth(b.createdAt));

  // Group old batches by month
  const monthGroups = {};
  oldBatches.forEach(b => {
    const key = getMonthYearKey(b.createdAt);
    if (!monthGroups[key]) monthGroups[key] = { key, label: getMonthYearLabel(b.createdAt), batches: [] };
    monthGroups[key].batches.push(b);
  });
  const sortedMonthGroups = Object.values(monthGroups).sort((a, b) => b.key.localeCompare(a.key));

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Previous Searches</p>
        <Button variant="ghost" size="sm" onClick={onClearAll}
          className="text-gray-400 hover:text-red-500 gap-1 h-7 px-2 text-xs">
          <Trash2 className="w-3 h-3" /> Clear All History
        </Button>
      </div>

      {/* Current month past single-wine batches */}
      {currentMonthBatches.map(batch => (
        <CollapsibleSection
          key={batch.id}
          title={batch.items.map(i => i.wine_name).join(", ")}
          subtitle={new Date(batch.createdAt).toLocaleDateString("default", { month: "short", day: "numeric" })}
          results={batch.items}
          onClear={() => onClearBatch(batch.id)}
          onUpdateOfferPrice={onUpdateOfferPrice}
          onUpdateOfferCurrency={onUpdateOfferCurrency}
          onUpdateCtCurrency={onUpdateCtCurrency}
        />
      ))}

      {/* Previous months grouped */}
      {sortedMonthGroups.map(group => (
        <MonthGroup key={group.key} group={group} onClearBatch={onClearBatch} onUpdateOfferPrice={onUpdateOfferPrice} onUpdateOfferCurrency={onUpdateOfferCurrency} onUpdateCtCurrency={onUpdateCtCurrency} />
      ))}
    </div>
  );
}

function MonthGroup({ group, onClearBatch, onUpdateOfferPrice, onUpdateOfferCurrency, onUpdateCtCurrency }) {
  const [open, setOpen] = useState(false);
  const totalWines = group.batches.reduce((acc, b) => acc + b.items.length, 0);
  return (
    <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{group.label}</span>
          <span className="text-xs text-gray-400">({totalWines} wines, {group.batches.length} searches)</span>
        </div>
      </div>
      {open && (
        <div className="p-3 space-y-2">
          {group.batches.map(batch => (
            <CollapsibleSection
              key={batch.id}
              title={batch.items.map(i => i.wine_name).join(", ")}
              subtitle={new Date(batch.createdAt).toLocaleDateString("default", { month: "short", day: "numeric" })}
              results={batch.items}
              onClear={() => onClearBatch(batch.id)}
              onUpdateOfferPrice={onUpdateOfferPrice}
              onUpdateOfferCurrency={onUpdateOfferCurrency}
              onUpdateCtCurrency={onUpdateCtCurrency}
            />
          ))}
        </div>
      )}
    </div>
  );
}