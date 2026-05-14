import React, { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Plus, Trash2, ImageIcon, AlertTriangle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { createPageUrl } from "@/utils";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

// Read the first 16 bytes to detect the true format, ignoring file.type which iOS lies about.
// iOS camera captures set file.type="image/jpeg"/name="image.jpg" but the bytes are HEIC.
async function sniffMime(/** @type {File} */ file) {
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = e => {
      const b = new Uint8Array(/** @type {ArrayBuffer} */ (e.target?.result));
      // JPEG
      if (b[0] === 0xff && b[1] === 0xd8) return resolve('image/jpeg');
      // PNG
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return resolve('image/png');
      // WebP (RIFF....WEBP)
      if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
          b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return resolve('image/webp');
      // GIF
      if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return resolve('image/gif');
      // HEIC/HEIF — ISO base-media file with 'ftyp' box starting at byte 4
      if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
        const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
        if (['heic','heis','hevc','hevx','heim','heix','hevm','hevs'].includes(brand)) return resolve('image/heic');
        if (['mif1','msf1'].includes(brand)) return resolve('image/heif');
        // Generic ISOBMFF — still try as HEIC
        return resolve('image/heic');
      }
      resolve(file.type || 'image/jpeg');
    };
    fr.onerror = () => resolve(file.type || 'image/jpeg');
    fr.readAsArrayBuffer(file.slice(0, 16));
  });
}

// MAX_UPLOAD_BYTES: keep source file under this so the base64 JSON body stays
// well under nginx's default 1 MB client_max_body_size (800 KB → ~1.07 MB base64).
const MAX_UPLOAD_BYTES = 800 * 1024;
const MAX_DIM = 1600;
const JPEG_QUALITY = 0.85;

// Returns { file, origType, sniffedType, converted } for debug display.
async function normalizeImageFile(/** @type {File} */ file) {
  const origType = file.type;
  const sniffedType = await sniffMime(file);

  const WEB_SAFE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  // Fast path: confirmed web-safe AND small enough to upload unchanged
  if (WEB_SAFE.includes(sniffedType) && file.size <= MAX_UPLOAD_BYTES) {
    return { file, origType, sniffedType, converted: false };
  }

  // Either format isn't web-safe (HEIC) OR file is too large (full-res camera JPEG).
  // Load via data URL using the sniffed MIME so iOS decodes HEIC correctly,
  // then resize + re-encode as JPEG to keep the upload body small.
  try {
    const rawBase64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(/** @type {string} */ (fr.result).split(',')[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = `data:${sniffedType};base64,${rawBase64}`;
    });
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > MAX_DIM || h > MAX_DIM) {
      const s = MAX_DIM / Math.max(w, h);
      w = Math.round(w * s); h = Math.round(h * s);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res, rej) =>
      canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', JPEG_QUALITY)
    );
    const converted = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
    return { file: converted, origType, sniffedType, converted: true };
  } catch (err) {
    return { file, origType, sniffedType, converted: false, conversionError: err instanceof Error ? err.message : String(err) };
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function runOcr(file, signal) {
  const token = localStorage.getItem("app_access_token");
  let imageBase64;
  try {
    imageBase64 = await fileToBase64(file);
  } catch (e) {
    throw new Error(`Could not read file (${Math.round((file?.size || 0) / 1024)}KB): ${e instanceof Error ? e.message : e}`);
  }
  const sizeKB = Math.round((imageBase64.length * 0.75) / 1024);
  let res;
  try {
    res = await fetch(`${API_BASE}/ocr/image`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ imageBase64, mimeType: file.type || "image/jpeg" }),
    });
  } catch (e) {
    // iOS Safari throws "Load failed" for network errors or oversized fetch bodies
    throw new Error(`Upload failed (${sizeKB}KB image) — ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || `Server error ${res.status}`), { status: res.status });
  }
  return res.json(); // { wines, cached, requestId }
}

async function fetchOcrUsage() {
  const token = localStorage.getItem("app_access_token");
  if (!token) return null;
  const res = await fetch(`${API_BASE}/subscription/ocr-usage`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json(); // { used, limit, remaining, plan }
}

const OCR_SESSION_KEY = 'ocr_tab_review';

// ── Component ──────────────────────────────────────────────────────────────────
export default function ImageSearchTab({ onWinesReady, isLoading, batchId }) {
  // status: 'idle' | 'preview' | 'processing' | 'review'
  const [status, setStatus]       = useState("idle");
  const [fileItems, setFileItems] = useState(/** @type {any[]} */ ([])); // [{id,file,url,status,wines,error,expanded}]
  const [ocrUsage, setOcrUsage]   = useState(null);
  const [dragOver, setDragOver]   = useState(false);
  const fileRef  = useRef();
  const abortRef = useRef(null);

  // Load OCR credit balance when component mounts; restore any saved review state
  useEffect(() => {
    fetchOcrUsage().then(u => u && setOcrUsage(u));

    // Restore completed review state from sessionStorage (cross-page navigation)
    try {
      const saved = sessionStorage.getItem(OCR_SESSION_KEY);
      if (saved) {
        const { fileItems: savedItems } = JSON.parse(saved);
        if (savedItems?.length) {
          // File/blob objects can't survive navigation — restore results only
          setFileItems(savedItems.map((/** @type {any} */ item) => ({ ...item, file: null, url: null })));
          setStatus('review');
        }
      }
    } catch (e) {}
  }, []);

  // Persist review state to sessionStorage so it survives cross-page navigation
  useEffect(() => {
    if (status === 'review' && fileItems.length > 0) {
      try {
        sessionStorage.setItem(OCR_SESSION_KEY, JSON.stringify({
          fileItems: fileItems.map(({ id, wines, error, status: s, expanded, file, name, _debug }) => ({
            id, wines, error, status: s, expanded, _debug,
            name: (/** @type {any} */(file))?.name || name || null,
            url: null, // blob URLs expire; thumbnails won't show on restore
          })),
        }));
      } catch (e) {}
    } else if (status === 'idle') {
      sessionStorage.removeItem(OCR_SESSION_KEY);
    }
  }, [status, fileItems]);

  // Max files = remaining credits (capped at 150 for unlimited plans)
  const maxFiles = ocrUsage
    ? (ocrUsage.limit >= 99999 ? 150 : ocrUsage.remaining)
    : 0;

  // Build a stable ID for a file
  const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Merge new files into the list, capping at remaining credits
  const addFiles = useCallback(async (incoming) => {
    const available = ocrUsage
      ? (ocrUsage.limit >= 99999 ? 150 : ocrUsage.remaining)
      : 0;
    const imageFiles = incoming.filter(f => f.type.startsWith("image/") || f.type === '');
    const results = await Promise.all(imageFiles.map(normalizeImageFile));
    setFileItems(prev => {
      const slots = available - prev.length;
      if (slots <= 0) return prev;
      const toAdd = results.slice(0, slots).map(r => ({
        id: makeId(),
        file: r.file,
        url: URL.createObjectURL(r.file),
        status: "pending",
        wines: [],
        error: null,
        expanded: true,
        _debug: `reported:${r.origType||'?'} sniffed:${r.sniffedType} converted:${r.converted}${r.conversionError ? ' err:'+r.conversionError : ''}`,
      }));
      return [...prev, ...toAdd];
    });
    setStatus("preview");
  }, [ocrUsage]);

  const handleFilePicker = useCallback((e) => {
    addFiles(Array.from(e.target.files || []));
    if (fileRef.current) fileRef.current.value = "";
  }, [addFiles]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files || []));
  }, [addFiles]);

  const removeFileItem = (id) => {
    setFileItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      const next = prev.filter(i => i.id !== id);
      if (next.length === 0) setStatus("idle");
      return next;
    });
  };

  const resetAll = () => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setFileItems(prev => { prev.forEach(i => { if (i.url) URL.revokeObjectURL(i.url); }); return []; });
    setStatus("idle");
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Run OCR across all pending files ────────────────────────────────────────
  const runAllOcr = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("processing");

    const pending = fileItems.filter(i => i.status === "pending");
    for (const item of pending) {
      if (controller.signal.aborted) break;

      // Mark as processing
      setFileItems(prev => prev.map(i => i.id === item.id ? { ...i, status: "processing" } : i));

      try {
        const { wines } = await runOcr(item.file, controller.signal);
        setFileItems(prev => prev.map(i =>
          i.id === item.id
            ? { ...i, status: "done", wines: wines.map((w, idx) => ({ ...w, size: w.size || '750ml', _id: `${/** @type {any} */(i).id}-${idx}` })) }
            : i
        ));
      } catch (e) {
        if (e.name === "AbortError") break;
        setFileItems(prev => prev.map(i =>
          i.id === item.id ? { ...i, status: "error", error: e.message } : i
        ));
      }
    }

    abortRef.current = null;
    setStatus("review");
    // Refresh credit balance
    fetchOcrUsage().then(u => u && setOcrUsage(u));
  };

  // ── Per-wine edit helpers ────────────────────────────────────────────────────
  const updateWine = (fileId, wineId, field, value) => {
    setFileItems(prev => prev.map(i =>
      i.id === fileId
        ? { ...i, wines: i.wines.map(w => w._id === wineId ? { ...w, [field]: value } : w) }
        : i
    ));
  };

  const removeWine = (fileId, wineId) => {
    setFileItems(prev => prev.map(i =>
      i.id === fileId ? { ...i, wines: i.wines.filter(w => w._id !== wineId) } : i
    ));
  };

  const addWine = (fileId) => {
    setFileItems(prev => prev.map(i =>
      i.id === fileId
        ? { ...i, wines: [...i.wines, { _id: `${fileId}-${Date.now()}`, vintage: "", name: "", size: "" }] }
        : i
    ));
  };

  const toggleExpand = (id) => {
    setFileItems(prev => prev.map(i => i.id === id ? { ...i, expanded: !i.expanded } : i));
  };

  // ── Collect all valid wines from all files and submit ────────────────────────
  const submitAll = () => {
    const all = fileItems.flatMap(i => i.wines).filter(w => w.name && String(w.vintage).trim());
    if (all.length > 0) {
      onWinesReady(all.map(({ vintage, name, size }) => ({ vintage, name, size })));
    }
  };

  const totalValid = fileItems.flatMap(i => i.wines).filter(w => w.name && String(w.vintage).trim()).length;
  const pendingCount = fileItems.filter(i => i.status === "pending").length;
  const creditWarning = ocrUsage && pendingCount > ocrUsage.remaining && ocrUsage.limit < 99999;

  // ── IDLE: dropzone ───────────────────────────────────────────────────────────
  if (status === "idle") {
    const ocrLimitReached = ocrUsage && ocrUsage.limit < 99999 && ocrUsage.remaining === 0;
    const creditsLoading = ocrUsage === null;

    return (
      <div>
        <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Upload wine images
        </Label>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-3 leading-relaxed">
          Photos of wine menus, bottle labels, or any images containing wine names.<br />
          Upload up to your remaining credits - sizes, vintages, and names extracted by AI.
        </p>

        {ocrUsage && ocrUsage.limit < 99999 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            AI Image Search credits:{" "}
            <span className={ocrUsage.remaining === 0 ? "text-red-500 font-semibold" : "font-semibold text-gray-700 dark:text-gray-300"}>
              {ocrUsage.remaining} / {ocrUsage.limit} remaining
            </span>
          </p>
        )}

        {ocrLimitReached ? (
          <div className="border-2 border-dashed border-red-200 dark:border-red-800/40 rounded-xl p-10 text-center bg-red-50 dark:bg-red-950/20">
            <ImageIcon className="w-9 h-9 text-red-300 dark:text-red-700 mx-auto mb-3" />
            <p className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">AI Image Search limit reached</p>
            <p className="text-xs text-red-500 dark:text-red-500 mb-4">
              You've used all {ocrUsage.limit} AI Image Search credits this month.
            </p>
            <Link
              to={createPageUrl("Profile") + "?tab=billing"}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-[#800020] text-white text-xs font-medium hover:bg-[#6b001b] transition-colors"
            >
              Upgrade to get more credits
            </Link>
          </div>
        ) : (
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
              creditsLoading
                ? "border-gray-200 dark:border-gray-700 opacity-60 cursor-wait"
                : dragOver
                  ? "border-[#800020] bg-[#800020]/5 dark:bg-[#800020]/10 cursor-pointer"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer"
            }`}
            onClick={() => !creditsLoading && fileRef.current?.click()}
            onDrop={creditsLoading ? undefined : handleDrop}
            onDragOver={creditsLoading ? undefined : e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={creditsLoading ? undefined : () => setDragOver(false)}
          >
            <ImageIcon className="w-9 h-9 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            {creditsLoading ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">Loading credit balance…</p>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Click or drag images here</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  JPG, PNG, WEBP · Up to {maxFiles} image{maxFiles !== 1 ? "s" : ""} (based on your remaining credits)
                </p>
              </>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFilePicker} className="hidden" />
      </div>
    );
  }

  // ── PREVIEW: files selected, not yet processed ───────────────────────────────
  if (status === "preview") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {fileItems.length} image{fileItems.length !== 1 ? "s" : ""} selected
          </p>
          <button onClick={resetAll} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-3.5 h-3.5" /> Clear all
          </button>
        </div>

        {/* File list */}
        <div className="space-y-2">
          {fileItems.map(item => (
            <div key={item.id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
              <img src={item.url} alt={item.file.name} className="w-10 h-10 object-cover rounded-md flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{item.file.name}</p>
                {item._debug && <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{item._debug}</p>}
              </div>
              <button onClick={() => removeFileItem(item.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Add more button (if below credit limit) */}
        {fileItems.length < maxFiles && (
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add more images ({fileItems.length}/{maxFiles})
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFilePicker} className="hidden" />

        {/* Credit warning */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-lg px-4 py-3 space-y-1">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Credits are used when you run OCR</p>
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                Running OCR will use{" "}
                <strong>{fileItems.length} AI Image Search credit{fileItems.length !== 1 ? "s" : ""}</strong>.
                {ocrUsage && ocrUsage.limit < 99999 && (
                  <> You have <strong>{ocrUsage.remaining}</strong> remaining this month.</>
                )}
                {" "}Credits are charged when this button is clicked, even if you choose not to look up the wines afterwards.
              </p>
            </div>
          </div>
          {creditWarning && (
            <p className="text-xs text-red-600 dark:text-red-400 font-medium pl-6">
              Warning: you only have {ocrUsage.remaining} credit{ocrUsage.remaining !== 1 ? "s" : ""} but selected {fileItems.length} image{fileItems.length !== 1 ? "s" : ""}.
              Only the first {ocrUsage.remaining} will be processed.
            </p>
          )}
          {ocrUsage?.remaining === 0 && ocrUsage.limit < 99999 && (
            <p className="text-xs text-red-600 dark:text-red-400 font-semibold pl-6">
              No credits remaining.{" "}
              <Link to={createPageUrl("Profile") + "?tab=billing"} className="underline hover:text-red-800 dark:hover:text-red-300">
                Upgrade your plan
              </Link>{" "}
              to use AI Image Search.
            </p>
          )}
        </div>

        <Button
          onClick={runAllOcr}
          disabled={ocrUsage?.remaining === 0 && ocrUsage?.limit < 99999}
          className="w-full h-10 bg-[#800020] hover:bg-[#6b001b] text-white font-medium"
        >
          Run OCR on {fileItems.length} image{fileItems.length !== 1 ? "s" : ""}
        </Button>
      </div>
    );
  }

  // ── PROCESSING: running OCR per file ────────────────────────────────────────
  if (status === "processing") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Scanning images…</p>
        </div>
        {fileItems.map(item => (
          <div key={item.id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
            <img src={item.url} alt={item.file.name} className="w-10 h-10 object-cover rounded-md flex-shrink-0" />
            <p className="flex-1 text-sm text-gray-700 dark:text-gray-300 truncate">{item.file.name}</p>
            {item.status === "processing" && <Loader2 className="w-4 h-4 text-[#800020] animate-spin flex-shrink-0" />}
            {item.status === "done"       && <span className="text-[11px] font-medium text-emerald-600">{item.wines.length} wine{item.wines.length !== 1 ? "s" : ""}</span>}
            {item.status === "error"      && <span className="text-[11px] font-medium text-red-500">Error</span>}
            {item.status === "pending"    && <span className="text-[11px] text-gray-400">Queued</span>}
          </div>
        ))}
      </div>
    );
  }

  // ── REVIEW: per-file wine lists, editable ────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          {totalValid} wine{totalValid !== 1 ? "s" : ""} ready for lookup
        </p>
        <button onClick={resetAll} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
          <X className="w-3.5 h-3.5" /> New images
        </button>
      </div>

      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
        {fileItems.map(item => (
          <div key={item.id} className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
            {/* File header row */}
            <button
              onClick={() => toggleExpand(item.id)}
              className="w-full flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors text-left"
            >
              <img src={item.url} alt={item.file?.name ?? item.name ?? ''} className="w-8 h-8 object-cover rounded flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{item.file?.name ?? item.name ?? ''}</span>
                {item._debug && <span className="block text-[9px] text-gray-400 dark:text-gray-500 truncate">{item._debug}</span>}
              </div>
              {item.status === "error"
                ? <span className="text-[11px] text-red-500 flex-shrink-0 text-right max-w-[120px] truncate" title={item.error}>{item.error?.slice(0, 40)}</span>
                : <span className="text-[11px] text-gray-400 flex-shrink-0">{item.wines.length} wine{item.wines.length !== 1 ? "s" : ""}</span>
              }
              {item.expanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
            </button>

            {/* Wine list for this file */}
            {item.expanded && (
              <div className="px-3 py-2 space-y-1.5">
                {item.wines.length === 0 && item.status !== "error" && (
                  <p className="text-xs text-gray-400 py-1">No wines detected. Add manually below.</p>
                )}
                {item.wines.map(w => (
                  <div key={w._id} className="flex items-center gap-2">
                    <Input
                      value={w.size || ""}
                      onChange={e => updateWine(item.id, w._id, "size", e.target.value)}
                      placeholder="Size"
                      className="w-20 h-7 text-xs flex-shrink-0 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    />
                    <Input
                      value={w.vintage}
                      onChange={e => updateWine(item.id, w._id, "vintage", e.target.value)}
                      placeholder="Vintage"
                      className="w-20 h-7 text-xs flex-shrink-0 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    />
                    <Input
                      value={w.name}
                      onChange={e => updateWine(item.id, w._id, "name", e.target.value)}
                      placeholder="Wine name"
                      className="flex-1 h-7 text-xs border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    />
                    <button onClick={() => removeWine(item.id, w._id)} className="text-gray-300 hover:text-red-500 flex-shrink-0 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addWine(item.id)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors mt-1"
                >
                  <Plus className="w-3 h-3" /> Add wine
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Button
        onClick={submitAll}
        disabled={totalValid === 0 || isLoading}
        className="w-full h-10 bg-[#800020] hover:bg-[#6b001b] text-white font-medium"
      >
        Look Up ({totalValid} wine{totalValid !== 1 ? "s" : ""})
      </Button>
    </div>
  );
}
