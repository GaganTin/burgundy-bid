import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Check, CreditCard, Loader2 } from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

// Transform raw DB rows into the plan shape PlanCard expects for a given billing period.
// With granular plan names (basic_monthly, basic_annually, etc.), we filter by suffix
// so each billing toggle shows the correct plan rows.
function rowsToPlanList(rows, billing) {
  const suffix = billing === "annually" ? "_annually" : "_monthly";
  return rows
    .filter((r) => r.plan_name === "free" || r.plan_name.endsWith(suffix))
    .map((row) => {
      const isFree = row.plan_name === "free";
      const isAnnual = row.plan_name.endsWith("_annually");
      const priceCents = isAnnual ? row.annual_price_cents : row.monthly_price_cents;
      const dollars = priceCents / 100;
      // Format: integer prices show without decimals ($75), non-integer show 2dp ($6.99)
      const price = dollars % 1 === 0 ? dollars : parseFloat(dollars.toFixed(2));
      const baseName = row.plan_name.replace(/_(monthly|annually)$/, "");
      const plan = {
        id: row.plan_name,
        name: row.display_name,
        price,
        label: isFree ? "forever" : isAnnual ? "/ year" : "/ month",
        features: Array.isArray(row.features) ? row.features : JSON.parse(row.features || "[]"),
        popular: baseName === "pro",
      };
      if (isAnnual && !isFree) {
        // Compute savings vs the monthly counterpart row
        const monthlyRow = rows.find((r) => r.plan_name === `${baseName}_monthly`);
        if (monthlyRow && monthlyRow.monthly_price_cents > 0) {
          const saving = Math.round((monthlyRow.monthly_price_cents / 100) * 12 - price);
          if (saving > 0) plan.savings = `Save $${saving}/yr`;
        }
      }
      return plan;
    });
}

async function startCheckout(plan, _billing, setLoading, setError) {
  setLoading(plan);
  setError(null);
  try {
    const token = localStorage.getItem("app_access_token");
    const res = await fetch(`${API}/stripe/create-checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // plan is already the full name (e.g. 'basic_monthly') — no separate billing param needed
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create checkout session");
    window.location.href = data.url;
  } catch (e) {
    setError(e.message);
    setLoading(null);
  }
}

async function openBillingPortal(setLoading, setError) {
  setLoading("portal");
  setError(null);
  try {
    const token = localStorage.getItem("app_access_token");
    const res = await fetch(`${API}/stripe/billing-portal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to open billing portal");
    window.location.href = data.url;
  } catch (e) {
    setError(e.message);
    setLoading(null);
  }
}

function PlanCard({ plan, billing, currentPlan, loading, setLoading, setError }) {
  // Exact match: user is on 'basic_monthly', only that card shows Active
  const isActive = plan.id === (currentPlan || "free");
  const isFree = plan.price === 0;

  let btn;
  if (isFree && isActive) {
    btn = <Button className="w-full bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-default" disabled>Current Plan</Button>;
  } else if (!isFree && isActive) {
    btn = <Button className="w-full bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-default" disabled>Current Plan</Button>;
  } else if (isFree) {
    btn = <Button className="w-full bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-default" disabled>Free Plan</Button>;
  } else {
    btn = (
      <Button
        className="w-full bg-[#800020] hover:bg-[#6b001b] text-white"
        disabled={!!loading}
        onClick={() => startCheckout(plan.id, billing, setLoading, setError)}
      >
        {loading === plan.id ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirecting...</> : "Subscribe"}
      </Button>
    );
  }

  return (
    <div className={`relative border rounded-xl p-6 flex flex-col ${plan.popular ? "border-[#800020] bg-[#800020]/5 dark:bg-[#800020]/10" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"}`}>
      {plan.popular && <Badge className="absolute -top-2.5 right-4 bg-[#800020] text-white text-xs">Most Popular</Badge>}
      {isActive && !isFree && <Badge className="absolute -top-2.5 left-4 bg-emerald-600 text-white text-xs">Active</Badge>}
      <div className="mb-5">
        <h3 className="font-semibold text-gray-900 dark:text-white text-lg">{plan.name}</h3>
        <div className="flex items-baseline gap-1 mt-2">
          {plan.price === 0
            ? <span className="text-3xl font-bold text-gray-900 dark:text-white">Free</span>
            : <><span className="text-3xl font-bold text-gray-900 dark:text-white">${plan.price}</span><span className="text-gray-400 text-sm">{plan.label}</span></>}
        </div>
        {plan.savings && <p className="text-emerald-600 dark:text-emerald-400 text-xs font-medium mt-1">{plan.savings}</p>}
      </div>
      <ul className="space-y-2.5 mb-6 flex-grow">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
            <Check className="w-4 h-4 text-[#800020] mt-0.5 flex-shrink-0" />{f}
          </li>
        ))}
      </ul>
      {btn}
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-xl p-6 bg-gray-50 dark:bg-gray-800 animate-pulse">
          <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
          <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-5" />
          <div className="space-y-2.5 mb-6">
            {[0, 1, 2, 3].map((j) => <div key={j} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />)}
          </div>
          <div className="h-9 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      ))}
    </div>
  );
}

export default function SubscriptionPlans({ hideHeader = false, currentPlan = "free" }) {
  const [billing, setBilling] = useState("monthly");
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const [rawPlans, setRawPlans] = useState(null);
  const [plansError, setPlansError] = useState(null);

  useEffect(() => {
    fetch(`${API}/plans`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRawPlans(data.filter(p => p.plan_name !== 'admin'));
        else setPlansError("Failed to load plans");
      })
      .catch(() => setPlansError("Failed to load plans"));
  }, []);

  const plans = rawPlans ? rowsToPlanList(rawPlans, billing) : null;

  const toggle = (
    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 gap-1">
      <button onClick={() => setBilling("monthly")}
        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${billing === "monthly" ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}>
        Monthly
      </button>
      <button onClick={() => setBilling("annually")}
        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${billing === "annually" ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}>
        Annually
        <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-semibold">Save</span>
      </button>
    </div>
  );

  const grid = (
    <>
      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      {plansError
        ? <p className="text-red-500 text-sm">{plansError}</p>
        : plans
          ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} billing={billing} currentPlan={currentPlan}
                  loading={loading} setLoading={setLoading} setError={setError} />
              ))}
            </div>
          )
          : <PlanSkeleton />
      }
    </>
  );

  if (hideHeader) {
    return <div><div className="flex justify-end mb-4">{toggle}</div>{grid}</div>;
  }

  return (
    <Card className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-lg font-semibold dark:text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[#800020]" />
              Subscription Plans
            </CardTitle>
            <CardDescription>Choose the plan that works best for you</CardDescription>
          </div>
          {toggle}
        </div>
      </CardHeader>
      <CardContent>{grid}</CardContent>
    </Card>
  );
}
