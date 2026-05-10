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

// Groups items from previous months by month-year, sorted desc
function groupByMonth(items) {
  const groups = {};
  items.forEach(item => {
    const key = getMonthYearKey(item.created_date);
    if (!groups[key]) groups[key] = { label: getMonthYearLabel(item.created_date), key, items: [] };
    groups[key].items.push(item);
  });
  return Object.values(groups).sort((a, b) => b.key.localeCompare(a.key));
}

// A single collapsible batch group
function BatchGroup({ title, subtitle, results, onClear, onUpdateOfferPrice, onUpdateOfferCurrency, onUpdateCtCurrency, defaultOpen = false }) {
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
          <Button
            variant="ghost" size="sm"
            onClick={e => { e.stopPropagation(); onClear(); }}
            className="text-gray-400 hover:text-red-500 gap-1 h-7 px-2 text-xs"
          >
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
 * PastBatchHistory - shows past batches grouped by month.
 * 
 * Props:
 *   - batches: array of { id, items: WineLookup[], createdAt: ISO string }
 *   - onClearBatch(batchId)
 *   - onClearAll()
 *   - onUpdateOfferPrice(id, price)
 */
export default function PastBatchHistory({ batches, onClearBatch, onClearAll, onUpdateOfferPrice, onUpdateOfferCurrency, onUpdateCtCurrency }) {
  if (!batches || batches.length === 0) return null;

  // Split current month vs previous months
  const currentMonthBatches = batches.filter(b => isCurrentMonth(b.createdAt));
  const prevBatches = batches.filter(b => !isCurrentMonth(b.createdAt));

  // Group prev batches by month
  const prevMonthItems = prevBatches.flatMap(b => b.items.map(i => ({ ...i, _batchId: b.id })));
  const monthGroups = groupByMonth(prevMonthItems);

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Previous Batches</p>
        <Button variant="ghost" size="sm" onClick={onClearAll}
          className="text-gray-400 hover:text-red-500 gap-1 h-7 px-2 text-xs">
          <Trash2 className="w-3 h-3" /> Clear All History
        </Button>
      </div>

      {/* Current month past batches */}
      {currentMonthBatches.map(batch => (
        <BatchGroup
          key={batch.id}
          title={`Batch — ${new Date(batch.createdAt).toLocaleDateString("default", { month: "short", day: "numeric" })}`}
          subtitle={`${batch.items.length} wines`}
          results={batch.items}
          onClear={() => onClearBatch(batch.id)}
          onUpdateOfferPrice={onUpdateOfferPrice}
          onUpdateOfferCurrency={onUpdateOfferCurrency}
          onUpdateCtCurrency={onUpdateCtCurrency}
        />
      ))}

      {/* Previous months */}
      {monthGroups.map(group => (
        <div key={group.key} className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
          <GroupedMonthSection
            group={group}
            batches={prevBatches.filter(b => getMonthYearKey(b.createdAt) === group.key)}
            onUpdateOfferCurrency={onUpdateOfferCurrency}
            onUpdateCtCurrency={onUpdateCtCurrency}
            onClearBatch={onClearBatch}
            onUpdateOfferPrice={onUpdateOfferPrice}
          />
        </div>
      ))}
    </div>
  );
}

function GroupedMonthSection({ group, batches, onClearBatch, onUpdateOfferPrice, onUpdateOfferCurrency, onUpdateCtCurrency }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{group.label}</span>
          <span className="text-xs text-gray-400">({group.items.length} wines across {batches.length} batches)</span>
        </div>
      </div>
      {open && (
        <div className="p-3 space-y-2">
          {batches.map(batch => (
            <BatchGroup
              key={batch.id}
              title={`Batch — ${new Date(batch.createdAt).toLocaleDateString("default", { month: "short", day: "numeric" })}`}
              subtitle={`${batch.items.length} wines`}
              results={batch.items}
              onClear={() => onClearBatch(batch.id)}
              onUpdateOfferPrice={onUpdateOfferPrice}
              onUpdateOfferCurrency={onUpdateOfferCurrency}
              onUpdateCtCurrency={onUpdateCtCurrency}
            />
          ))}
        </div>
      )}
    </>
  );
}