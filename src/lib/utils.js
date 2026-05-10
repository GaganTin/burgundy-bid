import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { client } from "@/api/client";

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}


export const isIframe = window.self !== window.top;

export function getApiBase() {
  let base = client.appBaseUrl || '';
  if (!base && typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    base = 'http://localhost:3001';
  }
  return base;
}
