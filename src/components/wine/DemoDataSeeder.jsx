import { useEffect } from "react";

// Seeds localStorage with demo batch IDs on first load so demo data is visible
const DEMO_SINGLE_IDS = [
  "batch_demo_single_latest",
  "batch_demo_single_prev1",
  "batch_demo_single_prev2",
  "batch_demo_single_prev3",
];

const now = new Date();
const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 10).toISOString();
const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString();
const thisMonth1 = new Date(now.getFullYear(), now.getMonth(), 5).toISOString();

const DEMO_PASTE_HISTORY = [
  { id: "batch_demo_paste_latest", createdAt: new Date().toISOString() },
  { id: "batch_demo_paste_prev1", createdAt: thisMonth1 },
  { id: "batch_demo_paste_prev2", createdAt: oneMonthAgo },
];

const DEMO_UPLOAD_HISTORY = [
  { id: "batch_demo_upload_latest", createdAt: new Date().toISOString() },
  { id: "batch_demo_upload_prev1", createdAt: thisMonth1 },
  { id: "batch_demo_upload_prev2", createdAt: twoMonthsAgo },
];

export default function DemoDataSeeder() {
  useEffect(() => {
    if (!localStorage.getItem("bb_demo_seeded")) {
      localStorage.setItem("bb_single_batch_ids", JSON.stringify(DEMO_SINGLE_IDS));
      localStorage.setItem("bb_paste_batch_history", JSON.stringify(DEMO_PASTE_HISTORY));
      localStorage.setItem("bb_upload_batch_history", JSON.stringify(DEMO_UPLOAD_HISTORY));
      localStorage.setItem("bb_demo_seeded", "1");
    }
  }, []);
  return null;
}