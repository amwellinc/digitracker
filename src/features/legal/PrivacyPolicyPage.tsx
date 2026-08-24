import { LegalPageLayout, LegalSection } from './LegalPageLayout'

export function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="24 August 2026">
      <p>
        This Privacy Policy explains how DIGI5Y ("we", "us", "our") collects, uses, and
        protects information when you use DIGITRACKER, our remote-workforce management
        platform, including when you connect DIGITRACKER to GoHighLevel ("GHL") through
        our Marketplace App integration.
      </p>

      <LegalSection heading="1. Information We Collect">
        <p><strong>Account &amp; workspace data.</strong> Name, work email, role, phone
        number, country, reporting schedule, and other profile fields you or your
        administrator provide when creating a DIGITRACKER account.</p>
        <p><strong>Work activity data.</strong> Clock in/out times, idle and lunch
        status, periodic screen captures (where enabled by your administrator), task
        and KPI submissions, leave requests and supporting documents, and payroll
        records entered by your administrator.</p>
        <p><strong>GoHighLevel integration data.</strong> When an administrator
        connects DIGITRACKER to a GHL sub-account, we receive and store: the GHL
        location ID, an OAuth access token and refresh token (used only to maintain
        the connection — never shown to any user), and contact records (name, email,
        phone) that GHL sends us via webhook events. We request the following GHL
        scopes: <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">contacts.readonly</code>,{' '}
        <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">contacts.write</code>,{' '}
        <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">locations.readonly</code>, and{' '}
        <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">users.readonly</code> —
        each scoped strictly to the features described in the DIGITRACKER settings page
        for the integration.</p>
      </LegalSection>

      <LegalSection heading="2. How We Use Information">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>To operate core DIGITRACKER features: time tracking, task and KPI
          management, leave management, HR document storage, and payroll records.</li>
          <li>To mirror GHL contacts as potential team members inside your DIGITRACKER
          workspace, when the integration is connected.</li>
          <li>To keep your GHL connection active (OAuth token refresh) and to reflect
          install/uninstall events from GHL automatically.</li>
          <li>To notify workspace Admins and Super-Admins of account and subscription
          events (e.g. new signups, leave requests).</li>
          <li>To provide customer support and diagnose technical issues.</li>
        </ul>
        <p>We do not sell personal information, and we do not use GHL contact data for
        advertising.</p>
      </LegalSection>

      <LegalSection heading="3. Data Isolation Between Workspaces">
        <p>
          DIGITRACKER is multi-tenant: each company ("sub-account") is technically
          isolated from every other. Row-level security enforced at the database layer
          ensures a workspace's data — including its GHL connection, contacts, payroll,
          and leave records — is never visible to another workspace.
        </p>
      </LegalSection>

      <LegalSection heading="4. Data Retention">
        <p>
          We retain account and work-activity data for as long as your workspace
          remains active, plus a reasonable period afterward for legal and accounting
          purposes. Screen captures are automatically purged after 30 days. If a GHL
          integration is disconnected, we delete the stored OAuth tokens immediately;
          previously synced contact records remain until deleted by your administrator
          or your workspace is closed.
        </p>
      </LegalSection>

      <LegalSection heading="5. Security">
        <p>
          OAuth tokens and other credentials are stored encrypted at rest and are never
          exposed to the browser — all privileged operations (token exchange, refresh,
          and disconnect) run through server-side functions using a scoped service
          role. Access to any workspace's data requires authentication and is enforced
          by row-level security policies scoped to that workspace.
        </p>
      </LegalSection>

      <LegalSection heading="6. Your Choices">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Workspace Admins can disconnect the GHL integration at any time from
          Settings, which immediately revokes our stored access.</li>
          <li>Uninstalling DIGITRACKER from your GHL Marketplace account automatically
          removes our stored tokens for that location.</li>
          <li>You may request export or deletion of your personal data by contacting us
          at the address below.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="7. Contact">
        <p>
          Questions about this policy or your data can be sent to{' '}
          <a href="mailto:admin@digi5y.co" className="text-violet-700 hover:underline">admin@digi5y.co</a>.
        </p>
      </LegalSection>

      <p className="text-xs text-slate-400 border-t border-slate-200 pt-6 mt-10">
        This document is provided as a starting point for DIGITRACKER's GHL Marketplace
        submission and general operation. It has not been reviewed by legal counsel —
        please have it reviewed before relying on it for compliance purposes.
      </p>
    </LegalPageLayout>
  )
}
