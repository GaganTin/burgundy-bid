import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

function parsePrice(p) {
  if (!p) return NaN;
  return parseFloat(String(p).replace(/[$,]/g, ""));
}

export default function OfferSummary({ results }) {
  const completed = results.filter(r => r.status === "completed");
  if (completed.length === 0) return null;

  const withOffer = completed.filter(r => r.offer_price && !isNaN(parsePrice(r.offer_price)));
  const withMarket = completed.filter(r => r.ws_avg || r.ct_avg);

  let totalOffer = 0, totalMarket = 0, comparisons = 0;
  withOffer.forEach(w => {
    const offer = parsePrice(w.offer_price);
    const market = parsePrice(w.ws_avg) || parsePrice(w.ct_avg);
    if (!isNaN(offer)) totalOffer += offer;
    if (!isNaN(market) && !isNaN(offer)) { totalMarket += market; comparisons++; }
  });

  const diff = comparisons > 0 ? ((totalOffer - totalMarket) / totalMarket) * 100 : null;

  const cardClass = "bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2 shadow-sm min-w-[110px]";

  return (
    <div className="flex flex-wrap gap-2">
      <div className={cardClass}>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Wines Found</p>
        <p className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">{completed.length}</p>
      </div>
    </div>
  );
}