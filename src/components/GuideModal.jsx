import React, { useState, useEffect } from "react";
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * @typedef {{ label?: string, title: string, description: string, bullets?: string[], note?: string, image?: string, images?: string[], link?: { href: string, label: string } }} GuidePage
 */

/**
 * @param {{ open: boolean, onOpenChange: (v: boolean) => void, title: string, pages: GuidePage[] }} props
 */
export default function GuideModal({ open, onOpenChange, title, pages }) {
  pages = pages || [];
  const [step, setStep] = useState(0);

  useEffect(() => { if (open) setStep(0); }, [open]);

  // Preload all guide images when the modal opens so page navigation is instant
  useEffect(() => {
    if (!open) return;
    pages.forEach(page => {
      const srcs = page.images?.length ? page.images : page.image ? [page.image] : [];
      srcs.forEach(src => { new Image().src = src; });
    });
  }, [open]);

  if (!pages.length) return null;
  const page  = pages[step];
  const total = pages.length;
  const isFirst = step === 0;
  const isLast  = step === total - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] w-[95vw] max-w-4xl p-0 overflow-hidden rounded-2xl shadow-2xl bg-white dark:bg-gray-900 border-0 duration-200 flex flex-col max-h-[85vh] sm:max-h-[90vh] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
        <DialogTitle className="sr-only">{title}</DialogTitle>

        {/* ── Top bar ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#800020] flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-400 tabular-nums">{step + 1} / {total}</span>
            <button
              onClick={() => onOpenChange(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div
          key={step}
          className="flex flex-col md:flex-row flex-1 overflow-y-auto min-h-[220px] sm:min-h-[340px] md:min-h-[420px]"
          style={{ animation: 'guidePageIn 0.22s ease' }}
        >
          {/* Image pane — supports single image or array of images */}
          {(page.image || page.images?.length) && (() => {
            const imgs = page.images?.length ? page.images : [page.image];
            const multi = imgs.length > 1;
            return (
              <div className={`md:w-[56%] bg-gray-50 dark:bg-gray-800/60 flex ${multi ? 'flex-col gap-4 overflow-y-auto' : 'items-center justify-center'} p-6 border-r border-gray-100 dark:border-gray-800 flex-shrink-0`}>
                {imgs.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`${page.title}${multi ? ` (${i + 1})` : ''}`}
                    className="w-full h-auto rounded-xl shadow-md border border-gray-200 dark:border-gray-700 object-contain"
                    style={{ maxHeight: multi ? 180 : 220 }}
                  />
                ))}
              </div>
            );
          })()}

          {/* Text pane */}
          <div className={`flex flex-col justify-center p-8 ${(page.image || page.images?.length) ? '' : 'max-w-xl mx-auto text-center'}`}>
            {page.label && (
              <p className="text-[11px] font-bold text-[#800020] uppercase tracking-[0.12em] mb-3">
                {page.label}
              </p>
            )}
            <h2 className="text-[22px] font-serif font-bold text-gray-900 dark:text-white leading-snug mb-3">
              {page.title}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
              {page.description}
            </p>

            {page.bullets && page.bullets.length > 0 && (
              <ul className="space-y-2 mb-3">
                {page.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-300">
                    <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[#800020] flex-shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}

            {page.note && (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-1">{page.note}</p>
            )}

            {page.link && (
              <a
                href={page.link.href}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#800020] hover:underline underline-offset-2"
              >
                {page.link.label}
                <ChevronRight className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* ── Footer nav ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={isFirst}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>

          {/* Dot indicators */}
          <div className="flex items-center gap-2">
            {pages.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className="rounded-full transition-all duration-200 flex-shrink-0"
                style={{
                  width: i === step ? 20 : 8,
                  height: 8,
                  background: i === step ? '#800020' : '#d1d5db',
                }}
              />
            ))}
          </div>

          <button
            onClick={() => isLast ? onOpenChange(false) : setStep(s => s + 1)}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-100 hover:text-[#800020] dark:hover:text-[#c0304a] transition-colors"
          >
            {isLast ? 'Done' : <>Next <ChevronRight className="w-4 h-4" /></>}
          </button>
        </div>

        <style>{`
          @keyframes guidePageIn {
            from { opacity: 0; transform: translateX(12px); }
            to   { opacity: 1; transform: translateX(0); }
          }
        `}</style>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
