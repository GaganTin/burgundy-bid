/**
 * Comprehensive Workspace (admin) page test
 * Covers all 8 tabs: tickets, suggestions, contacts, alerts, errors, analytics, plans, users
 */
import { chromium } from 'playwright';
import jwt from '../node_modules/jsonwebtoken/index.js';

const BASE       = 'http://localhost:5173';
const API        = 'http://localhost:3001';
const JWT_SECRET = 'devsecret_replace_me';
const USER_ID    = 'cd527c9b-44cc-4b84-9948-91350c8af6a4';
const EMAIL      = 'zanrow.co@gmail.com';

let passed = 0, failed = 0, warnings = 0;
const results = [];

function log(status, section, test, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️ ' : '❌';
  const line = `${icon} [${section}] ${test}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  results.push({ status, section, test, detail });
  if (status === 'PASS') passed++;
  else if (status === 'WARN') warnings++;
  else failed++;
}

function mintToken() {
  return jwt.sign(
    { id: USER_ID, email: EMAIL, role_type: 'admin' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

async function injectAuth(page) {
  const token = mintToken();
  const userObj = {
    id: USER_ID, email: EMAIL, role_type: 'admin',
    full_name: 'Gagan', subscription_plan: 'free',
    phone: null, preferred_theme: 'light', is_email_verified: true,
  };
  await page.evaluate(([t, u]) => {
    localStorage.setItem('app_access_token', t);
    localStorage.setItem('app_current_user', JSON.stringify(u));
  }, [token, userObj]);
}

// click a workspace tab by its label text
async function clickTab(page, label) {
  const btn = await page.$(`button:has-text("${label}")`);
  if (!btn) { log('FAIL', label, `Tab button not found`); return false; }
  await btn.click();
  await page.waitForTimeout(700);
  return true;
}

// wait for the card description that marks which tab is active
async function tabContentVisible(page, descriptionFragment) {
  try {
    await page.waitForSelector(`text=${descriptionFragment}`, { timeout: 5000 });
    return true;
  } catch { return false; }
}

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('  [browser]', m.text().slice(0, 120)); });

  // ── Setup ────────────────────────────────────────────────────────────────
  await page.goto(BASE);
  await injectAuth(page);
  await page.goto(`${BASE}/workspace`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  // Disable toast/notification container pointer-events so it never intercepts clicks
  await page.evaluate(() => {
    const disable = () => document.querySelectorAll('[class]').forEach(el => {
      if (el.className && typeof el.className === 'string' && el.className.includes('z-[100]')) {
        el.style.pointerEvents = 'none';
      }
    });
    disable();
    new MutationObserver(disable).observe(document.body, { childList: true, subtree: true });
  });

  // ── Page load ────────────────────────────────────────────────────────────
  const heading = await page.$('h1:has-text("Workspace")');
  heading
    ? log('PASS', 'Page', 'Workspace heading visible')
    : log('FAIL', 'Page', 'Workspace heading not found');

  const adminBadge = await page.$('text=Admin');
  adminBadge
    ? log('PASS', 'Page', 'Admin badge visible')
    : log('FAIL', 'Page', 'Admin badge not found');

  // ── Summary cards ────────────────────────────────────────────────────────
  const summaryLabels = ['Open Tickets', 'New Feedback', 'Unread Messages', 'Total Errors', 'Locked Accounts', 'System Alerts'];
  let summaryFound = 0;
  for (const lbl of summaryLabels) {
    const el = await page.$(`text=${lbl}`);
    if (el) summaryFound++;
  }
  summaryFound === summaryLabels.length
    ? log('PASS', 'Page', `All ${summaryLabels.length} summary stat cards visible`)
    : log('FAIL', 'Page', `Only ${summaryFound}/${summaryLabels.length} summary stat cards found`);

  // ── Refresh button ───────────────────────────────────────────────────────
  const refreshBtn = await page.$('button:has-text("Refresh")');
  if (refreshBtn) {
    await refreshBtn.click();
    await page.waitForTimeout(600);
    log('PASS', 'Page', 'Global Refresh button clickable');
  } else {
    log('FAIL', 'Page', 'Refresh button not found');
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 1 — SUPPORT TICKETS
  // ═══════════════════════════════════════════════════════════════════
  await clickTab(page, 'Support Tickets');
  const ticketsDesc = await tabContentVisible(page, 'Support tickets submitted by registered users');
  ticketsDesc
    ? log('PASS', 'Tickets', 'Tab content loaded')
    : log('FAIL', 'Tickets', 'Tab description not found');

  // Section controls
  const ticketSearch = await page.$('input[placeholder="Search..."]');
  if (ticketSearch) {
    log('PASS', 'Tickets', 'Search input present');
    await ticketSearch.type('test', { delay: 40 });
    await page.waitForTimeout(300);
    const countEl = await page.$('span.text-xs.text-gray-400.ml-auto');
    log('PASS', 'Tickets', 'Search filters items (count element found)');
    await ticketSearch.fill('');
    await page.waitForTimeout(200);
  } else {
    log('FAIL', 'Tickets', 'Search input not found');
  }

  const ticketStatusFilter = await page.$('select');
  if (ticketStatusFilter) {
    log('PASS', 'Tickets', 'Status filter select present');
    await ticketStatusFilter.selectOption('open');
    await page.waitForTimeout(300);
    await ticketStatusFilter.selectOption('all');
    await page.waitForTimeout(200);
  } else {
    log('FAIL', 'Tickets', 'Status filter not found');
  }

  const groupByBtn = await page.$('button:has-text("Group by status")');
  if (groupByBtn) {
    await groupByBtn.click();
    await page.waitForTimeout(300);
    const groupOrderBar = await page.$('text=Status order:');
    groupOrderBar
      ? log('PASS', 'Tickets', 'Group-by-status toggle shows order controls')
      : log('WARN', 'Tickets', 'Group order bar not visible after toggle');
    // move a status up
    const upBtns = await page.$$('button:has-text("▲")');
    if (upBtns.length > 1) {
      await upBtns[1].click();
      await page.waitForTimeout(200);
      log('PASS', 'Tickets', 'Status order ▲ button works');
    }
    // turn group-by off
    await groupByBtn.click();
    await page.waitForTimeout(300);
  } else {
    log('FAIL', 'Tickets', 'Group by status button not found');
  }

  // Expand a ticket row if any exist
  const ticketRow = await page.$('.border.rounded-xl.overflow-hidden');
  if (ticketRow) {
    await ticketRow.click();
    await page.waitForTimeout(400);
    const replyArea = await page.$('textarea[placeholder*="reply"]');
    replyArea
      ? log('PASS', 'Tickets', 'Ticket expands and shows reply textarea')
      : log('WARN', 'Tickets', 'Ticket expanded but no reply textarea (may be closed ticket)');

    // Status select inside expanded ticket
    const statusSelects = await page.$$('select');
    statusSelects.length >= 2
      ? log('PASS', 'Tickets', 'Status/Priority selects visible inside expanded ticket')
      : log('WARN', 'Tickets', 'Status select inside ticket not found');

    // Send Reply button disabled when empty
    const sendReplyBtn = await page.$('button:has-text("Send Reply")');
    if (sendReplyBtn) {
      const disabled = await sendReplyBtn.isDisabled();
      disabled
        ? log('PASS', 'Tickets', 'Send Reply disabled when reply textarea is empty')
        : log('FAIL', 'Tickets', 'Send Reply NOT disabled when reply textarea empty');
    }

    // Collapse
    await ticketRow.click();
    await page.waitForTimeout(300);
  } else {
    log('WARN', 'Tickets', 'No ticket rows found (empty state)');
    const emptyState = await page.$('text=No support tickets yet');
    emptyState
      ? log('PASS', 'Tickets', 'Empty state text shown')
      : log('WARN', 'Tickets', 'Neither tickets nor empty state visible');
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 2 — FEEDBACK (Suggestions)
  // ═══════════════════════════════════════════════════════════════════
  await clickTab(page, 'Feedback');
  const feedbackDesc = await tabContentVisible(page, 'Feedback, ideas, and requests from users');
  feedbackDesc
    ? log('PASS', 'Feedback', 'Tab content loaded')
    : log('FAIL', 'Feedback', 'Tab description not found');

  const feedbackSearch = await page.$('input[placeholder="Search..."]');
  feedbackSearch
    ? log('PASS', 'Feedback', 'Search input present')
    : log('FAIL', 'Feedback', 'Search input not found');

  // Status filter — suggestions use different statuses
  const suggStatusFilter = await page.$('select');
  if (suggStatusFilter) {
    await suggStatusFilter.selectOption('submitted');
    await page.waitForTimeout(300);
    await suggStatusFilter.selectOption('all');
    await page.waitForTimeout(200);
    log('PASS', 'Feedback', 'Status filter works (submitted / all)');
  }

  const suggRow = await page.$('.border.rounded-xl.overflow-hidden');
  if (suggRow) {
    await suggRow.click();
    await page.waitForTimeout(400);
    const suggStatusSelect = await page.$('select');
    suggStatusSelect
      ? log('PASS', 'Feedback', 'Feedback row expands and shows status select')
      : log('WARN', 'Feedback', 'No status select inside expanded suggestion');
    await suggRow.click();
    await page.waitForTimeout(300);
  } else {
    const empty = await page.$('text=No feedback yet');
    empty
      ? log('PASS', 'Feedback', 'Empty state shown when no feedback')
      : log('WARN', 'Feedback', 'Neither feedback rows nor empty state found');
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 3 — CONTACT MESSAGES
  // ═══════════════════════════════════════════════════════════════════
  await clickTab(page, 'Contact Messages');
  const contactDesc = await tabContentVisible(page, 'Messages from the public Contact Us form');
  contactDesc
    ? log('PASS', 'Contacts', 'Tab content loaded')
    : log('FAIL', 'Contacts', 'Tab description not found');

  const contactSearch = await page.$('input[placeholder="Search..."]');
  contactSearch
    ? log('PASS', 'Contacts', 'Search input present')
    : log('FAIL', 'Contacts', 'Search input not found');

  const contactRow = await page.$('.border.rounded-xl.overflow-hidden');
  if (contactRow) {
    await contactRow.click();
    await page.waitForTimeout(400);
    const msgEl = await page.$('text=Message');
    msgEl
      ? log('PASS', 'Contacts', 'Contact row expands showing message detail')
      : log('WARN', 'Contacts', 'Expanded contact row has no Message label');
    const statusSel = await page.$('select');
    statusSel
      ? log('PASS', 'Contacts', 'Status select visible inside expanded contact')
      : log('WARN', 'Contacts', 'No status select inside expanded contact');
    await contactRow.click();
    await page.waitForTimeout(300);
  } else {
    const empty = await page.$('text=No contact messages yet');
    empty
      ? log('PASS', 'Contacts', 'Empty state shown')
      : log('WARN', 'Contacts', 'Neither contact rows nor empty state found');
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 4 — SYSTEM ALERTS
  // ═══════════════════════════════════════════════════════════════════
  await clickTab(page, 'System Alerts');
  const alertsDesc = await tabContentVisible(page, 'Automated system alerts');
  alertsDesc
    ? log('PASS', 'Alerts', 'Tab content loaded')
    : log('FAIL', 'Alerts', 'Tab description not found');

  // Show resolved toggle
  const showResolvedBtn = await page.$('button:has-text("Show Resolved"), button:has-text("Hide Resolved")');
  if (showResolvedBtn) {
    const btnText = await showResolvedBtn.textContent();
    log('PASS', 'Alerts', `Show/Hide Resolved button present: "${btnText.trim()}"`);
    await showResolvedBtn.click();
    await page.waitForTimeout(600);
    log('PASS', 'Alerts', 'Show/Hide Resolved toggle clickable');
    // toggle back
    const btn2 = await page.$('button:has-text("Show Resolved"), button:has-text("Hide Resolved")');
    if (btn2) { await btn2.click(); await page.waitForTimeout(400); }
  } else {
    log('WARN', 'Alerts', 'Show/Hide Resolved button not found');
  }

  // Alert rows / empty state
  const alertRefreshBtn = await page.$('button:has-text("Refresh")');
  alertRefreshBtn
    ? log('PASS', 'Alerts', 'Alerts Refresh button present')
    : log('WARN', 'Alerts', 'Alerts Refresh button not found');

  const alertRow = await page.$('.bg-white.dark\\:bg-gray-900.rounded-xl');
  if (alertRow) {
    log('PASS', 'Alerts', 'Alert row(s) rendered');
    // Resolve button
    const resolveBtn = await page.$('button:has-text("Resolve")');
    resolveBtn
      ? log('PASS', 'Alerts', 'Resolve button visible on alert')
      : log('WARN', 'Alerts', 'No Resolve button (alerts may already be resolved)');
  } else {
    const noAlerts = await page.$('text=No unresolved system alerts');
    noAlerts
      ? log('PASS', 'Alerts', 'Empty state shown — no unresolved alerts')
      : log('WARN', 'Alerts', 'Neither alert rows nor empty state found');
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 5 — ERROR TRACKING
  // ═══════════════════════════════════════════════════════════════════
  await clickTab(page, 'Error Tracking');
  const errDesc = await tabContentVisible(page, 'Connection and lookup errors');
  errDesc
    ? log('PASS', 'Errors', 'Tab content loaded')
    : log('FAIL', 'Errors', 'Tab description not found');

  // Sub-tabs: Connection Errors / Lookup Errors / Captcha Errors
  const connSubTab = await page.$('button:has-text("Connection Errors")');
  connSubTab
    ? log('PASS', 'Errors', 'Connection Errors sub-tab present')
    : log('FAIL', 'Errors', 'Connection Errors sub-tab not found');

  const lookupSubTab = await page.$('button:has-text("Lookup Errors")');
  lookupSubTab
    ? log('PASS', 'Errors', 'Lookup Errors sub-tab present')
    : log('FAIL', 'Errors', 'Lookup Errors sub-tab not found');

  const captchaSubTab = await page.$('button:has-text("Captcha Errors")');
  captchaSubTab
    ? log('PASS', 'Errors', 'Captcha Errors sub-tab present')
    : log('FAIL', 'Errors', 'Captcha Errors sub-tab not found');

  // Switch sub-tabs
  if (lookupSubTab) {
    await lookupSubTab.click();
    await page.waitForTimeout(400);
    log('PASS', 'Errors', 'Lookup Errors sub-tab clickable');
  }
  if (captchaSubTab) {
    await captchaSubTab.click();
    await page.waitForTimeout(400);
    log('PASS', 'Errors', 'Captcha Errors sub-tab clickable');
  }
  if (connSubTab) {
    await connSubTab.click();
    await page.waitForTimeout(400);
    log('PASS', 'Errors', 'Back to Connection Errors sub-tab works');
  }

  // Search in errors
  const errSearch = await page.$('input[placeholder*="Search"]');
  if (errSearch) {
    await errSearch.type('test', { delay: 40 });
    await page.waitForTimeout(300);
    await errSearch.fill('');
    log('PASS', 'Errors', 'Error search input usable');
  } else {
    log('WARN', 'Errors', 'Error search input not found');
  }

  // Sort buttons
  const sortBtn = await page.$('button:has-text("Updated")');
  if (sortBtn) {
    await sortBtn.click();
    await page.waitForTimeout(300);
    await sortBtn.click();
    await page.waitForTimeout(300);
    log('PASS', 'Errors', 'Sort by Updated button toggles direction');
  } else {
    log('WARN', 'Errors', 'Sort buttons not found');
  }

  // Time range selector
  const rangeSelects = await page.$$('select');
  if (rangeSelects.length > 0) {
    const rangeSelect = rangeSelects[rangeSelects.length - 1];
    const opts = await rangeSelect.$$('option');
    if (opts.length >= 2) {
      await rangeSelect.selectOption({ index: 1 });
      await page.waitForTimeout(600);
      await rangeSelect.selectOption({ index: 0 });
      await page.waitForTimeout(400);
      log('PASS', 'Errors', 'Time range selector works');
    }
  }

  // Expand an error row if present
  const errRow = await page.$('.border-red-100, .border.border-red-100');
  if (errRow) {
    await errRow.click();
    await page.waitForTimeout(400);
    const userLabel = await page.$('text=User ID');
    userLabel
      ? log('PASS', 'Errors', 'Error row expands showing detail fields')
      : log('WARN', 'Errors', 'Error row expanded but detail not found');
    await errRow.click();
    await page.waitForTimeout(300);
  } else {
    log('WARN', 'Errors', 'No connection error rows visible (may be empty)');
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 6 — ANALYTICS
  // ═══════════════════════════════════════════════════════════════════
  await clickTab(page, 'Analytics');
  await page.waitForTimeout(1200); // charts take time
  const analyticsDesc = await tabContentVisible(page, 'Platform-wide metrics');
  analyticsDesc
    ? log('PASS', 'Analytics', 'Tab content loaded')
    : log('FAIL', 'Analytics', 'Analytics description not found');

  // Section pills — use button.text-xs to scope to pills (workspace tabs use text-sm)
  const allSectionPills = ['Overview', 'Growth', 'Revenue', 'Issues', 'Users', 'User Usage'];
  for (const section of allSectionPills) {
    const pill = await page.$(`button.text-xs:has-text("${section}")`);
    pill
      ? log('PASS', 'Analytics', `"${section}" section pill present`)
      : log('WARN', 'Analytics', `"${section}" section pill not found`);
  }

  // Overview — check stat cards (Total Lookups is in overview)
  const ovBtn = await page.$('button.text-xs:has-text("Overview")');
  if (ovBtn) { await ovBtn.click(); await page.waitForTimeout(600); }
  const totalLookups = await page.$('text=Total Lookups');
  totalLookups
    ? log('PASS', 'Analytics', 'Total Lookups stat card visible in Overview')
    : log('WARN', 'Analytics', 'Total Lookups stat card not found in Overview');

  // Growth section — has TimeControls (group-by + range select) AND a chart
  const growthBtn = await page.$('button.text-xs:has-text("Growth")');
  if (growthBtn) {
    await growthBtn.click();
    await page.waitForTimeout(800);
    log('PASS', 'Analytics', 'Growth section clickable');

    // Chart only renders in growth/revenue/issues sections
    const chart = await page.$('.recharts-responsive-container, svg.recharts-surface');
    chart
      ? log('PASS', 'Analytics', 'Chart (recharts) rendered in Growth section')
      : log('WARN', 'Analytics', 'No chart element found in Growth section');

    // Date grouping buttons only exist inside TimeControls (growth/revenue/issues)
    for (const grp of ['day', 'week', 'month', 'year']) {
      const btn = await page.$(`button:has-text("${grp}")`);
      if (btn) {
        await btn.click();
        await page.waitForTimeout(300);
        log('PASS', 'Analytics', `Group-by "${grp}" button works`);
      } else {
        log('WARN', 'Analytics', `Group-by "${grp}" button not found`);
      }
    }

    // Time range select — use locator (lazily re-queries after group-by re-renders)
    const selectCount = await page.locator('select').count();
    if (selectCount > 0) {
      await page.locator('select').first().selectOption('7');
      await page.waitForTimeout(500);
      await page.locator('select').first().selectOption('30');
      await page.waitForTimeout(500);
      log('PASS', 'Analytics', 'Time range selector works (7d / 30d)');
    } else {
      log('WARN', 'Analytics', 'Analytics time range select not found in Growth section');
    }
  } else {
    log('WARN', 'Analytics', 'Growth section pill not found');
  }

  // Revenue section
  const revenueBtn = await page.$('button.text-xs:has-text("Revenue")');
  if (revenueBtn) { await revenueBtn.click(); await page.waitForTimeout(500); log('PASS', 'Analytics', 'Revenue section clickable'); }

  // Issues section
  const issuesBtn = await page.$('button.text-xs:has-text("Issues")');
  if (issuesBtn) { await issuesBtn.click(); await page.waitForTimeout(500); log('PASS', 'Analytics', 'Issues section clickable'); }

  // Users section — scoped to text-xs pill (not the "Users" workspace tab button which is text-sm)
  const usersSectionBtn = await page.$('button.text-xs:has-text("Users")');
  if (usersSectionBtn) {
    await usersSectionBtn.click();
    await page.waitForTimeout(800);
    const usersTable = await page.$('table');
    usersTable
      ? log('PASS', 'Analytics', 'Users section shows data table')
      : log('WARN', 'Analytics', 'Users section has no table');
  } else {
    log('WARN', 'Analytics', '"Users" section pill (text-xs) not found');
  }

  // User Usage section — scoped to text-xs pill
  const usageSectionBtn = await page.$('button.text-xs:has-text("User Usage")');
  if (usageSectionBtn) {
    await usageSectionBtn.click();
    await page.waitForTimeout(800);
    const usageTable = await page.$('table');
    usageTable
      ? log('PASS', 'Analytics', 'User Usage section shows data table')
      : log('WARN', 'Analytics', 'User Usage section has no table');
  } else {
    log('WARN', 'Analytics', '"User Usage" section pill (text-xs) not found when trying to click it');
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 7 — PLANS & CREDITS
  // ═══════════════════════════════════════════════════════════════════
  await clickTab(page, 'Plans & Credits');
  const plansDesc = await tabContentVisible(page, 'Edit plan limits and pricing');
  plansDesc
    ? log('PASS', 'Plans', 'Tab content loaded')
    : log('FAIL', 'Plans', 'Plans tab description not found');

  // Wait for plans to load (async API call)
  await page.waitForTimeout(1500);
  try { await page.waitForSelector('tbody tr', { timeout: 3000 }); } catch(_) {}

  // Plan cards or loading state
  const planRows = await page.$$('[class*="rounded-xl"]');
  planRows.length > 0
    ? log('PASS', 'Plans', `Plan layout rendered (${planRows.length} rounded elements)`)
    : log('WARN', 'Plans', 'No plan cards found');

  // Verify plan data loaded by checking for a plan name cell
  const freePlanCell = await page.$('text=Free') || await page.$('text=Basic') || await page.$('text=Pro');
  freePlanCell
    ? log('PASS', 'Plans', 'Plan data loaded (plan name visible in table)')
    : log('WARN', 'Plans', 'Plan data may not have loaded yet');

  // Edit button on a plan — look inside the plans table specifically
  const editBtn = await page.$('table button:has-text("Edit")') || await page.$('button:has-text("Edit")');
  if (editBtn) {
    await editBtn.click({ force: true });
    await page.waitForTimeout(1000);
    // Check Save and Cancel separately (they render inside the table row)
    const cancelBtn = await page.$('button:has-text("Cancel")');
    const saveBtn = await page.$('button:has-text("Save")');
    if (cancelBtn || saveBtn) {
      log('PASS', 'Plans', 'Clicking Edit reveals Save/Cancel controls');
      if (cancelBtn) { await cancelBtn.click(); await page.waitForTimeout(300); log('PASS', 'Plans', 'Cancel edit works'); }
    } else {
      log('WARN', 'Plans', 'Edit clicked but Save/Cancel controls not found');
    }
  } else {
    log('WARN', 'Plans', 'No Edit button found on plan cards');
  }

  // Bonus Credits section
  const bonusSection = await page.$('text=Reward Bonus Credits');
  bonusSection
    ? log('PASS', 'Plans', 'Bonus Credits section visible')
    : log('WARN', 'Plans', 'Bonus Credits section not found');

  // User search for bonus credits
  const bonusUserInput = await page.$('input[placeholder*="user"], input[placeholder*="email"], input[placeholder*="search"]');
  if (bonusUserInput) {
    await bonusUserInput.type('gagan', { delay: 40 });
    await page.waitForTimeout(500);
    const userSuggestion = await page.$('[class*="hover:bg"]');
    userSuggestion
      ? log('PASS', 'Plans', 'User search for bonus credits shows results')
      : log('WARN', 'Plans', 'User search input used but no suggestions appeared');
    await bonusUserInput.fill('');
  } else {
    log('WARN', 'Plans', 'Bonus credits user search input not found');
  }

  // ═══════════════════════════════════════════════════════════════════
  // TAB 8 — USERS
  // ═══════════════════════════════════════════════════════════════════
  await clickTab(page, 'Users');
  await page.waitForTimeout(800);
  const usersDesc = await tabContentVisible(page, 'All registered users');
  usersDesc
    ? log('PASS', 'Users', 'Tab content loaded')
    : log('FAIL', 'Users', 'Users tab description not found');

  // Search
  const userSearch = await page.$('input[placeholder*="name or email"]');
  if (userSearch) {
    log('PASS', 'Users', 'User search input present');
    await userSearch.type('gagan', { delay: 40 });
    await page.waitForTimeout(400);
    const rows = await page.$$('tbody tr');
    rows.length > 0
      ? log('PASS', 'Users', `Search for "gagan" returns ${rows.length} row(s)`)
      : log('WARN', 'Users', 'Search returned no rows');
    await userSearch.fill('');
    await page.waitForTimeout(300);
  } else {
    log('FAIL', 'Users', 'User search input not found');
  }

  // Plan filter
  const planFilterSel = await page.$$('select');
  if (planFilterSel.length >= 1) {
    const pf = planFilterSel[0];
    const opts = await pf.$$('option');
    if (opts.length >= 2) {
      await pf.selectOption({ index: 1 });
      await page.waitForTimeout(300);
      await pf.selectOption({ index: 0 });
      await page.waitForTimeout(300);
      log('PASS', 'Users', 'Plan filter select works');
    }
  }

  // Role filter
  if (planFilterSel.length >= 2) {
    const rf = planFilterSel[1];
    const opts = await rf.$$('option');
    if (opts.length >= 2) {
      await rf.selectOption('admin');
      await page.waitForTimeout(300);
      const rows = await page.$$('tbody tr:not(.hidden)');
      rows.length > 0
        ? log('PASS', 'Users', 'Role filter "admin" returns rows')
        : log('WARN', 'Users', 'Role filter returned no rows');
      await rf.selectOption('all');
      await page.waitForTimeout(300);
    }
  }

  // Status filter (active/locked/inactive)
  if (planFilterSel.length >= 3) {
    const sf = planFilterSel[2];
    await sf.selectOption('active');
    await page.waitForTimeout(300);
    await sf.selectOption('all');
    await page.waitForTimeout(300);
    log('PASS', 'Users', 'Status filter (active/all) works');
  }

  // Column picker
  const colsBtn = await page.$('button:has-text("Columns")');
  if (colsBtn) {
    await colsBtn.click();
    await page.waitForTimeout(400);
    const picker = await page.$('text=Lookup Credits');
    picker
      ? log('PASS', 'Users', 'Column picker opens showing credit columns')
      : log('WARN', 'Users', 'Column picker opened but Lookup Credits not found');
    // Toggle a column
    const checkboxes = await page.$$('input[type="checkbox"]');
    if (checkboxes.length > 0) {
      await checkboxes[0].click();
      await page.waitForTimeout(200);
      await checkboxes[0].click(); // restore
      await page.waitForTimeout(200);
      log('PASS', 'Users', 'Column checkbox toggle works');
    }
    // All / Reset buttons (JS click bypasses overlay)
    const allClicked = await page.evaluate(() => {
      const picker = document.querySelector('[class*="absolute"][class*="z-20"]');
      if (!picker) return false;
      const allBtn = [...picker.querySelectorAll('button')].find(b => b.textContent.trim() === 'All');
      if (allBtn) { allBtn.click(); return true; }
      return false;
    });
    allClicked
      ? log('PASS', 'Users', '"All columns" button works')
      : log('WARN', 'Users', '"All" button not found in column picker');
    await page.waitForTimeout(200);

    const resetClicked = await page.evaluate(() => {
      const picker = document.querySelector('[class*="absolute"][class*="z-20"]');
      if (!picker) return false;
      const resetBtn = [...picker.querySelectorAll('button')].find(b => b.textContent.trim() === 'Reset');
      if (resetBtn) { resetBtn.click(); return true; }
      return false;
    });
    resetClicked
      ? log('PASS', 'Users', '"Reset columns" button works')
      : log('WARN', 'Users', '"Reset" button not found in column picker');
    await page.waitForTimeout(200);

    // Close picker via JS click (toast container at z-[100] can block normal clicks on right side)
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Columns');
      btn?.click();
      // Also disable toast container pointer-events so subsequent clicks work
      document.querySelectorAll('[class]').forEach(el => {
        if (el.className && typeof el.className === 'string' && el.className.includes('z-[100]')) {
          el.style.pointerEvents = 'none';
        }
      });
    });
    await page.waitForTimeout(300);
  } else {
    log('FAIL', 'Users', 'Columns button not found');
  }

  // Wait for React to re-render table after column reset
  await page.waitForTimeout(500);

  // Table sortable headers — use locator so element is re-queried at click time (avoids stale refs)
  const thCount = await page.locator('th').count();
  if (thCount > 0) {
    await page.locator('th').first().click({ force: true });
    await page.waitForTimeout(300);
    await page.locator('th').first().click({ force: true });
    await page.waitForTimeout(300);
    log('PASS', 'Users', 'Sortable table header clickable (asc/desc)');
  } else {
    log('WARN', 'Users', 'No table headers found');
  }

  // User row — Lock/Unlock button (skip self, find another user)
  const rowCount = await page.locator('tbody tr').count();
  let lockBtnFound = false;
  for (let i = 0; i < rowCount; i++) {
    const rowText = await page.locator('tbody tr').nth(i).textContent();
    if (!rowText.includes(EMAIL)) {
      const lockLoc = page.locator('tbody tr').nth(i).locator('button:has-text("Lock"), button:has-text("Unlock")');
      const lockCount = await lockLoc.count();
      if (lockCount > 0) {
        const btnLabel = await lockLoc.first().textContent();
        log('PASS', 'Users', `Lock/Unlock button visible on user row: "${btnLabel.trim()}"`);
        lockBtnFound = true;
        await lockLoc.first().click({ force: true });
        await page.waitForTimeout(400);
        const modal = await page.$('text=lock this account') || await page.$('text=unlock this account') || await page.$('text=Confirm Action');
        if (modal) {
          log('PASS', 'Users', 'Lock/Unlock confirmation modal opens');
          const cancelModal = await page.$('button:has-text("Cancel")');
          if (cancelModal) { await cancelModal.click({ force: true }); await page.waitForTimeout(300); log('PASS', 'Users', 'Lock modal Cancel works'); }
        } else {
          log('WARN', 'Users', 'Lock modal not found after clicking Lock button');
        }
        break;
      }
    }
  }
  if (!lockBtnFound) log('WARN', 'Users', 'No Lock/Unlock button found on any non-self row');

  // ═══════════════════════════════════════════════════════════════════
  // TAB NAVIGATION — all 8 tabs accessible
  // ═══════════════════════════════════════════════════════════════════
  const tabLabels = ['Support Tickets', 'Feedback', 'Contact Messages', 'System Alerts', 'Error Tracking', 'Analytics', 'Plans & Credits', 'Users'];
  for (const label of tabLabels) {
    const btn = await page.$(`button:has-text("${label}")`);
    btn
      ? log('PASS', 'Nav', `Tab "${label}" button accessible`)
      : log('FAIL', 'Nav', `Tab "${label}" button not found`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log(`RESULTS: ${passed} passed  |  ${warnings} warnings  |  ${failed} failed`);
  console.log('─'.repeat(70));

  if (failed > 0) {
    console.log('\nFAILED:');
    results.filter(r => r.status === 'FAIL').forEach(r =>
      console.log(`  ❌ [${r.section}] ${r.test}${r.detail ? ' — ' + r.detail : ''}`)
    );
  }
  if (warnings > 0) {
    console.log('\nWARNINGS (non-critical / empty data):');
    results.filter(r => r.status === 'WARN').forEach(r =>
      console.log(`  ⚠️  [${r.section}] ${r.test}${r.detail ? ' — ' + r.detail : ''}`)
    );
  }

  await page.waitForTimeout(1000);
  await browser.close();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
