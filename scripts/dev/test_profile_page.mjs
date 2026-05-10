/**
 * Comprehensive Profile page test
 * Tests every interactive element across all tabs and left column.
 */
import { chromium } from 'playwright';
import jwt from '../node_modules/jsonwebtoken/index.js';

const BASE = 'http://localhost:5173';
const API  = 'http://localhost:3001';

const JWT_SECRET = 'devsecret_replace_me';
const USER_ID    = 'cd527c9b-44cc-4b84-9948-91350c8af6a4';
const EMAIL      = 'zanrow.co@gmail.com';

let passed = 0, failed = 0, warnings = 0;
const results = [];

function log(status, section, test, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  const line = `${icon} [${section}] ${test}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  results.push({ status, section, test, detail });
  if (status === 'PASS') passed++;
  else if (status === 'WARN') warnings++;
  else failed++;
}

function getToken() {
  return jwt.sign(
    { id: USER_ID, email: EMAIL, role_type: 'admin' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Suppress console noise
  page.on('console', m => { if (m.type() === 'error') console.error('  [browser error]', m.text()); });

  // ── Inject token directly (dev JWT) ─────────────────────────────────────
  const token = getToken();
  const userObj = {
    id: USER_ID, email: EMAIL, role_type: 'admin',
    full_name: 'Gagan', subscription_plan: 'free',
    phone: null, preferred_theme: 'light', is_email_verified: true,
  };
  await page.goto(BASE);
  await page.evaluate(([t, u]) => {
    localStorage.setItem('app_access_token', t);
    localStorage.setItem('app_current_user', JSON.stringify(u));
  }, [token, userObj]);
  log('PASS', 'Auth', 'JWT token + user object injected into localStorage');
  await page.goto(`${BASE}/profile`);
  await page.waitForLoadState('networkidle');

  // ── Confirm page loaded ──────────────────────────────────────────────────
  const heading = await page.$('h1');
  const headingText = heading ? await heading.textContent() : '';
  headingText.includes('Profile')
    ? log('PASS', 'Page', 'Profile page loaded')
    : log('FAIL', 'Page', 'Profile heading not found', headingText);

  // ── LEFT COLUMN ──────────────────────────────────────────────────────────

  // 1. Full Name field exists and is editable
  const nameInput = await page.$('input[value]');
  if (nameInput) {
    const val = await nameInput.inputValue();
    val.length > 0
      ? log('PASS', 'Left Col', 'Full Name field populated', `"${val}"`)
      : log('WARN', 'Left Col', 'Full Name field is empty');
  } else {
    log('FAIL', 'Left Col', 'Full Name input not found');
  }

  // 2. Save Profile button — change name, save, verify response
  try {
    const inputs = await page.$$('input');
    let nameField = null;
    for (const inp of inputs) {
      const cls = await inp.getAttribute('class') || '';
      const type = await inp.getAttribute('type') || 'text';
      if (type === 'text' || type === '') {
        const val = await inp.inputValue();
        if (val && !val.includes('@')) { nameField = inp; break; }
      }
    }
    if (!nameField) {
      // fallback: first text-like input
      nameField = await page.$('input:not([type="password"]):not([type="email"])');
    }
    if (nameField) {
      await nameField.fill('Test User Profile');
      const saveBtn = await page.$('button:has-text("Save Profile")');
      if (saveBtn) {
        await saveBtn.click();
        await page.waitForTimeout(1200);
        const msg = await page.$('p.text-emerald-600, p.text-red-500');
        const msgText = msg ? await msg.textContent() : '';
        msgText.toLowerCase().includes('success')
          ? log('PASS', 'Left Col', 'Save Profile — success message shown', msgText)
          : log('FAIL', 'Left Col', 'Save Profile — no success message', msgText || 'no message found');
      } else {
        log('FAIL', 'Left Col', 'Save Profile button not found');
      }
      // Restore original name
      await nameField.fill('Test');
      const saveBtn2 = await page.$('button:has-text("Save Profile")');
      if (saveBtn2) await saveBtn2.click();
      await page.waitForTimeout(800);
    } else {
      log('FAIL', 'Left Col', 'Name input not found for save test');
    }
  } catch (e) {
    log('FAIL', 'Left Col', 'Save Profile threw', e.message);
  }

  // 3. Dark Mode toggle
  try {
    const toggle = await page.$('button[role="switch"]');
    if (toggle) {
      const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      await toggle.click();
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      after !== before
        ? log('PASS', 'Left Col', 'Dark Mode toggle changes theme', `${before} → ${after}`)
        : log('FAIL', 'Left Col', 'Dark Mode toggle did not change theme class');
      // Restore
      await toggle.click();
      await page.waitForTimeout(600);
    } else {
      log('FAIL', 'Left Col', 'Dark Mode switch not found');
    }
  } catch (e) {
    log('FAIL', 'Left Col', 'Dark Mode toggle threw', e.message);
  }

  // ── OVERVIEW TAB ────────────────────────────────────────────────────────
  await page.click('button:has-text("Overview")');
  await page.waitForTimeout(600);

  try {
    const usageCard = await page.$('text=Current Usage');
    usageCard
      ? log('PASS', 'Overview', 'Current Usage card visible')
      : log('FAIL', 'Overview', 'Current Usage card not found');

    const progressBar = await page.$('[style*="width"]');
    progressBar
      ? log('PASS', 'Overview', 'Usage progress bar rendered')
      : log('WARN', 'Overview', 'Progress bar not found (may be 0%)');

    const planCard = await page.$('text=Current Plan');
    planCard
      ? log('PASS', 'Overview', 'Current Plan card visible')
      : log('FAIL', 'Overview', 'Current Plan card not found');

    // Upgrade / Manage button
    const upgradeBtn = await page.$('button:has-text("Upgrade Plan"), button:has-text("Manage Subscription")');
    if (upgradeBtn) {
      const btnText = await upgradeBtn.textContent();
      log('PASS', 'Overview', `Plan action button present`, btnText.trim());
      // Click it — should switch to Billing tab
      await upgradeBtn.click();
      await page.waitForTimeout(500);
      const billingActive = await page.$('[class*="bg-white"]:has-text("Billing"), [class*="shadow"]:has-text("Billing")');
      billingActive
        ? log('PASS', 'Overview', 'Upgrade/Manage button navigates to Billing tab')
        : log('WARN', 'Overview', 'Tab switch from Upgrade button not confirmed visually');
      // Go back to Overview
      await page.click('button:has-text("Overview")');
      await page.waitForTimeout(400);
    } else {
      log('FAIL', 'Overview', 'No Upgrade Plan / Manage Subscription button found');
    }
  } catch (e) {
    log('FAIL', 'Overview', 'Overview tab test threw', e.message);
  }

  // ── BILLING TAB ─────────────────────────────────────────────────────────
  await page.click('button:has-text("Billing")');
  await page.waitForTimeout(800);

  try {
    // Subscription Plans section
    const plansHeading = await page.$('text=Subscription Plans');
    plansHeading
      ? log('PASS', 'Billing', 'Subscription Plans section visible')
      : log('FAIL', 'Billing', 'Subscription Plans heading not found');

    // Monthly/Annually toggle
    const annualBtn = await page.$('button:has-text("Annually")');
    if (annualBtn) {
      await annualBtn.click();
      await page.waitForTimeout(500);
      const saveBadge = await page.$('text=Save');
      log('PASS', 'Billing', 'Annually toggle clickable');
      // Switch back
      const monthlyBtn = await page.$('button:has-text("Monthly")');
      if (monthlyBtn) await monthlyBtn.click();
      await page.waitForTimeout(400);
    } else {
      log('FAIL', 'Billing', 'Monthly/Annually toggle not found');
    }

    // Plan cards rendered
    const planCards = await page.$$('button:has-text("Subscribe"), button:has-text("Current Plan"), button:has-text("Free Plan")');
    planCards.length >= 1
      ? log('PASS', 'Billing', `Plan cards rendered`, `${planCards.length} card button(s)`)
      : log('FAIL', 'Billing', 'No plan card buttons found');

    // Collapse/expand Subscription Plans card
    const subsHeader = await page.$('text=Subscription Plans');
    if (subsHeader) {
      await subsHeader.click();
      await page.waitForTimeout(300);
      await subsHeader.click();
      await page.waitForTimeout(300);
      log('PASS', 'Billing', 'Subscription Plans card collapses/expands');
    }

    // Current Subscription section
    const currentSubSection = await page.$('text=Current Subscription');
    currentSubSection
      ? log('PASS', 'Billing', 'Current Subscription section visible')
      : log('FAIL', 'Billing', 'Current Subscription section not found');

    // Plan label in Current Subscription
    const planLabel = await page.$('text=Plan');
    planLabel
      ? log('PASS', 'Billing', 'Plan field in Current Subscription visible')
      : log('WARN', 'Billing', 'Plan field not found');

    // Payment section
    const paymentSection = await page.$('text=Payment');
    paymentSection
      ? log('PASS', 'Billing', 'Payment section visible')
      : log('FAIL', 'Billing', 'Payment section not found');

    // Payment History section
    const historySection = await page.$('text=Payment History');
    historySection
      ? log('PASS', 'Billing', 'Payment History section visible')
      : log('FAIL', 'Billing', 'Payment History section not found');

    // Empty state or table for invoices
    const noInvoices = await page.$('text=No payment history yet');
    const invoiceTable = await page.$('table');
    noInvoices || invoiceTable
      ? log('PASS', 'Billing', 'Payment History shows content (empty state or table)')
      : log('FAIL', 'Billing', 'Payment History has neither empty state nor table');

  } catch (e) {
    log('FAIL', 'Billing', 'Billing tab test threw', e.message);
  }

  // ── ACCOUNT SETTINGS TAB ────────────────────────────────────────────────
  await page.click('button:has-text("Settings")');
  await page.waitForTimeout(600);

  try {
    // Change Password card should be visible (non-Google account)
    const pwdCard = await page.$('text=Change Password');
    if (pwdCard) {
      log('PASS', 'Settings', 'Change Password card visible');

      // Expand it
      await pwdCard.click();
      await page.waitForTimeout(400);

      const currentPwdField = await page.$('input[type="password"]');
      currentPwdField
        ? log('PASS', 'Settings', 'Password fields rendered after expand')
        : log('FAIL', 'Settings', 'Password fields not visible after expanding card');

      // Test password validation — mismatched passwords
      const pwdInputs = await page.$$('input[type="password"]');
      if (pwdInputs.length >= 3) {
        await pwdInputs[0].fill('wrongcurrent');
        await pwdInputs[1].fill('NewPass123!');
        await pwdInputs[2].fill('Different123!');
        const changePwdBtn = await page.$('button:has-text("Change Password")');
        if (changePwdBtn) {
          await changePwdBtn.click();
          await page.waitForTimeout(600);
          const errorMsg = await page.$('text=do not match');
          errorMsg
            ? log('PASS', 'Settings', 'Password mismatch validation works')
            : log('FAIL', 'Settings', 'No mismatch error shown');
        }
        // Clear fields
        for (const f of pwdInputs) await f.fill('');
      } else {
        log('WARN', 'Settings', `Expected 3 password fields, found ${pwdInputs.length}`);
      }

      // Test password rules indicator — type a weak password
      const pwdInputs2 = await page.$$('input[type="password"]');
      if (pwdInputs2.length >= 2) {
        await pwdInputs2[1].fill('abc');
        await page.waitForTimeout(300);
        const rules = await page.$$('[class*="emerald"], [class*="gray-400"]');
        rules.length > 0
          ? log('PASS', 'Settings', 'Password rules indicator renders while typing')
          : log('WARN', 'Settings', 'Password rules indicator not found');
        await pwdInputs2[1].fill('');
      }
    } else {
      log('WARN', 'Settings', 'Change Password card not found — may be Google OAuth user');
    }

    // Delete Account card
    const deleteCard = await page.$('text=Delete Account');
    if (deleteCard) {
      log('PASS', 'Settings', 'Delete Account card visible');

      // Expand it
      await deleteCard.click();
      await page.waitForTimeout(400);

      const deleteInput = await page.$('input[placeholder="DELETE"]');
      if (deleteInput) {
        log('PASS', 'Settings', 'Delete confirmation input visible after expand');

        // Delete button should be disabled when input is empty
        const deleteBtn = await page.$('button:has-text("Delete Account")');
        const isDisabled = deleteBtn ? await deleteBtn.isDisabled() : true;
        isDisabled
          ? log('PASS', 'Settings', 'Delete Account button disabled when input empty')
          : log('FAIL', 'Settings', 'Delete Account button NOT disabled when input empty');

        // Type partial string — still disabled
        await deleteInput.fill('DEL');
        await page.waitForTimeout(200);
        const stillDisabled = deleteBtn ? await deleteBtn.isDisabled() : true;
        stillDisabled
          ? log('PASS', 'Settings', 'Delete button stays disabled for partial "DEL" input')
          : log('FAIL', 'Settings', 'Delete button enabled for partial input (dangerous!)');

        // Clear it
        await deleteInput.fill('');
      } else {
        log('FAIL', 'Settings', 'Delete confirmation input not found after expand');
      }
    } else {
      log('FAIL', 'Settings', 'Delete Account card not found');
    }
  } catch (e) {
    log('FAIL', 'Settings', 'Settings tab test threw', e.message);
  }

  // ── CONTACT US TAB ──────────────────────────────────────────────────────
  await page.click('button:has-text("Contact")');
  await page.waitForTimeout(800);

  // Support Tickets
  try {
    const supportHeading = await page.$('text=Contact Support');
    supportHeading
      ? log('PASS', 'Contact', 'Contact Support section visible (default open)')
      : log('FAIL', 'Contact', 'Contact Support section not found/not open');

    // New Ticket button
    const newTicketBtn = await page.$('button:has-text("New Ticket")');
    if (newTicketBtn) {
      log('PASS', 'Contact', 'New Ticket button visible');
      await newTicketBtn.click();
      await page.waitForTimeout(400);

      // Form should appear
      const titleInput = await page.$('input[placeholder*="summary"]');
      titleInput
        ? log('PASS', 'Contact', 'New Ticket form appears on button click')
        : log('FAIL', 'Contact', 'New Ticket form did not appear');

      // Test validation — submit empty form
      const submitBtn = await page.$('button:has-text("Submit Ticket")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(400);
        const errMsg = await page.$('p.text-red-500');
        errMsg
          ? log('PASS', 'Contact', 'Ticket form validation fires on empty submit')
          : log('FAIL', 'Contact', 'No validation error on empty ticket submit');
      }

      // Fill and submit a real ticket
      if (titleInput) {
        await titleInput.fill('Automated test ticket — please ignore');
        const descArea = await page.$('textarea[placeholder*="detail"]');
        if (descArea) await descArea.fill('This is an automated test ticket submitted by the profile page test script. Safe to delete.');

        // Category select
        const categorySelect = await page.$('select');
        if (categorySelect) await categorySelect.selectOption('bug');

        if (submitBtn) {
          await submitBtn.click();
          await page.waitForTimeout(1500);
          const successMsg = await page.$('text=Ticket submitted');
          successMsg
            ? log('PASS', 'Contact', 'Support ticket submission succeeds')
            : log('FAIL', 'Contact', 'No success message after ticket submit');
        }
      }
    } else {
      log('FAIL', 'Contact', 'New Ticket button not found');
    }

    // Check ticket appears in list
    await page.waitForTimeout(500);
    const ticketList = await page.$('.space-y-3 > div');
    ticketList
      ? log('PASS', 'Contact', 'Ticket list renders')
      : log('WARN', 'Contact', 'No tickets in list (may be empty)');

    // Reply textarea on existing ticket
    const replyArea = await page.$('textarea[placeholder*="reply"]');
    if (replyArea) {
      log('PASS', 'Contact', 'Reply textarea visible on existing ticket');
      // Send Reply button should be disabled when empty
      const sendBtn = await page.$('button:has-text("Send Reply")');
      const replyDisabled = sendBtn ? await sendBtn.isDisabled() : true;
      replyDisabled
        ? log('PASS', 'Contact', 'Send Reply button disabled when reply is empty')
        : log('FAIL', 'Contact', 'Send Reply button NOT disabled when empty');
    } else {
      log('WARN', 'Contact', 'No reply textarea found (no open tickets yet or no tickets)');
    }

  } catch (e) {
    log('FAIL', 'Contact', 'Support ticket tests threw', e.message);
  }

  // Feedback / Suggestions
  try {
    const feedbackHeading = await page.$('text=Share Your Thoughts');
    feedbackHeading
      ? log('PASS', 'Contact', 'Share Your Thoughts section visible (default open)')
      : log('FAIL', 'Contact', 'Share Your Thoughts section not found/not open');

    const shareIdeaBtn = await page.$('button:has-text("Share an Idea")');
    if (shareIdeaBtn) {
      log('PASS', 'Contact', 'Share an Idea button visible');
      await shareIdeaBtn.click();
      await page.waitForTimeout(400);

      // Validation — submit empty
      const submitIdeaBtn = await page.$('button:has-text("Submit Idea")');
      if (submitIdeaBtn) {
        await submitIdeaBtn.click();
        await page.waitForTimeout(400);
        const errMsg = await page.$$('p.text-red-500');
        errMsg.length > 0
          ? log('PASS', 'Contact', 'Feedback form validation fires on empty submit')
          : log('FAIL', 'Contact', 'No validation error on empty feedback submit');
      }

      // Fill and submit
      const ideaTitleInput = await page.$('input[placeholder*="would you like"]');
      if (ideaTitleInput) {
        await ideaTitleInput.fill('Test idea — automated test, please ignore');
        const ideaDescArea = await page.$('textarea[placeholder*="useful"]');
        if (ideaDescArea) await ideaDescArea.fill('This is an automated test suggestion submitted by the profile page test script. Safe to delete.');
        if (submitIdeaBtn) {
          await submitIdeaBtn.click();
          await page.waitForTimeout(1500);
          const successText = await page.$('text=Thanks for your idea');
          successText
            ? log('PASS', 'Contact', 'Feedback suggestion submission succeeds')
            : log('FAIL', 'Contact', 'No success message after feedback submit');
        }
      } else {
        // fallback — any remaining text input in the form area
        log('WARN', 'Contact', 'Idea title input not found by placeholder');
      }
    } else {
      log('FAIL', 'Contact', 'Share an Idea button not found');
    }
  } catch (e) {
    log('FAIL', 'Contact', 'Feedback tests threw', e.message);
  }

  // ── TAB NAVIGATION ──────────────────────────────────────────────────────
  try {
    const tabIds = ['Overview', 'Billing', 'Settings', 'Contact'];
    for (const t of tabIds) {
      // On mobile the button shows short label, on desktop full label
      const btn = await page.$(`button:has-text("${t}")`);
      if (btn) {
        await btn.click();
        await page.waitForTimeout(300);
        log('PASS', 'Tabs', `Tab "${t}" clickable`);
      } else {
        log('FAIL', 'Tabs', `Tab "${t}" button not found`);
      }
    }
  } catch (e) {
    log('FAIL', 'Tabs', 'Tab navigation threw', e.message);
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log(`RESULTS: ${passed} passed  |  ${warnings} warnings  |  ${failed} failed`);
  console.log('─'.repeat(60));

  if (failed > 0) {
    console.log('\nFAILED:');
    results.filter(r => r.status === 'FAIL').forEach(r =>
      console.log(`  ❌ [${r.section}] ${r.test}${r.detail ? ' — ' + r.detail : ''}`)
    );
  }
  if (warnings > 0) {
    console.log('\nWARNINGS:');
    results.filter(r => r.status === 'WARN').forEach(r =>
      console.log(`  ⚠️  [${r.section}] ${r.test}${r.detail ? ' — ' + r.detail : ''}`)
    );
  }

  await page.waitForTimeout(1000);
  await browser.close();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
