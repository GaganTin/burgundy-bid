/**
 * Parses pasted text (CSV, TSV, or plain text) into wine objects.
 */

// normalize sizes: remove trailing .0/.1 etc from numeric part (e.g. "750.0ml" -> "750ml", "70.1" -> "70")
function normalizeSize(s) {
  if (!s) return "";
  let out = String(s).trim();
  // remove decimal when followed by unit, e.g. 750.0ml -> 750ml
  out = out.replace(/(\d+)\.(?:\d+)(?=\s*(?:ml|cl|l)\b)/i, "$1");
  // remove trailing decimal if no unit, e.g. 70.1 -> 70
  out = out.replace(/^(\d+)\.(?:\d+)$/i, "$1");
  return out;
}

export function parseWineText(text) {
  if (!text || !text.trim()) return [];

  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  // Detect delimiter
  const maxTabCols = Math.max(...lines.map(l => l.split("\t").length));
  const maxCommaCols = Math.max(...lines.map(l => l.split(",").length));
  const sep = maxTabCols >= maxCommaCols ? "\t" : ",";

  // Check if first line is a header
  const firstLine = lines[0].toLowerCase();
  const hasHeader = /\b(wine|name|vintage|year|size|format|bottle|description|title)\b/.test(firstLine);

  const startIdx = hasHeader ? 1 : 0;
    // helper: detect leading size like "750ml", "1.5L", "3L", "magnum", "375 ml" etc.
    function extractLeadingSize(s) {
      if (!s) return null;
      const m = s.match(/^\s*(\d+\.?\d*\s*(?:ml|cl|l)\b|1\.5l|3l|magnum|375ml|750ml|\bdemi\b|\bhalf\b)/i);
      return m ? m[1].trim() : null;
    }
  const dataLines = lines.slice(startIdx);

  // If header, map columns
  let sizeCol = -1, vintageCol = -1, nameCol = -1;

  if (hasHeader) {
    const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());
    headers.forEach((h, i) => {
      if (/\bsize\b|\bformat\b|\bbottle\b/.test(h)) sizeCol = i;
      else if (/\bvintage\b|\byear\b|\bvin\b/.test(h)) vintageCol = i;
      else if (/\bwine\b|\bname\b|\bdescription\b|\btitle\b/.test(h)) nameCol = i;
    });
  }

  const wines = [];

  for (const line of dataLines) {
    if (!line.trim()) continue;

    // Pre-process: "750ml 2016\tWine Name" → split size and vintage
    let processed = line;
    if (sep === "\t") {
      const szYr = processed.match(/^(\d+\.?\d*\s*[mLl]+)\s+(\d{4})\t/i);
      if (szYr) {
        processed = szYr[1] + "\t" + szYr[2] + "\t" + processed.slice(szYr[0].length);
      }
    }

    const parts = processed.split(sep).map(p => p.trim());

    let size = "", vintage = "", name = "";

    if (hasHeader && nameCol >= 0) {
      size = sizeCol >= 0 && parts[sizeCol] ? parts[sizeCol] : "";
      vintage = vintageCol >= 0 && parts[vintageCol] ? parts[vintageCol] : "";
      name = parts[nameCol] || "";
    } else if (parts.length === 1) {
      // Single value — try to extract size and vintage from the name
      name = parts[0];
      // detect leading size (e.g. "750ml Domaine...")
      const leadingSize = extractLeadingSize(name);
      if (leadingSize) {
        size = leadingSize;
        name = name.replace(new RegExp('^\\s*' + leadingSize.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'), '').trim();
      }
      const yrMatch = name.match(/\b(19|20)\d{2}\b/);
      if (yrMatch) {
        vintage = yrMatch[0];
        // remove the year from the name if it was embedded
        name = name.replace(new RegExp(`\\b${vintage}\\b`), '').trim();
      }
    } else if (parts.length === 2) {
      // Could be "size\tname" or "vintage\tname" or "size vintage,name"
      const first = parts[0];
      const sizeVintage = first.match(/^(\d+\.?\d*\s*[mMlL]+)\s+(\d{4})$/i);
      if (sizeVintage) {
        size = sizeVintage[1];
        vintage = sizeVintage[2];
        name = parts[1];
      } else if (/^\d{4}$/.test(first)) {
        vintage = first;
        name = parts[1];
      } else if (extractLeadingSize(first)) {
        // first column is a size
        size = first;
        name = parts[1];
      } else {
        name = parts.join(" ");
        // If name contains a leading size, extract it
        const leadingSize2 = extractLeadingSize(name);
        if (leadingSize2) {
          size = leadingSize2;
          name = name.replace(new RegExp('^\\s*' + leadingSize2.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'), '').trim();
        }
        const yrMatch2 = name.match(/\b(19|20)\d{2}\b/);
        if (yrMatch2) {
          vintage = yrMatch2[0];
          name = name.replace(new RegExp(`\\b${vintage}\\b`), '').trim();
        }
      }
    } else {
      // 3+ columns: size, vintage, name
      if (sizeCol >= 0 && vintageCol >= 0 && nameCol >= 0) {
        size = parts[sizeCol] || "";
        vintage = parts[vintageCol] || "";
        name = parts[nameCol] || "";
      } else {
        size = parts[0] || "";
        vintage = parts[1] || "";
        name = parts.slice(2).join(" ").trim() || "";

        // If first col doesn't look like a size, shift interpretation
        if (!/\d+\.?\d*\s*[mLl]/i.test(size) && /^\d{4}$/.test(size)) {
          vintage = size;
          size = "";
          name = parts.slice(1).join(" ").trim();
        }
      }
    }

    // Clean vintage (remove .0 from float)
    vintage = vintage.replace(/\.0+$/, "");

    // Normalize size and push
    size = normalizeSize(size);
    if (name) {
      wines.push({ size, vintage, name });
    }
  }

  return wines;
}

export function parseExcelData(rows) {
  // rows is an array of objects from ExtractDataFromUploadedFile
  if (!rows || rows.length === 0) return [];
  return rows.map(row => {
    let size = row.size || row.Size || row.format || row.Format || row.bottle || row.Bottle || row['Bottle Size'] || row['bottle size'] || "";
    let vintage = row.vintage || row.Vintage || row.year || row.Year || row['Year'] || "";
    vintage = typeof vintage === 'number' ? String(vintage) : (vintage || "");
    vintage = String(vintage).replace(/\.0+$/, "");
    const name = row.name || row.Name || row.wine || row.Wine || row.description || row.Description || "";
    size = normalizeSize(size);
    return { size, vintage, name };
  }).filter(w => w.name);
}