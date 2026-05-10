import React, { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Search, FileSpreadsheet, Type, X, FileText, ImageIcon, AlertCircle } from "lucide-react";
import { client } from "@/api/client";
import { parseWineText, parseExcelData } from "./WineParser";
import ImageSearchTab from "./ImageSearchTab";
import { createPageUrl } from "@/utils";

export default function WineInput({ onWinesSubmit, isLoading, onTabChange, lookupUsage, wsCurrency = "USD", onCurrencyChange }) {
  const [pastedText, setPastedText] = useState("");
  const [singleWine, setSingleWine] = useState({ name: "", vintage: "", size: "" });
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [parsedUploadWines, setParsedUploadWines] = useState([]);
  const fileRef = useRef();

  const handlePasteSubmit = () => {
    const wines = parseWineText(pastedText);
    const valid = wines.filter(w => w.name && String(w.vintage).trim());
    if (wines.length > 0 && valid.length === wines.length) onWinesSubmit(wines, "paste");
  };

  const handleSingleSubmit = () => {
    if (singleWine.name.trim() && String(singleWine.vintage).trim()) {
      onWinesSubmit([singleWine], "single");
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadedFile(file);
    setParsedUploadWines([]);
    setUploading(true);

    const ext = file.name.split(".").pop().toLowerCase();

    // For CSV/TSV/TXT: read as text and parse locally
    if (["csv", "tsv", "txt"].includes(ext)) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result;
        const wines = parseWineText(text);
        setParsedUploadWines(wines);
        setUploading(false);
      };
      reader.onerror = () => setUploading(false);
      reader.readAsText(file);
      return;
    }

    // For Excel: use the API extractor
    try {
      const { file_url } = await client.integrations.Core.UploadFile({ file });
        const result = await client.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: {
          type: "object",
          properties: {
            wines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Wine name / description" },
                  vintage: { type: "string", description: "Vintage year" },
                  size: { type: "string", description: "Bottle size like 750ml, 1.5L" },
                },
              },
            },
          },
        },
      });
      if (result.status === "success" && result.output?.wines) {
        let wines = result.output.wines || [];
        // Normalize rows: ensure { name, vintage, size }
        wines = wines.map(r => {
          return {
            size: r.size || r.Size || r.format || r.Format || r.bottle || r.Bottle || r['Bottle Size'] || "",
            vintage: String(r.vintage || r.Vintage || r.year || r.Year || "").replace(/\.0+$/, ""),
            name: r.name || r.Name || r.wine || r.Wine || r.description || r.Description || "",
          };
        }).filter(w => w.name);
        setParsedUploadWines(wines);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleUploadSubmit = () => {
    const valid = parsedUploadWines.filter(w => w.name && String(w.vintage).trim());
    if (parsedUploadWines.length > 0 && valid.length === parsedUploadWines.length) {
      onWinesSubmit(parsedUploadWines, "upload");
    }
  };

  const clearFile = () => {
    setUploadedFile(null);
    setParsedUploadWines([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  // Lookup limit enforcement
  const lookupLimitReached = lookupUsage && lookupUsage.limit < 99999 && lookupUsage.remaining === 0;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-6 md:p-8 shadow-sm">
      {lookupLimitReached && (
        <div className="flex items-start gap-3 mb-5 rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Monthly lookup limit reached</p>
            <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
              You've used all {lookupUsage.limit} lookups this month.{" "}
              <Link to={createPageUrl("Profile") + "?tab=billing"} className="underline font-medium hover:text-red-800 dark:hover:text-red-300">
                Upgrade your plan
              </Link>{" "}
              to continue searching.
            </p>
          </div>
        </div>
      )}
      <Tabs defaultValue="single" onValueChange={onTabChange} className="w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          {/* Tabs — scrollable on mobile to prevent overflow */}
          <div className="overflow-x-auto -mx-6 sm:mx-0 px-6 sm:px-0 pb-0.5 sm:pb-0">
            <TabsList className="bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-1 flex-nowrap w-max sm:w-auto">
              <TabsTrigger value="single" className="gap-1.5 data-[state=active]:bg-[#800020] data-[state=active]:text-white data-[state=active]:shadow-sm">
                <Search className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="sm:hidden">Single</span>
                <span className="hidden sm:inline">Single Search</span>
              </TabsTrigger>
              <TabsTrigger value="paste" className="gap-1.5 data-[state=active]:bg-[#800020] data-[state=active]:text-white data-[state=active]:shadow-sm">
                <Type className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="sm:hidden">Paste</span>
                <span className="hidden sm:inline">Paste List</span>
              </TabsTrigger>
              <TabsTrigger value="upload" className="gap-1.5 data-[state=active]:bg-[#800020] data-[state=active]:text-white data-[state=active]:shadow-sm">
                <FileSpreadsheet className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="sm:hidden">Upload</span>
                <span className="hidden sm:inline">Upload File</span>
              </TabsTrigger>
              <TabsTrigger value="image" className="gap-1.5 data-[state=active]:bg-[#800020] data-[state=active]:text-white data-[state=active]:shadow-sm">
                <ImageIcon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="sm:hidden">AI Search</span>
                <span className="hidden sm:inline">AI Image Search</span>
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">WS Currency</Label>
            <Select value={wsCurrency} onValueChange={onCurrencyChange}>
              <SelectTrigger className="h-9 w-24 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="GBP">GBP</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="AUD">AUD</SelectItem>
                <SelectItem value="CAD">CAD</SelectItem>
                <SelectItem value="CHF">CHF</SelectItem>
                <SelectItem value="HKD">HKD</SelectItem>
                <SelectItem value="SGD">SGD</SelectItem>
                <SelectItem value="JPY">JPY</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Single Search */}
        <TabsContent value="single" className="mt-0">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="w-full sm:w-32 sm:flex-shrink-0">
              <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Size</Label>
              <Select value={singleWine.size} onValueChange={val => setSingleWine({ ...singleWine, size: val })}>
                <SelectTrigger className="mt-1.5 h-11 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  <SelectValue placeholder="Any size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="750ml">750ml</SelectItem>
                  <SelectItem value="375ml">375ml</SelectItem>
                  <SelectItem value="1.5L">1.5L</SelectItem>
                  <SelectItem value="3L">3L</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-28 sm:flex-shrink-0">
              <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Vintage</Label>
              <Input placeholder="2018" value={singleWine.vintage}
                onChange={e => setSingleWine({ ...singleWine, vintage: e.target.value })}
                className="mt-1.5 h-11 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 focus:border-gray-400 focus:ring-0" />
            </div>
            <div className="w-full sm:flex-1 sm:min-w-0">
              <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Wine Name</Label>
              <Input placeholder="e.g. Château Margaux" value={singleWine.name}
                onChange={e => setSingleWine({ ...singleWine, name: e.target.value })}
                onKeyDown={e => e.key === "Enter" && singleWine.name.trim() && !isLoading && handleSingleSubmit()}
                className="mt-1.5 h-11 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 focus:border-gray-400 focus:ring-0 text-[15px]" />
            </div>
            <div className="flex flex-col items-start sm:items-center sm:flex-shrink-0">
              <Button onClick={handleSingleSubmit} disabled={!singleWine.name.trim() || !String(singleWine.vintage).trim() || isLoading || lookupLimitReached}
                className="w-full sm:w-auto h-11 px-6 bg-[#800020] hover:bg-[#6b001b] text-white font-medium whitespace-nowrap">
                <Search className="w-4 h-4 mr-2" /> Look Up
              </Button>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">Prices load in ~30-60 sec</p>
            </div>
          </div>
        </TabsContent>

        {/* Paste List */}
        <TabsContent value="paste" className="mt-0">
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Paste your wine list</Label>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-2 leading-relaxed">
                Accepts tab-separated (TSV), comma-separated (CSV).<br />
                Search Size + Vintage + Wine, or just Vintage + Wine if no Size column.<br />
                The first row is treated as a header if it contains "wine", "vintage", or "size".
              </p>
              <Textarea
                placeholder={"Size\tVintage\tWine\n750ml\t2018\tChâteau Margaux\n1.5L\t2020\tOpus One\n\nOr just paste Vintage\tWine:\n2018\tChâteau Margaux"}
                value={pastedText}
                onChange={e => setPastedText(e.target.value)}
                className="mt-1.5 min-h-[160px] border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 focus:border-gray-400 focus:ring-0 font-mono text-sm leading-relaxed"
              />
            </div>
            {(() => {
              const detected = parseWineText(pastedText);
              const allHaveRequired = detected.length > 0 && detected.every(w => w.name && String(w.vintage).trim());
              return (
                <Button onClick={handlePasteSubmit} disabled={!allHaveRequired || isLoading || lookupLimitReached}
                  className="w-full h-11 bg-[#800020] hover:bg-[#6b001b] text-white font-medium">
                  Look Up ({detected.length} wines detected)
                </Button>
              );
            })()}
          </div>
        </TabsContent>

        {/* Image Search — forceMount keeps component alive when switching tabs */}
        <TabsContent value="image" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <ImageSearchTab
            onWinesReady={(wines) => onWinesSubmit(wines, "image")}
            isLoading={isLoading}
          />
        </TabsContent>

        {/* Upload File */}
        <TabsContent value="upload" className="mt-0">
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Upload your file</Label>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-2 leading-relaxed">
                Accepts CSV, TSV, TXT, or Excel file.<br />
                Expected columns: Size, Vintage, Wine (in any order; column names detected automatically)
              </p>
            </div>

            {!uploadedFile ? (
              <div
                className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Click to upload CSV, Excel, TSV, or TXT file</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg px-4 py-3">
                  <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-600 dark:text-gray-400 flex-1 truncate">{uploadedFile.name}</span>
                  <button onClick={clearFile} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {uploading && <p className="text-sm text-gray-500 text-center animate-pulse">Parsing file...</p>}
                {!uploading && parsedUploadWines.length > 0 && (() => {
                  const allHaveRequired = parsedUploadWines.every(w => w.name && String(w.vintage).trim());
                  return (
                    <Button onClick={handleUploadSubmit} disabled={!allHaveRequired || isLoading || lookupLimitReached}
                      className="w-full h-11 bg-[#800020] hover:bg-[#6b001b] text-white font-medium">
                      Look Up ({parsedUploadWines.length} wines detected)
                    </Button>
                  );
                })()}
                {!uploading && parsedUploadWines.length === 0 && (
                  <p className="text-sm text-red-500 text-center">No wines detected. Please check your file format.</p>
                )}
              </>
            )}
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.tsv,.txt" onChange={handleFileChange} className="hidden" />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}