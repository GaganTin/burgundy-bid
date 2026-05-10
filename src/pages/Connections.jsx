import React, { useState, useEffect } from "react";
import { client } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Wine, CheckCircle2, XCircle, Loader2, Eye, EyeOff, Trash2, Save, Power, BookOpen, ChevronRight } from "lucide-react";
import GuideModal from "@/components/GuideModal";
import connP1Img from "@/assets/guide/how-to-get-started-p1.png";
import connP2Img from "@/assets/guide/how-to-get-started-p2.png";
import connP3Img from "@/assets/guide/how-to-get-started-p3.png";
import { Switch } from "@/components/ui/switch";

const SITES = [
  {
    key: "cellar_tracker",
    name: "Cellar Tracker",
    icon: Wine,
    description: "Paid version",
    iconClass: "bg-[#800020] text-white",
    usernameLabel: "Email or Username",
    urlHint: "cellartracker.com",
  },
  {
    key: "wine_searcher",
    name: "Wine Searcher",
    icon: Wine,
    description: "Paid version",
    iconClass: "bg-[#800020] text-white",
    usernameLabel: "Email",
    urlHint: "wine-searcher.com",
  },
];

export default function Connections() {
  const queryClient = useQueryClient();
  const [guideOpen, setGuideOpen] = useState(false);
  const [showPassword, setShowPassword] = useState({});
  const [forms, setForms] = useState({});
  const [saving, setSaving] = useState({});
  const [disconnectConfirm, setDisconnectConfirm] = useState(null);
  const [disconnecting, setDisconnecting] = useState({});

  const { data: credentials = [] } = useQuery({
    queryKey: ["credentials"],
    queryFn: () => client.entities.SiteCredential.list(),
  });

  // Poll every 3 s while any credential is in 'connecting' state so server-mode
  // connections (background Playwright jobs) update the UI automatically.
  React.useEffect(() => {
    const hasConnecting = credentials.some(c => c.status === 'connecting');
    if (!hasConnecting) return;
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
    }, 3000);
    return () => clearInterval(id);
  }, [credentials, queryClient]);

  // When credentials load, prefill the forms for sites that have an error
  React.useEffect(() => {
    if (!credentials || credentials.length === 0) return;
    const next = {};
    for (const c of credentials) {
      if (c?.status === "error") {
        next[c.site_name] = { username: c.email || "", password: "" };
      }
    }
    if (Object.keys(next).length > 0) {
      setForms((prev) => ({ ...prev, ...next }));
    }
  }, [credentials]);

  const getCredential = (siteKey) => credentials.find((c) => c.site_name === siteKey);

  const updateForm = (siteKey, field, value) => {
    setForms((prev) => ({ ...prev, [siteKey]: { ...prev[siteKey], [field]: value } }));
  };

  const handleSave = async (siteKey) => {
    const form = forms[siteKey];
    if (!form?.username || !form?.password) return;
    setSaving((p) => ({ ...p, [siteKey]: true }));
    let existing = getCredential(siteKey);

    if (existing && existing.status === 'connecting') {
      alert('A connection attempt is already in progress. Please wait for it to complete.');
      setSaving((p) => ({ ...p, [siteKey]: false }));
      return;
    }

    // Server path: server-side Playwright with residential dedicated proxy.
    // run_connect = true tells the server to start a background Playwright job.
    const serverData = {
      site_name: siteKey,
      email: form.username,
      password: form.password || "",
      status: "connecting",
      is_connected: false,
      is_enabled: true,
      is_error: false,
      last_connected: null,
      run_connect: true,
    };
    if (existing) {
      await client.entities.SiteCredential.update(existing.id, serverData);
    } else {
      await client.entities.SiteCredential.create(serverData);
    }
    queryClient.invalidateQueries({ queryKey: ["credentials"] });
    setSaving((p) => ({ ...p, [siteKey]: false }));
    setForms((prev) => ({ ...prev, [siteKey]: { ...prev[siteKey], password: "" } }));
  };

  const handleToggleEnabled = async (siteKey, enabled) => {
    const existing = getCredential(siteKey);
    if (existing) {
      await client.entities.SiteCredential.update(existing.id, { is_enabled: enabled });
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
    }
  };

  const handleDisconnect = async (siteKey) => {
    setDisconnecting(d => ({ ...d, [siteKey]: true }));
    try {
      const existing = getCredential(siteKey);
      if (existing) {
        await client.entities.SiteCredential.delete(existing.id);
        queryClient.invalidateQueries({ queryKey: ["credentials"] });
      }
    } finally {
      setDisconnecting(d => ({ ...d, [siteKey]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-black">
      <div className="px-6 lg:px-12 xl:px-16 py-12">
        <div className="mb-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-serif font-bold text-gray-900 dark:text-white tracking-tight">
              Connections
            </h1>
            <p className="hidden sm:block text-gray-500 dark:text-gray-400 text-base font-light mt-1">
              Manage your wine site credentials
            </p>
          </div>
          <button
            onClick={() => setGuideOpen(true)}
            className="group flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl hover:border-[#800020]/40 hover:bg-[#800020]/5 transition-all flex-shrink-0 text-left"
          >
            <BookOpen className="w-4 h-4 text-[#800020] flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">How to get started</p>
              <p className="text-xs text-gray-400">Step-by-step guide</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 ml-2 group-hover:text-[#800020] transition-colors" />
          </button>
        </div>

        <GuideModal
          open={guideOpen}
          onOpenChange={setGuideOpen}
          title="Getting Started"
          pages={[
            {
              label: 'Overview',
              title: 'Get Connected in 2 Steps',
              description: 'To look up wine prices you need to connect your Cellar Tracker and/or Wine Searcher paid accounts. Enter your credentials and click Save & Connect.',
              image: connP1Img,
            },
            {
              label: 'Step 1 of 2',
              title: 'Connect Your Wine Accounts',
              description: 'Enter your credentials for Cellar Tracker and/or Wine Searcher paid accounts. The app connects on your behalf. Once connected, use the Enable toggle to include or exclude a source.',
              bullets: [
                'Enter your email/username and password for each source',
                'Click "Save & Connect", the app will connect to your accounts securely',
                'Toggle "Enable" to include or exclude a source from your lookups at any time',
                'If your credentials change, disconnect and reconnect here using the new ones',
                'If you see consistent errors in lookup results, try disconnecting and reconnecting your accounts here',
              ],
              image: connP2Img,
            },
            {
              label: 'Step 2 of 2',
              title: "You're Ready to Look Up Wines",
              description: 'Once at least one account shows "Connected" and is enabled you\'re all set. Head to the Lookup page to start comparing wine prices across Cellar Tracker and Wine Searcher.',
              image: connP3Img,
              link: { href: '/Lookup', label: 'Go to Wine Price Lookup' },
              note: 'Your credentials are stored securely and used only for price lookups.',
            },
          ]}
        />


        {/* Data Connections */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Data Connections</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {SITES.map((site) => {
            const cred = getCredential(site.key);
            const form = forms[site.key] || {};
            const Icon = site.icon;

            return (
              <Card key={site.key} className="border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-sm overflow-hidden">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${site.iconClass}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold dark:text-white">{site.name}</CardTitle>
                        <CardDescription className="text-sm mt-0.5">{site.description}</CardDescription>
                      </div>
                    </div>
                    {cred?.status === "connected" ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-0 gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Connected
                      </Badge>
                    ) : cred?.status === "error" ? (
                      <Badge className="bg-red-50 text-red-700 border-0 gap-1">
                        <XCircle className="w-3 h-3" /> Error
                      </Badge>
                    ) : cred?.status === "connecting" ? (
                      <Badge className="bg-yellow-50 text-yellow-700 border-0 gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Connecting
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-gray-50 dark:bg-gray-800 text-gray-400 border-0 gap-1">
                        <XCircle className="w-3 h-3" /> Not connected
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {cred?.status === 'error' && cred?.error_message && (
                    <div className="mb-3 p-3 rounded-md bg-red-50 border border-red-100 text-red-700 text-sm">
                      <div className="mt-0 break-words text-sm"><strong className="font-medium">Error:</strong> {cred.error_message}</div>
                    </div>
                  )}
                  {cred?.status === "connected" ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg px-4 py-3">
                        <div>
                          <p className="text-xs text-gray-400 uppercase tracking-wide">Account</p>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">{cred.email}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDisconnectConfirm(site.key)}
                          disabled={disconnecting[site.key]}
                          className="text-gray-400 hover:text-red-500 gap-1.5"
                        >
                          {disconnecting[site.key]
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                          {disconnecting[site.key] ? 'Disconnecting…' : 'Disconnect'}
                        </Button>
                      </div>
                      <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <Power className="w-4 h-4" />
                            Enable
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">Use this source when searching wines</p>
                        </div>
                        <Switch
                          checked={cred.is_enabled !== false}
                          onCheckedChange={(enabled) => handleToggleEnabled(site.key, enabled)}
                        />
                      </div>
                      <p className="text-xs text-gray-400">
                        Last connected: {cred.last_connected ? new Date(cred.last_connected).toLocaleDateString() : "—"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{site.usernameLabel}</Label>
                        <Input
                          value={form.username || ""}
                          onChange={(e) => updateForm(site.key, "username", e.target.value)}
                          placeholder={`Your ${site.urlHint} account`}
                          disabled={cred?.status === 'connecting'}
                          className="mt-1.5 h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Password</Label>
                        <div className="relative mt-1.5">
                          <Input
                            type={showPassword[site.key] ? "text" : "password"}
                            value={form.password || ""}
                            onChange={(e) => updateForm(site.key, "password", e.target.value)}
                            placeholder="••••••••"
                            disabled={cred?.status === 'connecting'}
                            className="h-10 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((p) => ({ ...p, [site.key]: !p[site.key] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            {showPassword[site.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <Button
                        onClick={() => handleSave(site.key)}
                        disabled={!form.username || !form.password || saving[site.key] || cred?.status === 'connecting'}
                        className="w-full h-10 bg-[#800020] hover:bg-[#6b001b] text-white font-medium gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Save className="w-4 h-4" />
                        {saving[site.key] ? "Connecting..." : "Save & Connect"}
                      </Button>
                      <p className="text-xs text-gray-400 text-center">
                        Credentials are stored securely and used only for price lookups
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          </div>
        </div>
      </div>
      <AlertDialog open={!!disconnectConfirm} onOpenChange={open => { if (!open) setDisconnectConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {SITES.find(s => s.key === disconnectConfirm)?.name ?? 'account'}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will sign you out of {SITES.find(s => s.key === disconnectConfirm)?.name ?? 'the site'} and delete your saved credentials. You will need to reconnect to use this source for lookups.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                const key = disconnectConfirm;
                setDisconnectConfirm(null);
                handleDisconnect(key);
              }}
            >
              Yes, disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
