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
| **Support Email** | admin@digi5y.com |
| **Support URL** | https://digitracker.digi5y.co/#/install |
| **App Website** | https://digitracker.digi5y.co |
| **Privacy Policy URL** | https://digitracker.digi5y.co/#/privacy |
| **Terms of Service URL** | https://digitracker.digi5y.co/#/terms |
| **Category** | Productivity / HR & Team Management |
| **Tags** | time tracking, remote work, HR, workforce, screen capture, KPIs, tasks |

---

## 2. App URLs (Enter in GHL Developer Portal)

| Field | Value |
|---|---|
| **Install / Landing URL** | `https://digitracker.digi5y.co/#/install` |
| **OAuth Redirect URI** | `https://digitracker.digi5y.co/ghl/callback` |
| **Webhook URL** | `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/ghl-webhook` |

---

## 3. OAuth Scopes Required

```
contacts.readonly
contacts.write
locations.readonly
calendars.readonly
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

#### 👥 3-Tier Role System
| Role | Access |
|---|---|
| **Super-Admin** | Full platform management across all sub-accounts |
| **Manager** | Approve leave, review time logs, manage team tasks and KPIs |
| **Staff** | Clock in/out, view personal records, submit leave, complete tasks |

#### 🔗 GoHighLevel Integration
Once connected, DIGITRACKER:
- Mirrors GHL contacts as potential team members
- Pushes daily time summaries to GHL contact notes
- Receives real-time contact and calendar events via GHL webhooks
- Supports single-sign-on flow through GHL sub-account linking

---

### How It Works

1. **Install** — Click "Install App" and authorize DIGITRACKER to connect to your GHL sub-account.
2. **Invite Team** — Add managers and staff with their emails. They receive a magic-link to join.
3. **Go Live** — Staff clock in from any device. Screenshots capture automatically. Everything syncs to GHL.

---

### Subscription Plans

| Plan | Users | Features |
|---|---|---|
| **Basic** | Up to 5 | Time tracking, screen capture, leave management |
| **Business** | Up to 20 | + Tasks, KPIs, HR documents, GHL contact sync |
| **Professional** | Unlimited | + Priority support, custom KPI frameworks, advanced reporting |

All plans include a **14-day free trial** — no credit card required.

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
- Real-time GHL webhook events (contacts, appointments)
- 3-tier role system: Super-Admin, Manager, Staff
- Magic-link authentication (no passwords)
- Responsive — works on desktop, tablet, and mobile
```

---

## 7. Support & Onboarding

**Support Email:** admin@digi5y.com  
**Response time:** Within 1 business day

**Onboarding steps provided in-app:**
1. Install DIGITRACKER from GHL Marketplace
2. Create your first sub-account in DIGITRACKER
3. Invite your team via email (magic-link, no password)
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
| 6 | Install / landing page | https://digitracker.digi5y.co/#/install |

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
- [ ] Install URL set: `https://digitracker.digi5y.co/#/install`
- [ ] OAuth Redirect URI set: `https://digitracker.digi5y.co/ghl/callback`
- [ ] Webhook URL set: `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/ghl-webhook`
- [ ] Scopes selected: contacts.readonly, contacts.write, locations.readonly, calendars.readonly, users.readonly
- [ ] 6 screenshots uploaded
- [ ] App icon (512×512) uploaded
- [ ] Support email: admin@digi5y.com
- [ ] Privacy Policy URL added
- [ ] Terms of Service URL added
- [ ] Pricing listed (Basic / Business / Professional)
- [ ] Copy Client ID and Client Secret from this form → paste into GitHub Secrets
