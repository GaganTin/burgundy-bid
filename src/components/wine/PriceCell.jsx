import React from "react";
import { cn } from "@/lib/utils";

export default function PriceCell({ price, label, offerPrice, className }) {
  if (!price) {
    return (
      <span className={cn("text-gray-300 text-sm", className)}>—</span>
    );
  }

  // Compare with offer price if provided
  let comparison = null;
  if (offerPrice && price) {
    const numPrice = parseFloat(price.replace(/[$,]/g, ""));
    const numOffer = parseFloat(String(offerPrice).replace(/[$,]/g, ""));
    if (!isNaN(numPrice) && !isNaN(numOffer) && numPrice > 0) {
      const diff = ((numOffer - numPrice) / numPrice) * 100;
      if (Math.abs(diff) > 1) {
        comparison = {
          pct: diff,
          label: diff > 0 ? `+${diff.toFixed(0)}%` : `${diff.toFixed(0)}%`,
          color: diff > 0 ? "text-red-500" : "text-emerald-600",
        };
      }
    }
  }

  return (
    <div className={cn("flex items-baseline gap-1.5", className)}>
      <span className="font-medium text-gray-900 tabular-nums">{price}</span>
      {comparison && (
        <span className={cn("text-xs font-medium", comparison.color)}>
          {comparison.label}
        </span>
      )}
    </div>
  );
}