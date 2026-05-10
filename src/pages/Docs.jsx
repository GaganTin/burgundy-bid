// import React, { useState } from "react";

// const Section = ({ id, title, children }) => (
//   <section id={id} className="mb-16 scroll-mt-20">
//     <h2 className="text-2xl font-bold text-gray-900 border-b border-gray-200 pb-3 mb-6 font-mono">{title}</h2>
//     {children}
//   </section>
// );

// const Sub = ({ title, children }) => (
//   <div className="mb-8">
//     <h3 className="text-lg font-semibold text-gray-800 mb-3 font-mono">{title}</h3>
//     {children}
//   </div>
// );

// const Code = ({ children, block = false }) =>
//   block ? (
//     <pre className="bg-gray-950 text-green-300 rounded-lg p-4 text-sm font-mono overflow-x-auto mb-4 leading-relaxed whitespace-pre-wrap">{children}</pre>
//   ) : (
//     <code className="bg-gray-100 text-[#800020] px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
//   );

// const Tag = ({ color = "gray", children }) => {
//   const colors = {
//     gray: "bg-gray-100 text-gray-700",
//     red: "bg-red-50 text-red-700",
//     green: "bg-emerald-50 text-emerald-700",
//     blue: "bg-blue-50 text-blue-700",
//     yellow: "bg-yellow-50 text-yellow-800",
//     purple: "bg-purple-50 text-purple-700",
//   };
//   return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${colors[color]} mr-1 mb-1`}>{children}</span>;
// };

// const Swatch = ({ hex, name, usage }) => (
//   <div className="flex items-center gap-3 mb-2">
//     <div className="w-8 h-8 rounded border border-gray-200 flex-shrink-0" style={{ backgroundColor: hex }} />
//     <div>
//       <span className="text-sm font-mono font-semibold text-gray-800">{hex}</span>
//       <span className="ml-2 text-sm text-gray-500">{name}</span>
//       {usage && <span className="ml-2 text-xs text-gray-400 italic">— {usage}</span>}
//     </div>
//   </div>
// );

// const ApiRow = ({ method, call, description }) => (
//   <tr className="border-b border-gray-100">
//     <td className="py-2 pr-4 align-top"><Tag color="blue">{method}</Tag></td>
//     <td className="py-2 pr-4 align-top font-mono text-xs text-gray-700 whitespace-nowrap">{call}</td>
//     <td className="py-2 text-sm text-gray-600">{description}</td>
//   </tr>
// );

// const NAV_ITEMS = [
//   { id: "overview", label: "Overview" },
//   { id: "data-schema", label: "1. Data Schema" },
//   { id: "themes", label: "2. Themes & Styles" },
//   { id: "apis", label: "3. APIs per Page" },
//   { id: "devnotes", label: "4. Developer Notes" },
// ];

// export default function Docs() {
//   const [active, setActive] = useState("overview");

//   const handleScroll = (id) => {
//     setActive(id);
//     document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
//   };

//   return (
//     <div className="min-h-screen bg-[#fafafa]" style={{ fontFamily: "'Inter', sans-serif" }}>
//       <div className="flex">
//         {/* Sidebar */}
//         <aside className="hidden lg:block w-56 xl:w-64 flex-shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-gray-100 bg-white">
//           <div className="p-6">
//             <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Contents</p>
//             <nav className="space-y-1">
//               {NAV_ITEMS.map((item) => (
//                 <button
//                   key={item.id}
//                   onClick={() => handleScroll(item.id)}
//                   className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
//                     active === item.id
//                       ? "bg-[#800020]/10 text-[#800020] font-semibold"
//                       : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
//                   }`}
//                 >
//                   {item.label}
//                 </button>
//               ))}
//             </nav>
//           </div>
//         </aside>

//         {/* Main Content */}
//         <main className="flex-1 min-w-0 px-6 lg:px-12 xl:px-16 py-12 max-w-4xl">
//           {/* Title */}
//           <div className="mb-12">
//             <div className="flex items-center gap-2 mb-2">
//               <Tag color="red">Internal</Tag>
//               <Tag color="gray">v1.0</Tag>
//               <Tag color="gray">2026-03-06</Tag>
//             </div>
//             <h1 className="text-4xl font-bold text-gray-900 tracking-tight mb-3" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
//               Burgundy Bid — Product Documentation
//             </h1>
//             <p className="text-gray-500 text-lg font-light leading-relaxed">
//               Complete technical reference for developers building or maintaining the Burgundy Bid wine price lookup platform.
//             </p>
//           </div>

//           {/* ── OVERVIEW ── */}
//           <Section id="overview" title="Overview">
//             <p className="text-gray-600 leading-relaxed mb-4">
//               Burgundy Bid is a <strong>wine price intelligence tool</strong> for collectors, merchants, and buyers. Users enter one or more wines (single entry, pasted list, or file upload). The platform queries market pricing from <strong>Cellar Tracker</strong> and <strong>Wine Searcher</strong> then displays results in a sortable, exportable table.
//             </p>
//             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
//               {[
//                 { label: "Stack", value: "React 18 + Vite, Tailwind CSS, shadcn/ui, @tanstack/react-query, local backend client" },
//                 { label: "Auth", value: "Built-in auth — session managed via client.auth" },
//                 { label: "Database", value: "Managed entities — accessed via client.entities" },
//               ].map((r) => (
//                 <div key={r.label} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
//                   <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">{r.label}</p>
//                   <p className="text-sm text-gray-700 leading-relaxed">{r.value}</p>
//                 </div>
//               ))}
//             </div>
//           </Section>

//           {/* ── 1. DATA SCHEMA ── */}
//           <Section id="data-schema" title="1. Data Schema & Relationships">

//             <Sub title="Entity: WineLookup">
//               <p className="text-sm text-gray-500 mb-3">Core record. One row per wine looked up. Wines from the same lookup session share a <Code>batch_id</Code>.</p>
//               <Code block>{`{
//   // Built-in (auto-managed by the backend, do not define in schema):
//   id            : string   — unique record ID
//   created_date  : ISO8601  — creation timestamp
//   updated_date  : ISO8601  — last update timestamp
//   created_by    : string   — email of user who created the record

//   // Custom fields:
//   wine_name     : string   REQUIRED — full wine name
//   vintage       : string?  — vintage year, e.g. "2018"
//   size          : string?  — bottle size, default "750ml"
//   ct_avg        : string?  — Cellar Tracker community average value 
//   ct_auction    : string?  — Cellar Tracker auction average price 
//   ws_avg        : string?  — Wine Searcher average retail price 
//   ws_min        : string?  — Wine Searcher minimum price 
//   ct_url        : string?  — URL to wine page on Cellar Tracker
//   ws_url        : string?  — URL to wine page on Wine Searcher
//   offer_price   : string?  — Merchant offer price entered by user
//   notes         : string?  — Internal notes; used for "Matched: <canonical name>" pattern
//   batch_id      : string?  — Groups wines from the same session (see Batching below)
//   status        : enum     — "pending" | "completed" | "error", default "pending"
// }`}</Code>
//               <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
//                 <strong>Important:</strong> All price fields (<Code>ct_avg</Code>, <Code>ct_auction</Code>, <Code>ws_avg</Code>, <Code>ws_min</Code>, <Code>offer_price</Code>) are stored as <strong>strings</strong>, not numbers. They may contain currency symbols (e.g. <Code>"$45.00"</Code>). Parse before doing arithmetic.
//               </div>
//             </Sub>

//             <Sub title="Entity: SiteCredential">
//               <p className="text-sm text-gray-500 mb-3">Stores login credentials for external wine data sources. One record per site per user.</p>
//               <Code block>{`{
//   // Built-in:
//   id            : string
//   created_date  : ISO8601
//   updated_date  : ISO8601
//   created_by    : string   — user email (implicitly scopes to that user)

//   // Custom fields:
//   site_name     : enum     REQUIRED — "cellar_tracker" | "wine_searcher"
//   username      : string   REQUIRED — login email for the external site
//   password      : string?  — login password (stored in plain text in the backend DB — see security note)
//   is_connected  : boolean  default false — whether credentials have been saved
//   is_enabled    : boolean  default true  — whether to include this source in lookups
//   last_connected: ISO8601? — timestamp of last save
// }`}</Code>
//               <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
//                 <strong>Security Note:</strong> Passwords are stored as plain strings in the backend database. There is currently no encryption layer. For production hardening, implement server-side encryption before storing, or replace with OAuth token flows if the external APIs support it.
//               </div>
//             </Sub>

//             <Sub title="Entity: User (built-in)">
//               <p className="text-sm text-gray-500 mb-3">Managed by the backend. Read-only fields cannot be changed. Editable fields can be extended.</p>
//               <Code block>{`{
//   // Read-only (managed by the backend):
//   id            : string
//   created_date  : ISO8601
//   full_name     : string
//   email         : string

//   // Editable via client.auth.updateMe():
//   role          : string   — "admin" | "user" (default)
//   phone         : string?  — added by the app
//   subscription_plan : string? — "free" | "basic" | "pro" (added by the app)
//                                  Used in Profile page to show Upgrade vs Manage buttons
// }`}</Code>
//             </Sub>

//             <Sub title="Batch System (Not a DB Entity)">
//               <p className="text-sm text-gray-600 mb-3">
//                 There is no <Code>Batch</Code> entity. Batching is implemented via two mechanisms:
//               </p>
//               <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
//                 <li><strong>batch_id field</strong> on <Code>WineLookup</Code>: generated as <Code>{"batch_${Date.now()}_${randomStr}"}</Code> at lookup time. All wines from the same session share this ID.</li>
//                 <li><strong>localStorage</strong>: Stores the current and historical batch IDs per tab (<Code>bb_single_current</Code>, <Code>bb_single_history</Code>, <Code>bb_paste_current</Code>, etc.). These are persisted across page reloads.</li>
//               </ol>
//               <Code block>{`// localStorage keys used (per tab):
// "bb_single_current"   → string   (current batch_id for Single Search tab)
// "bb_single_history"   → string[] (older batch IDs for Single Search tab)
// "bb_paste_current"    → string   (current batch_id for Paste List tab)
// "bb_paste_history"    → string[]
// "bb_upload_current"   → string
// "bb_upload_history"   → string[]
// "bb_demo_seeded"      → "v2"     (prevents re-seeding demo data)`}</Code>
//             </Sub>

//             <Sub title="Entity Relationships Diagram">
//               <Code block>{`User (built-in)
//   │
//   ├─── creates ──→ WineLookup (many, via created_by = user.email)
//   │                  └── grouped by batch_id (ephemeral, via localStorage)
//   │
//   └─── creates ──→ SiteCredential (one per site_name, via created_by = user.email)

// Note: There are no foreign key constraints in the backend. Relationships are
// enforced by application logic (filtering by created_by / batch_id).`}</Code>
//             </Sub>
//           </Section>

//           {/* ── 2. THEMES & STYLES ── */}
//           <Section id="themes" title="2. Themes, Fonts & Colours">

//             <Sub title="Typography">
//               <p className="text-sm text-gray-600 mb-3">Two Google Fonts are imported globally in <Code>Layout.js</Code> and <Code>pages/Home.jsx</Code>:</p>
//               <Code block>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');`}</Code>
//               <div className="space-y-3">
//                 <div className="bg-white border border-gray-100 rounded-lg p-4">
//                   <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Playfair Display — Serif</p>
//                   <p className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>Headings, Brand name, Nav items</p>
//                   <p className="text-sm text-gray-500 mt-1">Used via <Code>.font-serif</Code> Tailwind class, which is overridden to <Code>Playfair Display, Georgia, serif</Code>.</p>
//                 </div>
//                 <div className="bg-white border border-gray-100 rounded-lg p-4">
//                   <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Inter — Sans-serif</p>
//                   <p className="text-2xl font-light" style={{ fontFamily: "'Inter', sans-serif" }}>Body text, labels, UI elements</p>
//                   <p className="text-sm text-gray-500 mt-1">Applied on <Code>body</Code> globally. Weights used: 300 (light), 400 (regular), 500 (medium), 600 (semibold).</p>
//                 </div>
//               </div>
//             </Sub>

//             <Sub title="Colour Palette">
//               <p className="text-sm text-gray-600 mb-3">Tailwind CSS with custom CSS variables (defined in <Code>index.css</Code>). Dark mode via <Code>class</Code> strategy (<Code>darkMode: ["class"]</Code> in <Code>tailwind.config.js</Code>).</p>
//               <div className="bg-white border border-gray-100 rounded-xl p-5 mb-4">
//                 <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Brand</p>
//                 <Swatch hex="#800020" name="Burgundy / Maroon" usage="Primary actions, active states, brand accent. Used as bg-[#800020]." />
//                 <Swatch hex="#6b001b" name="Dark Burgundy" usage="Hover state for primary buttons. bg-[#6b001b]." />
//               </div>
//               <div className="bg-white border border-gray-100 rounded-xl p-5 mb-4">
//                 <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Neutral (Light Mode)</p>
//                 <Swatch hex="#fafafa" name="Off-white" usage="Page background. bg-[#fafafa]." />
//                 <Swatch hex="#ffffff" name="White" usage="Card, nav, table backgrounds." />
//                 <Swatch hex="#f3f4f6" name="Gray-100" usage="Secondary backgrounds, tags." />
//                 <Swatch hex="#9ca3af" name="Gray-400" usage="Placeholder text, muted icons." />
//                 <Swatch hex="#6b7280" name="Gray-500" usage="Descriptions, subtitles." />
//                 <Swatch hex="#111827" name="Gray-900" usage="Primary text, headings." />
//               </div>
//               <div className="bg-white border border-gray-100 rounded-xl p-5 mb-4">
//                 <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Neutral (Dark Mode)</p>
//                 <Swatch hex="#000000" name="Black" usage="Page background. dark:bg-black." />
//                 <Swatch hex="#030712" name="Gray-950" usage="Nav bar. dark:bg-gray-950." />
//                 <Swatch hex="#111827" name="Gray-900" usage="Card backgrounds. dark:bg-gray-900." />
//                 <Swatch hex="#1f2937" name="Gray-800" usage="Table rows, input fields. dark:bg-gray-800." />
//                 <Swatch hex="#374151" name="Gray-700" usage="Borders, inputs. dark:border-gray-700." />
//               </div>
//               <div className="bg-white border border-gray-100 rounded-xl p-5">
//                 <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Semantic Colours</p>
//                 <Swatch hex="#059669" name="Emerald-600" usage="Success badges (Done), Manage Subscription button, positive indicators." />
//                 <Swatch hex="#dc2626" name="Red-600" usage="Error states, destructive actions, Delete Account." />
//                 <Swatch hex="#f59e0b" name="Amber-500" usage="Usage bar warning (70–90% usage)." />
//                 <Swatch hex="#ef4444" name="Red-500" usage="Usage bar danger (≥90% usage)." />
//               </div>
//             </Sub>

//             <Sub title="Dark Mode">
//               <p className="text-sm text-gray-600 mb-2">
//                 Toggle managed in <Code>Profile.jsx</Code> via <Code>localStorage.setItem("theme", "dark")</Code> and <Code>document.documentElement.classList.toggle("dark", enabled)</Code>. The setting is re-applied on page load in <Code>Layout.js</Code>.
//               </p>
//               <Code block>{`// Layout.js onMount
// const savedTheme = localStorage.getItem("theme");
// if (savedTheme === "dark") {
//   document.documentElement.classList.add("dark");
// }`}</Code>
//             </Sub>

//             <Sub title="Spacing & Layout">
//               <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
//                 <li>Page horizontal padding: <Code>px-6 lg:px-12 xl:px-16</Code> (consistent across all pages)</li>
//                 <li>Page top padding: <Code>py-12</Code></li>
//                 <li>Cards: <Code>rounded-xl shadow-sm border border-gray-100</Code></li>
//                 <li>Nav height: <Code>h-14</Code>, <Code>sticky top-0 z-50</Code></li>
//                 <li>Responsive grid: <Code>grid-cols-1 lg:grid-cols-2</Code> or <Code>lg:grid-cols-3</Code></li>
//               </ul>
//             </Sub>
//           </Section>

//           {/* ── 3. APIs PER PAGE ── */}
//           <Section id="apis" title="3. APIs on Each Page">
//             <p className="text-sm text-gray-500 mb-6">All API calls use the local client (<Code>import {`{ client }`} from "@/api/client"</Code>). There are no direct HTTP calls or third-party API keys in the frontend.</p>

//             <Sub title="pages/Home.jsx">
//               <table className="w-full text-left border-collapse">
//                 <thead><tr className="border-b border-gray-200"><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Type</th><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Call</th><th className="text-xs text-gray-400 uppercase pb-2">Purpose</th></tr></thead>
//                 <tbody>
//                   <ApiRow method="AUTH" call="client.auth.isAuthenticated()" description="Checks if user is logged in on mount. If true, immediately redirects to Lookup." />
//                   <ApiRow method="AUTH" call="client.auth.redirectToLogin(nextUrl)" description="Redirects user to the login flow. Called on Log in and Sign up button clicks. After login, user is sent to Lookup." />
//                 </tbody>
//               </table>
//             </Sub>

//             <Sub title="pages/Lookup.jsx">
//               <p className="text-sm text-gray-500 mb-3">Most complex page. Orchestrates the full lookup flow.</p>
//               <table className="w-full text-left border-collapse">
//                 <thead><tr className="border-b border-gray-200"><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Type</th><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Call</th><th className="text-xs text-gray-400 uppercase pb-2">Purpose</th></tr></thead>
//                 <tbody>
//                   <ApiRow method="ENTITY" call="SiteCredential.list()" description="Fetches saved credentials to determine which data sources are enabled (CT and/or WS)." />
//                   <ApiRow method="ENTITY" call="WineLookup.filter({ batch_id })" description="Fetches all WineLookup records for given batch IDs. Called separately for each tab's batch IDs. Returns up to 200 records." />
//                   <ApiRow method="ENTITY" call="WineLookup.bulkCreate(records[])" description="Creates pending WineLookup records before starting the lookup loop." />
//                   <ApiRow method="ENTITY" call="WineLookup.update(id, data)" description="Updates each record with price data (ct_avg, ct_auction, ws_avg, ws_min, ct_url, ws_url, status, notes)." />
//                   <ApiRow method="ENTITY" call="WineLookup.delete(id)" description="Deletes records when user clears a batch or batch history." />
//                 </tbody>
//               </table>
//             </Sub>

//             <Sub title="pages/Connections.jsx">
//               <table className="w-full text-left border-collapse">
//                 <thead><tr className="border-b border-gray-200"><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Type</th><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Call</th><th className="text-xs text-gray-400 uppercase pb-2">Purpose</th></tr></thead>
//                 <tbody>
//                   <ApiRow method="ENTITY" call="SiteCredential.list()" description="Fetches all saved credentials for the current user." />
//                   <ApiRow method="ENTITY" call="SiteCredential.create(data)" description="Creates a new credential record when user saves a new connection." />
//                   <ApiRow method="ENTITY" call="SiteCredential.update(id, data)" description="Updates existing credential (re-save, or toggle is_enabled)." />
//                   <ApiRow method="ENTITY" call="SiteCredential.delete(id)" description="Removes a credential when user clicks Disconnect." />
//                 </tbody>
//               </table>
//             </Sub>

//             <Sub title="pages/Profile.jsx">
//               <table className="w-full text-left border-collapse">
//                 <thead><tr className="border-b border-gray-200"><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Type</th><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Call</th><th className="text-xs text-gray-400 uppercase pb-2">Purpose</th></tr></thead>
//                 <tbody>
//                   <ApiRow method="AUTH" call="client.auth.me()" description="Fetches current user data on mount (full_name, email, phone, subscription_plan, role)." />
//                   <ApiRow method="AUTH" call="client.auth.updateMe(data)" description="Saves profile edits (full_name, phone). After save, dispatches custom event bb_profile_updated so Layout re-fetches display name." />
//                   <ApiRow method="ENTITY" call="WineLookup.list('-created_date', 500)" description="Fetches up to 500 recent lookups to calculate weekly and monthly usage counts for the Usage Tracker card." />
//                 </tbody>
//               </table>
//             </Sub>

//             <Sub title="components/WineInput.jsx (used on Lookup)">
//               <table className="w-full text-left border-collapse">
//                 <thead><tr className="border-b border-gray-200"><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Type</th><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Call</th><th className="text-xs text-gray-400 uppercase pb-2">Purpose</th></tr></thead>
//                 <tbody>
//                   <ApiRow method="INTEGRATION" call="Core.UploadFile({ file })" description="Uploads the Excel file to backend storage. Returns file_url." />
//                   <ApiRow method="INTEGRATION" call="Core.ExtractDataFromUploadedFile({ file_url, json_schema })" description="AI-powered extraction of wine name, vintage, and size columns from Excel spreadsheets. Returns structured wines array." />
//                 </tbody>
//               </table>
//               <p className="text-xs text-gray-400 mt-2">CSV/TSV/TXT files are parsed locally using <Code>parseWineText()</Code> in <Code>WineParser.js</Code> — no API call needed.</p>
//             </Sub>

//             <Sub title="Layout.js">
//               <table className="w-full text-left border-collapse">
//                 <thead><tr className="border-b border-gray-200"><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Type</th><th className="text-xs text-gray-400 uppercase pb-2 pr-4">Call</th><th className="text-xs text-gray-400 uppercase pb-2">Purpose</th></tr></thead>
//                 <tbody>
//                   <ApiRow method="AUTH" call="client.auth.isAuthenticated()" description="Determines whether to show user avatar or Login/Signup buttons in the navbar." />
//                   <ApiRow method="AUTH" call="client.auth.me()" description="Fetches user display name and email for the navbar dropdown." />
//                   <ApiRow method="AUTH" call="client.auth.logout(redirectUrl)" description="Logs out user and redirects to Home page." />
//                   <ApiRow method="AUTH" call="client.auth.redirectToLogin()" description="Redirects to login page when unauthenticated user clicks Log in." />
//                 </tbody>
//               </table>
//             </Sub>
//           </Section>

//           {/* ── 4. DEVELOPER NOTES ── */}
//           <Section id="devnotes" title="4. Developer Notes">

//             <Sub title="4.1 State Architecture — The Batch System">
//               <p className="text-sm text-gray-600 mb-3">
//                 The Lookup uses a hybrid state model: <strong>localStorage</strong> for batch ID lists (survives refresh), and <strong>@tanstack/react-query</strong> for fetching all wines belonging to those batches from the DB. This allows persistent history across sessions without an extra Batch entity.
//               </p>
//               <Code block>{`// On each lookup:
// 1. Generate a new batchId
// 2. Push previous current batchId → history array in localStorage
// 3. Set new batchId as current in localStorage
// 4. Bulk-create WineLookup records with batch_id = batchId
// 5. Loop through each wine
// 6. React Query re-fetches all IDs, producing updated UI

// // History grouping is derived client-side:
// groupIntoBatches(data, currentId, historyIds) → { current, history[] }`}</Code>
//             </Sub>

//             <Sub title="4.2 Data Source">
//               <Code block>{`// response schema expected:
// {
//   ct_avg      : string | null,   // e.g. "$45.00"
//   ct_auction  : string | null,
//   ws_avg      : string | null,
//   ws_min      : string | null,
//   ct_url      : string | null,   // full URL
//   ws_url      : string | null,
//   matched_name: string | null,   // canonical wine name as found on the site
// }`}</Code>
//               <p className="text-sm text-gray-600">
//                 The <Code>matched_name</Code> is stored in the <Code>notes</Code> field with the prefix <Code>"Matched: "</Code>. Components strip this prefix using the pattern <Code>/^matched:/i</Code>.
//               </p>
//             </Sub>

//             <Sub title="4.3 CSV Export Column Order">
//               <p className="text-sm text-gray-600 mb-2">All CSV exports enforce this column order:</p>
//               <Code block>{`// Current batch (WineResultsTable): user-configurable column order (drag & drop)
// // History exports (BatchHistorySection): fixed order:
// ["Size", "Vintage", "Wine", "CT Avg Value", "CT Auction Avg", "WS Avg Price", "WS Min Price", "Matched As", "Offer"]
// // Export All History adds one more column:
// ["Size", ..., "Offer", "Searched Date"]

// // "Matched As" cell includes URL inline:
// // e.g. "Château Margaux 2018 (https://www.Cellar Tracker.com/wine.asp?iWine=12345)"`}</Code>
//             </Sub>

//             <Sub title="4.4 Subscription Plan Logic">
//               <p className="text-sm text-gray-600 mb-2">
//                 The subscription plan is stored on the User entity as <Code>subscription_plan: "free" | "basic" | "pro"</Code>. There is <strong>no payment processing implemented yet</strong> — Subscribe buttons exist in the UI but do not trigger any payment flow.
//               </p>
//               <Code block>{`// Profile.jsx determines button to show:
// const userPlan = user?.subscription_plan || "free";
// const isUpgradable = userPlan === "free" || userPlan === "basic";

// // → isUpgradable = true  → show "Upgrade Plan" button (burgundy)
// // → isUpgradable = false → show "Manage Subscription" button (outline)

// // SubscriptionPlans.jsx plan card button logic:
// // - Free card + user is free  → "Current Plan" (disabled, gray)
// // - Paid plan card matching user's plan → "Manage Subscription" (green)
// // - All other paid plans → "Subscribe" (burgundy)

// // Monthly lookup limit is HARD-CODED at 10 (free tier) in Profile.jsx:
// const MONTHLY_LIMIT = 10;
// // This is not enforced on the backend — only a UI warning is shown.`}</Code>
//             </Sub>

//             <Sub title="4.5 Demo Data Seeding">
//               <p className="text-sm text-gray-600 mb-2">
//                 On Lookup load, <Code>initDemoIfNeeded()</Code> seeds localStorage with fake batch IDs if <Code>bb_demo_seeded !== "v2"</Code>. These fake IDs reference real WineLookup records in the DB (expected to be pre-populated separately). Demo batch dates are hardcoded to appear in the correct history time buckets (Today, This Month, Older).
//               </p>
//               <Code block>{`// Demo seed version key: "bb_demo_seeded" = "v2"
// // Increment this string to force re-seed on all existing users' browsers.`}</Code>
//             </Sub>

//             <Sub title="4.6 Query Invalidation Pattern">
//               <p className="text-sm text-gray-600 mb-2">After any mutation (create/update/delete), the relevant query is invalidated to trigger a re-fetch:</p>
//               <Code block>{`// Query keys used:
// ["credentials"]                    // Connections page credential list
// ["wine_lookups_single_all", ids[]] // Single tab wines
// ["wine_lookups_paste_all",  ids[]] // Paste tab wines
// ["wine_lookups_upload_all", ids[]] // Upload tab wines
// ["all_lookups_usage"]              // Profile page usage stats

// queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });`}</Code>
//             </Sub>

//             <Sub title="4.7 Layout & Navigation">
//               <Code block>{`// Route structure (React Router v6):
// /          → pages/Home.jsx     (public, redirects to /Lookup if authed)
// /Lookup → pages/Lookup.jsx
// /Connections  → pages/Connections.jsx
// /Profile   → pages/Profile.jsx
// /Docs      → pages/Docs.jsx     (this page)

// // Navigation uses createPageUrl(pageName) utility:
// import { createPageUrl } from "@/utils";
// // Example: <Link to={createPageUrl("Lookup")}>Lookup</Link>

// // Layout.js wraps ALL pages automatically.
// // Do NOT import or render <Layout> inside any page component.`}</Code>
//             </Sub>

//             <Sub title="4.8 Real-time Updates">
//               <p className="text-sm text-gray-600 mb-2">
//                 The app uses <strong>polling via React Query invalidation</strong> during a batch lookup, not WebSockets. After each wine resolves, <Code>queryClient.invalidateQueries()</Code> triggers a re-fetch so the table updates row by row. There is no real-time subscription (<Code>client.entities.WineLookup.subscribe()</Code>) used in this app.
//               </p>
//             </Sub>

//             <Sub title="4.9 File Parsing">
//               <Code block>{`// WineParser.js (components/wine/WineParser.js)
// // parseWineText(text) — handles TSV and CSV pasted text
// //   - Detects header row if it contains "wine", "vintage", or "size"
// //   - Returns: [{ name, vintage, size }]
// //
// // parseExcelData(data) — handles structured data from ExtractDataFromUploadedFile
// //
// // Supported upload formats:
// //   .csv .tsv .txt → FileReader + parseWineText() (client-side, no API)
// //   .xlsx .xls     → Core.UploadFile() + Core.ExtractDataFromUploadedFile() (AI extraction)`}</Code>
//             </Sub>

//             <Sub title="4.10 Key Third-Party Libraries">
//               <div className="overflow-x-auto">
//                 <table className="w-full text-left border-collapse text-sm">
//                   <thead><tr className="border-b border-gray-200"><th className="pb-2 pr-4 text-xs text-gray-400 uppercase">Library</th><th className="pb-2 text-xs text-gray-400 uppercase">Usage</th></tr></thead>
//                   <tbody>
//                     {[
//                       ["@tanstack/react-query", "All data fetching and cache management"],
//                       ["@hello-pangea/dnd", "Drag-and-drop column reordering in WineResultsTable"],
//                       ["date-fns", "Date formatting and comparison in BatchHistorySection"],
//                       ["lucide-react", "All icons (must only use icons that exist in v0.475.0)"],
//                       ["shadcn/ui", "All base UI components (Button, Card, Table, Badge, etc.)"],
//                       ["framer-motion", "Installed but not actively used in current build"],
//                       ["react-router-dom v6", "Client-side routing via createPageUrl() utility"],
//                     ].map(([lib, use]) => (
//                       <tr key={lib} className="border-b border-gray-50">
//                         <td className="py-1.5 pr-4 font-mono text-xs text-gray-700">{lib}</td>
//                         <td className="py-1.5 text-gray-600">{use}</td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//             </Sub>

//             <Sub title="4.11 Things NOT Yet Implemented">
//               <ul className="list-disc list-inside space-y-1.5 text-sm text-gray-600">
//                 <li><strong>Payment processing:</strong> Stripe is installed (<Code>@stripe/react-stripe-js</Code>) but no checkout flow exists. Subscribe buttons are placeholders.</li>
//                 <li><strong>Monthly lookup enforcement:</strong> The 10-lookup free limit is display-only. No server-side gate enforces it.</li>
//                 <li><strong>Credential validation:</strong> Saved credentials are not actually tested against Cellar Tracker or Wine Searcher APIs. <Code>is_connected: true</Code> is set optimistically on save.</li>
//                 <li><strong>Password change:</strong> The Change Password form in Profile shows a message but does not call any API.</li>
//                 <li><strong>Account deletion:</strong> Shows an alert directing the user to contact support — no automated deletion.</li>
//                 <li><strong>WS URL linking:</strong> The <Code>ws_url</Code> field is stored but the Matched As column only links to <Code>ct_url</Code>.</li>
//               </ul>
//             </Sub>
//           </Section>
//         </main>
//       </div>
//     </div>
//   );
// }