# DIGITRACKER — GHL Marketplace App Profile

> **Use this document to fill in the GoHighLevel Marketplace submission form.**
> URL: https://marketplace.gohighlevel.com/developer

---

## 1. Basic Information

| Field | Value |
|---|---|
| **App Name** | DIGITRACKER |
| **Tagline** | Remote Workforce Management — Built for GHL Sub-Accounts |
| **Developer / Company** | DIGI5Y |
| **Support Email** | admin@digi5y.co |
| **Support URL** | https://digitracker-app.digi5y.co/#/install |
| **App Website** | https://digitracker-app.digi5y.co (see note below) |
| **Privacy Policy URL** | https://digitracker-app.digi5y.co/#/privacy |
| **Terms of Service URL** | https://digitracker-app.digi5y.co/#/terms |
| **Category** | Productivity / HR & Team Management |
| **Tags** | time tracking, remote work, HR, workforce, screen capture, KPIs, tasks |

> **App Website note:** `www.digitracker.co` currently does not resolve at all
> (DNS failure — confirmed via `curl`/`dig`, not a temporary blip). A dead
> "App Website" link is a common, easy reason a Marketplace review gets
> rejected or held. Until that domain is fixed, use
> `https://digitracker-app.digi5y.co` (confirmed live) as the App Website
> field instead. Separately, `digitracker.digi5y.co` currently resolves but
> serves an unrelated GoHighLevel funnel page, not this app — do not use it
> here either until that's resolved.

---

## 2. App URLs (Enter in GHL Developer Portal)

| Field | Value |
|---|---|
| **Install / Landing URL** | `https://digitracker-app.digi5y.co/#/install` |
| **OAuth Redirect URI** | `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/oauth-callback` |
| **Webhook URL** | `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/crm-webhook` |

> The redirect URI and webhook URL point at Supabase Edge Functions, not the
> app itself — and deliberately avoid the substring "ghl" in the path, which
> GHL's own URL validation rejects.

---

## 3. OAuth Scopes Required

```
contacts.readonly
contacts.write
locations.readonly
users.readonly
```

---

## 4. Short Description
*(~160 characters — used in search results and app card)*

```
DIGITRACKER tracks remote team hours, captures work screens, manages leave and KPIs — all synced with your GHL sub-account.
```

---

## 5. Full Description
*(Use in the "App Description" or "About" section — markdown supported)*

---

### Track Every Hour. Manage Every Team Member. All Inside GHL.

**DIGITRACKER** is a full-stack remote workforce management platform built specifically for GoHighLevel agencies and their clients. Connect it to any GHL sub-account to bring time tracking, screen capture, leave approvals, task management, and KPI reporting into one dashboard.

---

### Key Features

#### ⏱ Time Tracking with Proof of Work
Staff clock in and out with a single tap. DIGITRACKER captures periodic screenshots while the clock is running, giving managers verifiable proof of active work — not just logged hours.

#### 📸 Automatic Screen Capture
Randomized screenshots are captured during work sessions and stored securely. Managers review captures in a clean timeline view. Privacy controls ensure captures only run during active clock-in periods.

#### 🗓 Leave Management
Staff submit time-off requests directly in the app. Managers approve or reject with one click. Leave balances, accrual, and history are tracked automatically — no spreadsheets needed.

#### ✅ Task & KPI Management
Assign tasks to team members, set deadlines, and track completion rates. Define custom KPIs per role or per team and measure performance against real targets month over month.

#### 📄 HR Document Storage
Upload contracts, policies, appraisals, and other HR documents. Role-based access ensures staff only see what they're meant to see.

#### 👥 Role-Based Access
| Role | Access |
|---|---|
| **Admin** | Manage users, departments, payroll, subscription/billing, and integrations |
| **Manager** | Approve leave, review time logs, manage team tasks and KPIs |
| **Staff** | Clock in/out, view personal records, submit leave, complete tasks |

> Note: "Super-Admin" is DIGI5Y's own internal platform-operator role and is
> not something a subscribing customer ever has — it must not appear in
> customer-facing listing copy. Removed from this table for that reason.

#### 🔗 GoHighLevel Integration
Once connected, DIGITRACKER:
- Mirrors GHL contacts as potential team members
- Receives real-time contact create/update events via GHL webhooks
- Reflects app install/uninstall state automatically

---

### How It Works

1. **Install** — Click "Install App" and authorize DIGITRACKER to connect to your GHL sub-account.
2. **Invite Team** — Add managers and staff with their emails. They receive a secure invite link to set their password and join.
3. **Go Live** — Staff clock in from any device. Screenshots capture automatically. Everything syncs to GHL.

---

### Subscription Plans

| Plan | Seats | Features |
|---|---|---|
| **Free** | Up to 3 | Time tracking, 7-day screenshots, basic reports |
| **Standard** | Up to 10 | + Calendar & Leave, Tasks & KPIs, 30-day screenshots |
| **Business** | Up to 100 | + HR Documents, advanced reports, GHL/Digi5y AI-CRM integration |
| **Professional** | Up to 1,000 | + Custom branding, priority support |

The Free plan requires no card and no trial — it's free indefinitely. Paid
plans may include a trial period (configurable), but checkout runs through
Stripe, which collects payment details upfront even during a trial — do
**not** advertise paid plans as "no credit card required." Exact current
pricing and seat limits are always shown live on the subscribe page and
should be treated as the source of truth over this table.

---

### Security & Compliance

- All data stored in Supabase (SOC 2 compliant infrastructure)
- Row-Level Security (RLS) enforced — users only access their own sub-account data
- OAuth tokens encrypted at rest
- Screen captures stored with access-controlled signed URLs
- No data shared across sub-accounts

---

### Built By DIGI5Y

DIGI5Y is a digital operations firm specializing in GHL integrations, workflow automation, and remote team infrastructure. DIGITRACKER was built to solve a real problem: verifying that remote staff are working — without invasive monitoring or complicated HR software.

---

## 6. What's New / Release Notes
*(For initial listing)*

```
v1.0 — Initial Release

- Time tracking with clock-in / clock-out
- Automatic screen capture during active sessions
- Leave request and approval workflow
- Task assignment and completion tracking
- KPI dashboards per role
- HR document storage with role-based access
- GoHighLevel sub-account integration via OAuth
- Real-time GHL webhook events (contact create/update, install/uninstall)
- Role-based access: Admin, Manager, Staff
- Secure email invite links for onboarding — new users set their own password, no passwords shared or managed by Admins
- Responsive — works on desktop, tablet, and mobile
```

---

## 7. Support & Onboarding

**Support Email:** admin@digi5y.co  
**Response time:** Within 1 business day

**Onboarding steps provided in-app:**
1. Install DIGITRACKER from GHL Marketplace
2. Create your first sub-account in DIGITRACKER
3. Invite your team via email (secure invite link — they set their own password)
4. Staff clock in — data starts flowing

---

## 8. Screenshots to Prepare

Capture and upload these screens before submitting:

| # | Screen | Notes |
|---|---|---|
| 1 | Dashboard — Time Tracking view | Show clock-in button + active timer |
| 2 | Screenshots gallery | Show proof-of-work captures in timeline |
| 3 | Leave Management | Show pending requests + approve/reject UI |
| 4 | Tasks & KPI page | Show task list with completion badges |
| 5 | Settings → GHL Integration tab | Show "Connected" green card |
| 6 | Install / landing page | https://digitracker-app.digi5y.co/#/install |

**Recommended dimensions:** 1280×800px or 1920×1080px, PNG or JPEG

---

## 9. App Icon

- **Size:** 512×512px minimum, square
- **Format:** PNG with transparent background preferred
- **Style:** Use DIGI5Y brand mark or the DIGITRACKER "DT" monogram on violet (#7C3AED) background

---

## 10. Submission Checklist

- [ ] App Name: `DIGITRACKER`
- [ ] Short description filled in (≤160 chars)
- [ ] Full description pasted (markdown)
- [ ] Install URL set: `https://digitracker-app.digi5y.co/#/install`
- [ ] OAuth Redirect URI set: `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/oauth-callback`
- [ ] Webhook URL set: `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/crm-webhook`
- [ ] Scopes selected: contacts.readonly, contacts.write, locations.readonly, users.readonly
- [ ] 6 screenshots uploaded
- [ ] App icon (512×512) uploaded
- [ ] Support email: admin@digi5y.co
- [ ] Privacy Policy URL added
- [ ] Terms of Service URL added
- [ ] Pricing listed (Free / Standard / Business / Professional — "Standard" is the id `basic` shown to users; don't call it "Basic" in copy)
- [ ] Copy Client ID and Client Secret from this form → paste into GitHub Secrets
