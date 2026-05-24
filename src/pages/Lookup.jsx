// @ts-nocheck
import React, { useState, useEffect } from "react";
import { client } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wine, BookOpen, ChevronRight } from "lucide-react";
import GuideModal            from "@/components/GuideModal";
import guideP1 from "@/assets/guide/how-it-works-p1.png";
import guideP2 from "@/assets/guide/how-it-works-p2.png";
import guideP3 from "@/assets/guide/how-it-works-p3.png";
import guideP4_1 from "@/assets/guide/how-it-works-p4.1.png";
import guideP4_2 from "@/assets/guide/how-it-works-p4.2.png";
import guideP4_3 from "@/assets/guide/how-it-works-p4.3.png";
import guideP5 from "@/assets/guide/how-it-works-p5.png";
import guideP6 from "@/assets/guide/how-it-works-p6.png";
import guideP7 from "@/assets/guide/how-it-works-p7.png";
import WineInput from "@/components/wine/WineInput";
import WineResultsTable from "@/components/wine/WineResultsTable";
import OfferSummary from "@/components/wine/OfferSummary";
import BatchHistorySection from "@/components/wine/BatchHistorySection";
import { getApiBase } from "@/lib/utils";

async function fetchLookupUsage() {
  const token = localStorage.getItem("app_access_token");
  if (!token) return null;
  const base = getApiBase();
  const res = await fetch(`${base}/subscription/usage`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json(); // { used, limit, remaining, plan, percent }
}

function generateBatchId(prefix = "batch") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Helper: fetch batch list for a tab from server
async function fetchBatchesForTab(tab) {
  try {
    const token = localStorage.getItem('app_access_token');
    const base = getApiBase();
    const url = `${base}/batches?tab=${encodeURIComponent(tab)}`;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return { current: null, history: [] };
    return res.json();
  } catch (e) {
    return { current: null, history: [] };
  }
}

// Helper: fetch full grouped history (batches with wines) for a tab
async function fetchBatchHistoryForTab(tab) {
  try {
    const token = localStorage.getItem('app_access_token');
    const base = getApiBase();
    const url = `${base}/batches/history?tab=${encodeURIComponent(tab)}`;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    return res.json();
  } catch (e) {
    return [];
  }
}

export default function Lookup() {
  const [guideOpen, setGuideOpen] = useState(false);
  const [isLookingByTab, setIsLookingByTab] = useState({ single: false, paste: false, upload: false });
  const [lookupProgressByTab, setLookupProgressByTab] = useState({});
  const [activeTab, setActiveTab] = useState("single");
  // Lifted up from WineInput so handleWinesSubmit always reads the current value
  // directly — no risk of stale closures or state desync between the dropdown and submit.
  const [wsCurrency, setWsCurrency] = useState("USD");

  const queryClient = useQueryClient();

  // Each tab: fetch batch metadata from server (db-backed)
  const batchQueryOpts = { staleTime: 30_000, refetchOnWindowFocus: false };
  const { data: singleBatches = { current: null, history: [] } } = useQuery({ queryKey: ['batches','single'], queryFn: () => fetchBatchesForTab('single'), ...batchQueryOpts });
  const { data: pasteBatches = { current: null, history: [] } } = useQuery({ queryKey: ['batches','paste'], queryFn: () => fetchBatchesForTab('paste'), ...batchQueryOpts });
  const { data: uploadBatches = { current: null, history: [] } } = useQuery({ queryKey: ['batches','upload'], queryFn: () => fetchBatchesForTab('upload'), ...batchQueryOpts });
  const { data: imageBatches = { current: null, history: [] } } = useQuery({ queryKey: ['batches','image'], queryFn: () => fetchBatchesForTab('image'), ...batchQueryOpts });

  // Fetch grouped history (batches with wines) per tab so history is always available
  const { data: singleHistoryFromServer = [] } = useQuery({ queryKey: ['batches_history','single'], queryFn: () => fetchBatchHistoryForTab('single'), ...batchQueryOpts });
  const { data: pasteHistoryFromServer = [] } = useQuery({ queryKey: ['batches_history','paste'], queryFn: () => fetchBatchHistoryForTab('paste'), ...batchQueryOpts });
  const { data: uploadHistoryFromServer = [] } = useQuery({ queryKey: ['batches_history','upload'], queryFn: () => fetchBatchHistoryForTab('upload'), ...batchQueryOpts });
  const { data: imageHistoryFromServer = [] } = useQuery({ queryKey: ['batches_history','image'], queryFn: () => fetchBatchHistoryForTab('image'), ...batchQueryOpts });

  const singleCurrentId = singleBatches?.current || null;
  const singleHistoryIds = singleBatches?.history || [];
  const pasteCurrentId = pasteBatches?.current || null;
  const pasteHistoryIds = pasteBatches?.history || [];
  const uploadCurrentId = uploadBatches?.current || null;
  const uploadHistoryIds = uploadBatches?.history || [];
  const imageCurrentId = imageBatches?.current || null;
  const imageHistoryIds = imageBatches?.history || [];

  const { data: credentials = [] } = useQuery({
    queryKey: ["credentials"],
    queryFn: () => client.entities.SiteCredential.list(),
  });

  // Derive which sources are ready to use for lookups
  const ctCred  = credentials.find(c => c.site_name === 'cellar_tracker');
  const wsCred  = credentials.find(c => c.site_name === 'wine_searcher');
  const ctActive = !!(ctCred?.is_connected && ctCred?.status === 'connected' && ctCred?.is_enabled !== false);
  const wsActive = !!(wsCred?.is_connected && wsCred?.status === 'connected' && wsCred?.is_enabled !== false);
  const hasAnySource = ctActive || wsActive;

  const { data: lookupUsage, refetch: refetchLookupUsage } = useQuery({
    queryKey: ["lookup_usage"],
    queryFn: fetchLookupUsage,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const [showConnectionGate, setShowConnectionGate] = useState(false);

  // Fetch all relevant batch IDs for each tab
  const allSingleIds = [singleCurrentId, ...singleHistoryIds].filter(Boolean);
  const allPasteIds = [pasteCurrentId, ...pasteHistoryIds].filter(Boolean);
  const allUploadIds = [uploadCurrentId, ...uploadHistoryIds].filter(Boolean);
  const allImageIds = [imageCurrentId, ...imageHistoryIds].filter(Boolean);

  const pollWhilePending = (query) => {
    const data = query.state.data;
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.some(w => !w.is_deleted && w.status === 'pending') ? 3_000 : false;
  };

  const { data: singleAllData = [] } = useQuery({
    queryKey: ["wine_lookups_single_all", allSingleIds],
    queryFn: async () => {
      if (allSingleIds.length === 0) return [];
      const pages = await Promise.all(
        allSingleIds.map(id => client.entities.WineLookup.filter({ batch_id: id }, "-created_date", 100))
      );
      return pages.flat();
    },
    enabled: allSingleIds.length > 0,
    refetchInterval: pollWhilePending,
  });

  const { data: pasteAllData = [] } = useQuery({
    queryKey: ["wine_lookups_paste_all", allPasteIds],
    queryFn: async () => {
      if (allPasteIds.length === 0) return [];
      const pages = await Promise.all(
        allPasteIds.map(id => client.entities.WineLookup.filter({ batch_id: id }, "-created_date", 200))
      );
      return pages.flat();
    },
    enabled: allPasteIds.length > 0,
    refetchInterval: pollWhilePending,
  });

  const { data: uploadAllData = [] } = useQuery({
    queryKey: ["wine_lookups_upload_all", allUploadIds],
    queryFn: async () => {
      if (allUploadIds.length === 0) return [];
      const pages = await Promise.all(
        allUploadIds.map(id => client.entities.WineLookup.filter({ batch_id: id }, "-created_date", 200))
      );
      return pages.flat();
    },
    enabled: allUploadIds.length > 0,
    refetchInterval: pollWhilePending,
  });

  const { data: imageAllData = [] } = useQuery({
    queryKey: ["wine_lookups_image_all", allImageIds],
    queryFn: async () => {
      if (allImageIds.length === 0) return [];
      const pages = await Promise.all(
        allImageIds.map(id => client.entities.WineLookup.filter({ batch_id: id }, "-created_date", 200))
      );
      return pages.flat();
    },
    enabled: allImageIds.length > 0,
    refetchInterval: pollWhilePending,
  });

  // Exclude deleted lookup rows from client-side data (server API already excludes them,
  // but ensure client fallbacks also drop deleted entries).
  const singleAllDataFiltered = (singleAllData || []).filter(w => !w.is_deleted);
  const pasteAllDataFiltered = (pasteAllData || []).filter(w => !w.is_deleted);
  const uploadAllDataFiltered = (uploadAllData || []).filter(w => !w.is_deleted);
  const imageAllDataFiltered = (imageAllData || []).filter(w => !w.is_deleted);

  // Group flat data by batch_id into structured batches
  function groupIntoBatches(data, currentId, historyIds) {
    const byBatch = {};
    data.forEach(w => {
      // Use demo fake date if available so history grouping works correctly
      const effectiveDate = w.created_date;
      if (!byBatch[w.batch_id]) byBatch[w.batch_id] = { id: w.batch_id, wines: [], date: effectiveDate };
      byBatch[w.batch_id].wines.push(w);
    });

    const sortWines = wines => [...wines].sort((a, b) =>
      (a.row_order ?? Infinity) - (b.row_order ?? Infinity) || new Date(a.created_date) - new Date(b.created_date)
    );

    const current = currentId && byBatch[currentId]
      ? { ...byBatch[currentId], wines: sortWines(byBatch[currentId].wines) }
      : null;

    const history = historyIds
      .filter(id => byBatch[id])
      .map(id => ({ ...byBatch[id], wines: sortWines(byBatch[id].wines) }));

    return { current, history };
  }

  const single = groupIntoBatches(singleAllDataFiltered, singleCurrentId, singleHistoryIds);
  // For single, current is all data in singleCurrentId batch, history is singleHistoryIds
  // But single appends each wine to current batch — so current = all singleAllData from currentId
  // Actually for Single Search: each search is its own "batch" but we want latest on top as one table
  // Reinterpret: singleCurrentId = most recent batch, singleHistoryIds = older batches
  const singleCurrentWines = single.current ? single.current.wines : [];
  
  const paste = groupIntoBatches(pasteAllDataFiltered, pasteCurrentId, pasteHistoryIds);
  const pasteCurrentWines = paste.current ? paste.current.wines : [];
  
  const upload = groupIntoBatches(uploadAllDataFiltered, uploadCurrentId, uploadHistoryIds);
  const uploadCurrentWines = upload.current ? upload.current.wines : [];

  const image = groupIntoBatches(imageAllDataFiltered, imageCurrentId, imageHistoryIds);
  const imageCurrentWines = image.current ? image.current.wines : [];
  
  // Prefer server-provided grouped history (includes wines) when available
  const singleHistoryBase = (singleHistoryFromServer && singleHistoryFromServer.length > 0) ? singleHistoryFromServer : single.history;
  const pasteHistoryBase = (pasteHistoryFromServer && pasteHistoryFromServer.length > 0) ? pasteHistoryFromServer : paste.history;
  const uploadHistoryBase = (uploadHistoryFromServer && uploadHistoryFromServer.length > 0) ? uploadHistoryFromServer : upload.history;
  const imageHistoryBase = (imageHistoryFromServer && imageHistoryFromServer.length > 0) ? imageHistoryFromServer : image.history;

  // Ensure the latest batch (current) is also present in the history grouping so
  // it appears in "Today" / "This Month" groups. If the server history already
  // includes it, leave as-is. Otherwise, prepend a synthetic batch entry using
  // the latest wines data.
  function ensureLatestInHistory(historyBase, latestBatchId, latestWines) {
    if (!historyBase) historyBase = [];
    if (!latestBatchId) return historyBase;
    const found = historyBase.find(b => b.id === latestBatchId);
    if (found) return historyBase;
    if (!latestWines || latestWines.length === 0) return historyBase;
    const date = latestWines[0].created_date || new Date().toISOString();
    const batch = { id: latestBatchId, date, wines: latestWines };
    return [batch, ...historyBase];
  }
  // Determine latest batch id and wines for each tab (prefer current, fallback to server-provided history order)
  const singleLatestBatchId = singleCurrentId || (singleHistoryBase && singleHistoryBase.length > 0 ? singleHistoryBase[0].id : null);
  const pasteLatestBatchId = pasteCurrentId || (pasteHistoryBase && pasteHistoryBase.length > 0 ? pasteHistoryBase[0].id : null);
  const uploadLatestBatchId = uploadCurrentId || (uploadHistoryBase && uploadHistoryBase.length > 0 ? uploadHistoryBase[0].id : null);
  const imageLatestBatchId = imageCurrentId || (imageHistoryBase && imageHistoryBase.length > 0 ? imageHistoryBase[0].id : null);

  const singleLatestWines = (singleCurrentWines && singleCurrentWines.length > 0)
    ? singleCurrentWines
    : (singleHistoryBase && singleHistoryBase.find(b => b.id === singleLatestBatchId)?.wines || []);
  const pasteLatestWines = (pasteCurrentWines && pasteCurrentWines.length > 0)
    ? pasteCurrentWines
    : (pasteHistoryBase && pasteHistoryBase.find(b => b.id === pasteLatestBatchId)?.wines || []);
  const uploadLatestWines = (uploadCurrentWines && uploadCurrentWines.length > 0)
    ? uploadCurrentWines
    : (uploadHistoryBase && uploadHistoryBase.find(b => b.id === uploadLatestBatchId)?.wines || []);
  const imageLatestWines = (imageCurrentWines && imageCurrentWines.length > 0)
    ? imageCurrentWines
    : (imageHistoryBase && imageHistoryBase.find(b => b.id === imageLatestBatchId)?.wines || []);

  // Now ensure the latest batch is included in the history arrays so grouping shows it
  const singleHistory = ensureLatestInHistory(singleHistoryBase, singleLatestBatchId, singleLatestWines);
  const pasteHistory = ensureLatestInHistory(pasteHistoryBase, pasteLatestBatchId, pasteLatestWines);
  const uploadHistory = ensureLatestInHistory(uploadHistoryBase, uploadLatestBatchId, uploadLatestWines);
  const imageHistory = ensureLatestInHistory(imageHistoryBase, imageLatestBatchId, imageLatestWines);

  const handleWinesSubmit = async (wines, source) => {
    // At least one source must be connected and enabled.
    if (!hasAnySource) {
      setShowConnectionGate(true);
      return;
    }

    // Read directly from Lookup's own state — not from a parameter.
    // This is the authoritative source and is always current, regardless of
    // any re-render timing between WineInput's dropdown and the submit button.
    const currency = wsCurrency || 'USD';
    const isSingle = source === "single";
    const isPaste = source === "paste";
    const isUpload = source === "upload";
    const isImage = source === "image";
    const prefix = isSingle ? "single" : isPaste ? "list" : isUpload ? "file" : "image";
    const batchId = generateBatchId(prefix);
    let qKey;
    let tab = 'single';
    if (isSingle) { qKey = ["wine_lookups_single_all"]; tab = 'single'; }
    else if (isPaste) { qKey = ["wine_lookups_paste_all"]; tab = 'paste'; }
    else if (isImage) { qKey = ["wine_lookups_image_all"]; tab = 'image'; }
    else { qKey = ["wine_lookups_upload_all"]; tab = 'upload'; }

    setIsLookingByTab(prev => ({ ...(prev || {}), [tab]: true }));
    setLookupProgressByTab(prev => ({ ...(prev || {}), [tab]: { current: 0, total: wines.length, currentWine: "" } }));

    const enabledSources = {
      cellar_tracker: credentials.find(c => c.site_name === "cellar_tracker")?.is_enabled !== false,
      wine_searcher: credentials.find(c => c.site_name === "wine_searcher")?.is_enabled !== false,
    };

    const records = wines.map(w => ({
      wine_name: w.name,
      vintage: w.vintage || "",
      size: w.size && String(w.size).trim() !== "" ? String(w.size).trim() : null,
      batch_id: batchId,
      status: "pending",
      ws_currency: currency,
    }));

    const created = await client.entities.WineLookup.bulkCreate(records);
    // refresh local lists + usage counter
    queryClient.invalidateQueries({ queryKey: qKey });
    queryClient.invalidateQueries({ queryKey: ['batches', tab] });
    refetchLookupUsage();

    // ── Server path: Playwright-based server-side lookup ────────────────────
    setIsLookingByTab(prev => ({ ...(prev || {}), [tab]: true }));
    setLookupProgressByTab(prev => ({ ...(prev || {}), [tab]: { current: 0, total: created.length, currentWine: '' } }));
    try {
      const token = localStorage.getItem('app_access_token');
      const base  = getApiBase();

      await fetch(`${base}/lookup/${batchId}/run?currency=${encodeURIComponent(currency)}`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      const esUrl = `${base}/lookup/${batchId}/stream${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
      const es = new EventSource(esUrl);
      let refreshTimer = null;
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          const msg = d.msg || d;
          setLookupProgressByTab(prev => {
            const cur = (prev && prev[tab]) ? { ...prev[tab] } : { current: 0, total: created.length, currentWine: '' };
            if (/^Looking up/i.test(msg) || /^Updated/i.test(msg)) cur.current = Math.min((cur.current || 0) + 1, created.length);
            cur.currentWine = msg;
            return { ...(prev || {}), [tab]: cur };
          });
          // Refresh the result table incrementally as each wine completes
          if (/^Updated/i.test(msg)) {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => queryClient.invalidateQueries({ queryKey: qKey }), 300);
          }
          if (/finished/i.test(msg)) {
            clearTimeout(refreshTimer);
            es.close();
            setIsLookingByTab(prev => ({ ...(prev || {}), [tab]: false }));
            setLookupProgressByTab(prev => { const np = { ...(prev || {}) }; delete np[tab]; return np; });
            queryClient.invalidateQueries({ queryKey: qKey });
            queryClient.invalidateQueries({ queryKey: ['batches', tab] });
            queryClient.invalidateQueries({ queryKey: ['batches_history', tab] });
          }
        } catch (e) {}
      };
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          clearTimeout(refreshTimer);
          setIsLookingByTab(prev => ({ ...(prev || {}), [tab]: false }));
          setLookupProgressByTab(prev => { const np = { ...(prev || {}) }; delete np[tab]; return np; });
          queryClient.invalidateQueries({ queryKey: qKey });
          queryClient.invalidateQueries({ queryKey: ['batches', tab] });
          queryClient.invalidateQueries({ queryKey: ['batches_history', tab] });
        }
      };
    } catch (err) {
      setIsLookingByTab(prev => ({ ...(prev || {}), [tab]: false }));
      setLookupProgressByTab(prev => { const np = { ...(prev || {}) }; delete np[tab]; return np; });
      // mark all created as error
      for (const rec of created) {
        try { await client.entities.WineLookup.update(rec.id, { status: 'error' }); } catch (e) {}
      }
      // Refund credits: soft-delete wines that got no results so they don't count against the monthly limit
      try {
        const token = localStorage.getItem('app_access_token');
        const base  = getApiBase();
        await fetch(`${base}/lookup/${batchId}/refund-credits`, {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
      } catch (e) {}
      queryClient.invalidateQueries({ queryKey: qKey });
    }
  };

  const handleUpdateOfferPrice = async (id, price) => {
    await client.entities.WineLookup.update(id, { offer_price: price });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_paste_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_upload_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_image_all"] });
  };

  const handleUpdateOfferCurrency = async (id, currency) => {
    await client.entities.WineLookup.update(id, { offer_price_currency: currency });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_paste_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_upload_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_image_all"] });
  };

  const handleUpdateCtCurrency = async (id, currency) => {
    await client.entities.WineLookup.update(id, { ct_currency: currency });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_paste_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_upload_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_image_all"] });
  };

  // Clear helpers
  const deleteWines = async (wines) => {
    for (const w of (wines || [])) {
      try {
        await client.entities.WineLookup.update(w.id, { is_deleted: true });
      } catch (e) {
        try { await client.entities.WineLookup.delete(w.id); } catch (e2) {}
      }
    }
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_paste_all"] });
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_upload_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','single'] });
    queryClient.invalidateQueries({ queryKey: ['batches','paste'] });
    queryClient.invalidateQueries({ queryKey: ['batches','upload'] });
  };

  const handleClearSingleCurrent = async () => {
    // clear current/latest single batch
    const batch = singleHistory && singleHistory.find(b => b.id === singleLatestBatchId);
    if (single.current) await deleteWines(single.current.wines);
    else if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','single'] });
  };

  const handleClearLatestSingle = async () => {
    const batch = singleHistory && singleHistory.find(b => b.id === singleLatestBatchId);
    if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','single'] });
  };

  const handleClearSingleBatch = async (batchId) => {
    const batch = singleHistory.find(b => b.id === batchId) || single.history.find(b => b.id === batchId);
    if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','single'] });
  };

  const handleClearAllSingleHistory = async () => {
    const batchesToClear = (singleHistory && singleHistory.length > 0) ? singleHistory : single.history;
    for (const batch of batchesToClear) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','single'] });
  };

  const handleClearPasteCurrent = async () => {
    const batch = pasteHistory && pasteHistory.find(b => b.id === pasteLatestBatchId);
    if (paste.current) await deleteWines(paste.current.wines);
    else if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_paste_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','paste'] });
  };

  const handleClearLatestPaste = async () => {
    const batch = pasteHistory && pasteHistory.find(b => b.id === pasteLatestBatchId);
    if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_paste_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','paste'] });
  };

  const handleClearPasteBatch = async (batchId) => {
    const batch = pasteHistory.find(b => b.id === batchId) || paste.history.find(b => b.id === batchId);
    if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_paste_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','paste'] });
  };

  const handleClearAllPasteHistory = async () => {
    const batchesToClear = (pasteHistory && pasteHistory.length > 0) ? pasteHistory : paste.history;
    for (const batch of batchesToClear) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_paste_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','paste'] });
  };

  const handleClearUploadCurrent = async () => {
    const batch = uploadHistory && uploadHistory.find(b => b.id === uploadLatestBatchId);
    if (upload.current) await deleteWines(upload.current.wines);
    else if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_upload_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','upload'] });
  };

  const handleClearLatestUpload = async () => {
    const batch = uploadHistory && uploadHistory.find(b => b.id === uploadLatestBatchId);
    if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_upload_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','upload'] });
  };

  const handleClearUploadBatch = async (batchId) => {
    const batch = uploadHistory.find(b => b.id === batchId) || upload.history.find(b => b.id === batchId);
    if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_upload_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','upload'] });
  };

  const handleClearAllUploadHistory = async () => {
    const batchesToClear = (uploadHistory && uploadHistory.length > 0) ? uploadHistory : upload.history;
    for (const batch of batchesToClear) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_upload_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','upload'] });
  };

  const handleClearImageCurrent = async () => {
    const batch = imageHistory && imageHistory.find(b => b.id === imageLatestBatchId);
    if (image.current) await deleteWines(image.current.wines);
    else if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_image_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','image'] });
  };

  const handleClearImageBatch = async (batchId) => {
    const batch = imageHistory.find(b => b.id === batchId) || image.history.find(b => b.id === batchId);
    if (batch) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_image_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','image'] });
  };

  const handleClearAllImageHistory = async () => {
    const batchesToClear = (imageHistory && imageHistory.length > 0) ? imageHistory : image.history;
    for (const batch of batchesToClear) await deleteWines(batch.wines);
    queryClient.invalidateQueries({ queryKey: ["wine_lookups_image_all"] });
    queryClient.invalidateQueries({ queryKey: ['batches','image'] });
  };

  const handleDeleteRow = async (id) => {
    try {
      await client.entities.WineLookup.update(id, { is_deleted: true });
      queryClient.invalidateQueries({ queryKey: ["wine_lookups_single_all"] });
      queryClient.invalidateQueries({ queryKey: ["wine_lookups_paste_all"] });
      queryClient.invalidateQueries({ queryKey: ["wine_lookups_upload_all"] });
      queryClient.invalidateQueries({ queryKey: ['batches','single'] });
      queryClient.invalidateQueries({ queryKey: ['batches','paste'] });
      queryClient.invalidateQueries({ queryKey: ['batches','upload'] });
    } catch (e) {
      // ignore
    }
  };

  const isLookingCurrent = !!(isLookingByTab && isLookingByTab[activeTab]);
  const isEmpty =
    (activeTab === "single" && singleCurrentWines.length === 0 && (!singleHistory || singleHistory.length === 0)) ||
    (activeTab === "paste" && pasteCurrentWines.length === 0 && (!pasteHistory || pasteHistory.length === 0)) ||
    (activeTab === "upload" && uploadCurrentWines.length === 0 && (!uploadHistory || uploadHistory.length === 0)) ||
    (activeTab === "image" && imageCurrentWines.length === 0 && (!imageHistory || imageHistory.length === 0));

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-black">
      <div className="px-6 lg:px-12 xl:px-16 py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 mb-0">
            <div>
              <h1 className="text-2xl md:text-3xl font-serif font-bold text-gray-900 dark:text-white tracking-tight">
                Wine Price Lookup
              </h1>
              <p className="hidden sm:block text-gray-500 dark:text-gray-400 text-base font-light mt-1">
                Compare market prices across Cellar Tracker and Wine Searcher
              </p>
            </div>
            <button
              onClick={() => setGuideOpen(true)}
              className="group flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl hover:border-[#800020]/40 hover:bg-[#800020]/5 transition-all flex-shrink-0 text-left mt-1"
            >
              <BookOpen className="w-4 h-4 text-[#800020] flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">How it works</p>
                <p className="text-xs text-gray-400">Quick start guide</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 ml-2 group-hover:text-[#800020] transition-colors" />
            </button>
          </div>
          {/* Status row: source pills */}
          <div className="flex flex-wrap items-center gap-2 mt-3">

            {/* Source pills — always visible so users know what will run */}
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium
              ${ctActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-100 border-gray-200 text-gray-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${ctActive ? 'bg-green-500' : 'bg-gray-300'}`} />
              Cellar Tracker {ctActive ? 'on' : ctCred?.is_connected ? 'disabled' : 'not connected'}
            </div>

            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium
              ${wsActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-100 border-gray-200 text-gray-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${wsActive ? 'bg-green-500' : 'bg-gray-300'}`} />
              Wine Searcher {wsActive ? 'on' : wsCred?.is_connected ? 'disabled' : 'not connected'}
            </div>

            {/* Link to Connections when nothing is set up */}
            {!hasAnySource && (
              <a href="/Connections" className="text-xs text-[#800020] underline underline-offset-2 font-medium">
                Connect accounts →
              </a>
            )}
          </div>


          {/* Notes & Remarks */}
          {hasAnySource && (
            <div className="mt-4 p-3.5 rounded-xl border border-gray-200 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">Important!</p>
              <ul className="text-xs text-gray-500 dark:text-gray-400 list-disc list-inside space-y-0.5">
                <li>The best price does not equate to the best deal. Contact your local wine merchant for more information.</li>
                <li>For full and accurate results, paid Cellar Tracker and Wine Searcher accounts are required.</li>
              </ul>
            </div>
          )}

          {/* No-connection gate banner */}
          {showConnectionGate && !hasAnySource && (
            <div className="mt-4 p-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-red-900 dark:text-red-200">No sources connected</p>
                  <p className="text-xs text-red-700 dark:text-red-400 mt-1 leading-relaxed">
                    At least one source must be connected and enabled before running a lookup.
                    Connect Cellar Tracker, Wine Searcher Pro, or both. Note: only <strong>paid accounts</strong> return full pricing data — free accounts will give limited or no results.
                  </p>
                  <a href="/Connections" className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-red-800 dark:text-red-300 underline underline-offset-2">
                    Go to Connections →
                  </a>
                </div>
                <button onClick={() => setShowConnectionGate(false)} className="text-red-400 hover:text-red-600 dark:text-red-400 flex-shrink-0 text-lg leading-none" aria-label="Dismiss">×</button>
              </div>
            </div>
          )}
        </div>

        <GuideModal
          open={guideOpen}
          onOpenChange={setGuideOpen}
          title="How it works"
          pages={[
            {
              label: 'Overview',
              title: 'Wine Price Lookup',
              description: 'Search wine prices across Cellar Tracker and Wine Searcher in seconds. You can look up a single wine, paste a list, upload a file, or upload a photo.',
              image: guideP1,
            },
            {
              label: 'How it Works',
              title: 'How Lookups Work',
              description: 'We use your connected accounts to search Cellar Tracker and Wine Searcher (paid versions) on your behalf and return the results directly here.',
              image: guideP2,
            },
            {
              label: 'Before You Start',
              title: 'Connect Your Accounts First',
              description: 'Visit the Connections page to link your accounts. Having both Cellar Tracker and Wine Searcher connected gives you the most complete results.',
              bullets: [
                'Connect Cellar Tracker and/or Wine Searcher with your credentials on the Connections page',
                'Enable each source using the toggle on its connection card',
                'Return here and active sources appear as green pills in the header',
                'Important: you must use paid accounts - free accounts return limited or no pricing data',
              ],
              image: guideP3,
              link: { href: '/Connections', label: 'Go to Connections' },
            },
            {
              label: 'Running a Lookup',
              title: 'Choose Your Method & Currency',
              description: 'Use the tabs at the top of the search box to select how you\'d like to enter wines. Set the Wine Searcher currency before running, it applies to all WS prices in that batch.',
              bullets: [
                'Single Search - type one wine name at a time',
                'Paste List - paste multiple wine names, one per line',
                'Upload File - upload a CSV, TSV, TXT, or Excel file with a list of wines',
                'AI Image Search - upload an image containing wine bottles and wine names',
                'WS Currency - select your preferred currency from the dropdown next to the search box (e.g. USD, AUD, GBP)',
              ],
              images: [guideP4_1, guideP4_2, guideP4_3],
            },
            {
              label: 'Results Table',
              title: 'Reading Your Results',
              description: 'Results appear in the table as they come in. Prices from both sources are shown side by side, with calculated columns and live currency conversion.',
              bullets: [
                'CT AVG VALUE, CT AUCTION AVG - Cellar Tracker community average and auction average',
                'WS AVG PRICE, WS MIN PRICE - Wine Searcher global average and lowest listed price (could be a bottle of wine or a case of bottles)',
                'WS CURRENCY - the currency you selected for Wine Searcher',
                'MATCHED AS - links of the identified wine in each source',
                'STATUS - whether the lookup succeeded',
                'OFFER - allows you to add your offered price',
                'Calculated columns - in "Columns" filter, custom formula columns you can add to compare or combine values',
              ],
              image: guideP5,
            },
            {
              label: 'Calculated Columns',
              title: 'Add Calculated Columns',
              description: 'Custom formula columns let you combine or compare any numeric values in your results table, useful for evaluating an offer against market data.',
              bullets: [
                'Open the "Columns" panel and select "Add Calculated Column"',
                'Name your column and write a formula using existing column names (e.g. OFFER - CT AVG VALUE)',
                'Example: OFFER - WS AVG PRICE → shows how your offer compares to the Wine Searcher average',
                'Example: CT AVG VALUE / WS MIN PRICE→ ratio of Cellar Tracker average to the cheapest WS listing',
                'Calculated columns are saved to your account and persist until you delete them - they are also included in CSV exports',
              ],
              image: guideP6,
            },
            {
              label: 'Export & Manage',
              title: 'Export, Clear & Columns Buttons',
              description: 'Once results are in, you can export the full table, delete individual or all rows, and rearrange columns.',
              bullets: [
                'Export CSV - downloads the results as a CSV file',
                'Clear - remove a single result using the delete icon on that row, or removes all results in a grouped batch',
                'Columns - allows you to adjust your result table columns, add calculated columns, and arrange the column order',
                'Previous Results - past lookup batches are grouped by date below the results table',
              ],
              image: guideP7,
            },
          ]}
        />

        {/* Input */}
        <div className="mb-6">
          <WineInput onWinesSubmit={handleWinesSubmit} isLoading={isLookingCurrent} onTabChange={setActiveTab} lookupUsage={lookupUsage} wsCurrency={wsCurrency} onCurrencyChange={setWsCurrency} />
        </div>

        {/* Progress (per-tab) */}
        {(() => {
          const currentProgress = lookupProgressByTab ? lookupProgressByTab[activeTab] : null;
          if (!currentProgress) return null;
          return (
            <div className="mb-6 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-[#800020] animate-spin" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Looking up prices...</span>
                </div>
                <span className="text-sm text-gray-400 tabular-nums">{currentProgress.current} / {currentProgress.total}</span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                <div
                  className="bg-[#800020] h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${currentProgress.total > 0 ? (currentProgress.current / currentProgress.total) * 100 : 0}%` }}
                />
              </div>
              {currentProgress.currentWine && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 truncate">
                  Now looking up: {currentProgress.currentWine}
                </p>
              )}
            </div>
          );
        })()}

        {/* Single Search Results */}
        {activeTab === "single" && (singleCurrentWines.length > 0 || (singleHistory && singleHistory.length > 0)) && (
          <div className="mb-8">
            {singleCurrentWines.length > 0 && (
              <>
                <div className="mb-3 px-1">
                  <h2 className="text-base font-serif font-semibold text-gray-900 dark:text-white">
                    Latest Results
                    <span className="ml-2 text-sm font-sans font-normal text-gray-400">({singleCurrentWines.length} wines)</span>
                  </h2>
                </div>
                <OfferSummary results={singleCurrentWines} />
                <div className="mt-4">
                  <WineResultsTable results={singleCurrentWines} onUpdateOfferPrice={handleUpdateOfferPrice} onUpdateOfferCurrency={handleUpdateOfferCurrency} onUpdateCtCurrency={handleUpdateCtCurrency} onClear={handleClearSingleCurrent} filenamePrefix={"single"} />
                </div>
              </>
            )}
            {/* history for single is shown below in the unified history section */}
          </div>
        )}

        {/* Paste List Results */}
        {activeTab === "paste" && (pasteCurrentWines.length > 0 || (pasteHistory && pasteHistory.length > 0)) && (
          <div className="mb-8">
            {pasteCurrentWines.length > 0 && (
              <>
                <div className="mb-3 px-1">
                  <h2 className="text-base font-serif font-semibold text-gray-900 dark:text-white">
                    Latest Batch Results
                    <span className="ml-2 text-sm font-sans font-normal text-gray-400">({pasteCurrentWines.length} wines)</span>
                  </h2>
                </div>
                <OfferSummary results={pasteCurrentWines} />
                <div className="mt-4">
                  <WineResultsTable results={pasteCurrentWines} onUpdateOfferPrice={handleUpdateOfferPrice} onUpdateOfferCurrency={handleUpdateOfferCurrency} onUpdateCtCurrency={handleUpdateCtCurrency} onClear={handleClearPasteCurrent} filenamePrefix={"list"} />
                </div>
              </>
            )}
            {/* history for paste is shown below in the unified history section */}
          </div>
        )}

        {/* Image Search Results */}
        {activeTab === "image" && (imageCurrentWines.length > 0 || (imageHistory && imageHistory.length > 0)) && (
          <div className="mb-8">
            {imageCurrentWines.length > 0 && (
              <>
                <div className="mb-3 px-1">
                  <h2 className="text-base font-serif font-semibold text-gray-900 dark:text-white">
                    Latest Image Results
                    <span className="ml-2 text-sm font-sans font-normal text-gray-400">({imageCurrentWines.length} wines)</span>
                  </h2>
                </div>
                <OfferSummary results={imageCurrentWines} />
                <div className="mt-4">
                  <WineResultsTable results={imageCurrentWines} onUpdateOfferPrice={handleUpdateOfferPrice} onUpdateOfferCurrency={handleUpdateOfferCurrency} onUpdateCtCurrency={handleUpdateCtCurrency} onClear={handleClearImageCurrent} filenamePrefix={"image"} />
                </div>
              </>
            )}
          </div>
        )}

        {/* Upload File Results */}
        {activeTab === "upload" && (uploadCurrentWines.length > 0 || (uploadHistory && uploadHistory.length > 0)) && (
          <div className="mb-8">
            {uploadCurrentWines.length > 0 && (
              <>
                <div className="mb-3 px-1">
                  <h2 className="text-base font-serif font-semibold text-gray-900 dark:text-white">
                    Latest File Results
                    <span className="ml-2 text-sm font-sans font-normal text-gray-400">({uploadCurrentWines.length} wines)</span>
                  </h2>
                </div>
                <OfferSummary results={uploadCurrentWines} />
                <div className="mt-4">
                  <WineResultsTable results={uploadCurrentWines} onUpdateOfferPrice={handleUpdateOfferPrice} onUpdateOfferCurrency={handleUpdateOfferCurrency} onUpdateCtCurrency={handleUpdateCtCurrency} onClear={handleClearUploadCurrent} filenamePrefix={"file"} />
                </div>
              </>
            )}
            {/* history for upload is shown below in the unified history section */}
          </div>
        )}

        {/* History panel for the active tab (always visible below search/progress) */}
        <div className="mb-8">
          <div>
            {activeTab === 'single' && (
              <>
                <h3 className="text-sm font-serif font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Single Search - Previous Results</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">History kept for 6 months.</p>
                {(singleHistory && singleHistory.length > 0) ? (
                  <BatchHistorySection
                    batches={singleHistory}
                    onClearBatch={handleClearSingleBatch}
                    onClearAll={handleClearAllSingleHistory}
                    onUpdateOfferPrice={handleUpdateOfferPrice}
                    onUpdateOfferCurrency={handleUpdateOfferCurrency}
                    onUpdateCtCurrency={handleUpdateCtCurrency}
                    onDeleteRow={handleDeleteRow}
                    latestBatchId={singleLatestBatchId}
                    prefix="single"
                  />
                ) : (
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 text-sm text-gray-500">
                    No previous result yet.
                  </div>
                )}
              </>
            )}

            {activeTab === 'paste' && (
              <>
                <h3 className="text-sm font-serif font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Paste List - Previous Results</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">History kept for 6 months.</p>
                {(pasteHistory && pasteHistory.length > 0) ? (
                  <BatchHistorySection
                    batches={pasteHistory}
                    onClearBatch={handleClearPasteBatch}
                    onClearAll={handleClearAllPasteHistory}
                    onUpdateOfferPrice={handleUpdateOfferPrice}
                    onUpdateOfferCurrency={handleUpdateOfferCurrency}
                    onUpdateCtCurrency={handleUpdateCtCurrency}
                    onDeleteRow={handleDeleteRow}
                    latestBatchId={pasteLatestBatchId}
                    prefix="list"
                  />
                ) : (
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 text-sm text-gray-500">
                    No previous result yet.
                  </div>
                )}
              </>
            )}

            {activeTab === 'image' && (
              <>
                <h3 className="text-sm font-serif font-semibold text-gray-700 dark:text-gray-300 mb-0.5">AI Image Search - Previous Results</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">History kept for 6 months.</p>
                {(imageHistory && imageHistory.length > 0) ? (
                  <BatchHistorySection
                    batches={imageHistory}
                    onClearBatch={handleClearImageBatch}
                    onClearAll={handleClearAllImageHistory}
                    onUpdateOfferPrice={handleUpdateOfferPrice}
                    onUpdateOfferCurrency={handleUpdateOfferCurrency}
                    onUpdateCtCurrency={handleUpdateCtCurrency}
                    onDeleteRow={handleDeleteRow}
                    latestBatchId={imageLatestBatchId}
                    prefix="image"
                  />
                ) : (
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 text-sm text-gray-500">
                    No previous result yet.
                  </div>
                )}
              </>
            )}

            {activeTab === 'upload' && (
              <>
                <h3 className="text-sm font-serif font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Upload File - Previous Results</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">History kept for 6 months.</p>
                {(uploadHistory && uploadHistory.length > 0) ? (
                  <BatchHistorySection
                    batches={uploadHistory}
                    onClearBatch={handleClearUploadBatch}
                    onClearAll={handleClearAllUploadHistory}
                    onUpdateOfferPrice={handleUpdateOfferPrice}
                    onUpdateOfferCurrency={handleUpdateOfferCurrency}
                    onUpdateCtCurrency={handleUpdateCtCurrency}
                    onDeleteRow={handleDeleteRow}
                    latestBatchId={uploadLatestBatchId}
                    prefix="file"
                  />
                ) : (
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 text-sm text-gray-500">
                    No previous result yet.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Empty State */}
        {isEmpty && !isLookingCurrent && (
          <div className="text-center py-20">
            <Wine className="w-12 h-12 text-gray-200 mx-auto mb-4" strokeWidth={1} />
            <p className="text-gray-400 text-lg font-light">No wine lookups yet</p>
          </div>
        )}
      </div>
    </div>
  );
}