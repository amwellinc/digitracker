import { LegalPageLayout, LegalSection } from './LegalPageLayout'

export function TermsOfServicePage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated="24 August 2026">
      <p>
        These Terms of Service ("Terms") govern your access to and use of DIGITRACKER,
        provided by DIGI5Y ("we", "us", "our"), including its GoHighLevel ("GHL")
        Marketplace App integration. By creating a DIGITRACKER account or installing
        the DIGITRACKER app from the GHL Marketplace, you agree to these Terms.
      </p>

      <LegalSection heading="1. The Service">
        <p>
          DIGITRACKER is a remote-workforce management platform providing time
          tracking, task and KPI management, leave management, HR document storage,
          payroll records, and an optional GoHighLevel integration for contact
          synchronization. Plans and features are described at{' '}
          <a href="https://www.digitracker.co" className="text-violet-700 hover:underline">www.digitracker.co</a>.
        </p>
      </LegalSection>

      <LegalSection heading="2. Accounts &amp; Workspaces">
        <p>
          Each company using DIGITRACKER operates within its own isolated workspace.
          The person who signs up is granted the Admin role for that workspace and is
          responsible for managing its users, permissions, and data. You are
          responsible for maintaining the confidentiality of your account credentials
          and for all activity under your account.
        </p>
      </LegalSection>

      <LegalSection heading="3. Subscriptions, Trials &amp; Billing">
        <p>
          Free and paid plans are described at signup. Paid plans may include a free
          trial period; unless cancelled before the trial ends, billing begins
          automatically at the end of the trial, per the plan and billing cycle
          selected. You may cancel a paid subscription at any time from Settings —
          access continues until the end of the current billing period. Fees are
          non-refundable except where required by law.
        </p>
      </LegalSection>

      <LegalSection heading="4. The GoHighLevel Integration">
        <p>
          Connecting DIGITRACKER to a GHL sub-account is optional and requires
          authorization through GHL's own OAuth flow. You may disconnect the
          integration at any time from Settings, or by uninstalling the app from your
          GHL Marketplace account. We access only the GHL data and scopes disclosed in
          our <a href="/privacy" className="text-violet-700 hover:underline">Privacy Policy</a> and
          in the app's Marketplace listing.
        </p>
      </LegalSection>

      <LegalSection heading="5. Acceptable Use">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Don't use DIGITRACKER to violate any applicable law or the rights of
          others, including employee privacy and labor laws in your jurisdiction.</li>
          <li>Don't attempt to access another workspace's data, circumvent
          authentication, or interfere with the service's normal operation.</li>
          <li>Don't use automated means to scrape or extract data beyond normal use of
          the product's own features.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Screen Capture &amp; Monitoring Features">
        <p>
          DIGITRACKER offers optional screen-capture and activity-monitoring features
          intended for legitimate workforce management. If you enable these features,
          you are solely responsible for complying with applicable employee monitoring,
          privacy, and consent laws in your jurisdiction, including informing affected
          employees as required by law.
        </p>
      </LegalSection>

      <LegalSection heading="7. Data Ownership">
        <p>
          You retain ownership of the data you and your team enter into DIGITRACKER.
          We process it solely to provide the service, as described in our{' '}
          <a href="/privacy" className="text-violet-700 hover:underline">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection heading="8. Termination">
        <p>
          You may stop using DIGITRACKER and cancel your subscription at any time. We
          may suspend or terminate access for accounts that violate these Terms, with
          notice where practicable. Upon termination, GHL integration tokens are
          deleted immediately; other workspace data is retained per our{' '}
          <a href="/privacy" className="text-violet-700 hover:underline">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection heading="9. Disclaimer &amp; Limitation of Liability">
        <p>
          DIGITRACKER is provided "as is" without warranties of any kind, express or
          implied. To the maximum extent permitted by law, DIGI5Y is not liable for
          indirect, incidental, or consequential damages arising from your use of the
          service. Our total liability for any claim is limited to the amount you paid
          us in the twelve months preceding the claim.
        </p>
      </LegalSection>

      <LegalSection heading="10. Changes to These Terms">
        <p>
          We may update these Terms from time to time. Material changes will be
          communicated to workspace Admins by email or in-app notice. Continued use of
          DIGITRACKER after a change takes effect constitutes acceptance of the revised
          Terms.
        </p>
      </LegalSection>

      <LegalSection heading="11. Contact">
        <p>
          Questions about these Terms can be sent to{' '}
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
