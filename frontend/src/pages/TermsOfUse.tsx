import { Helmet } from 'react-helmet-async'
import Canonical from '../components/Canonical'
import { getFrontendOrigin } from '../config/origins'
import './TermsOfUse.css'

const LAST_UPDATED = '22 September 2026'
const VERSION = '1.0'

export default function TermsOfUse() {
  const frontendOrigin = getFrontendOrigin()

  return (
    <article className="terms-of-use-page">
      <Helmet>
        <title>Terms of Use · Meritocracy</title>
        <meta
          name="description"
          content="Terms governing use of the Meritocracy service, including independent-contractor, AML, and cross-border provisions."
        />
      </Helmet>
      <Canonical baseUrl={frontendOrigin} />

      <div className="terms-of-use-container">
        <header className="terms-of-use-header">
          <p className="terms-of-use-updated">
            Version {VERSION} · Effective and last updated: {LAST_UPDATED}
          </p>
          <h1>Terms of Use</h1>
          <p>
            These Terms govern access to and use of Meritocracy, also called AI Internet-Meritocracy
            (the “Service”). Please read them before using the Service.
          </p>
        </header>

        <section>
          <h2>1. Scope and status</h2>
          <p>
            These Terms describe the conditions for using the Service. The Service is an experimental
            platform that evaluates documented public research and open-source contributions and may
            make funding recommendations or payments when funds and eligibility requirements permit.
            A future contractor onboarding flow must present the applicable version for explicit
            acceptance and retain the required version and acceptance evidence.
          </p>
        </section>

        <section>
          <h2>2. Experimental service; no promise of payment</h2>
          <p>
            Evaluations may use automated and AI-assisted methods. They are heuristic assessments, can
            contain errors, and are not a promise of a particular result, evaluation, funding amount,
            schedule, or payment. Payments depend on available funds, applicable eligibility and
            compliance requirements, and operational safeguards.
          </p>
        </section>

        <section>
          <h2>3. Security incidents, system errors, and payout cancellation</h2>
          <p>
            If a security incident, suspected compromise, fraud, network failure, data-integrity issue,
            or system, data, calculation, or other operational error affects the Service or a payout,
            we reserve the right to suspend, decline, reduce, or cancel that payout in whole or in
            part, including permanently. We may exercise this right during or after investigation and
            reconciliation. We are not obliged to make or release an affected payout, even if it would
            otherwise have been scheduled or become due.
          </p>
          <p>
            If a payment obligation is already represented in the Service&apos;s records, a cancellation or
            adjustment must be recorded explicitly for audit and reconciliation; it does not silently
            erase the history and remains subject to any non-waivable obligation under applicable law.
          </p>
        </section>

        <section>
          <h2>4. Accounts and connected services</h2>
          <p>
            You must provide information that is accurate for the purpose for which it is requested and
            may connect only accounts, wallet addresses, and third-party services that you are entitled
            to use. You must not impersonate another person, misrepresent authorship, evade a hold or
            restriction, or interfere with the Service or its evaluation processes.
          </p>
        </section>

        <section>
          <h2>5. AML, sanctions, and identity checks</h2>
          <p>
            Citizenship, residence, nationality, and document-issuing country alone do not enable or
            deny onboarding, KYC, or payout eligibility. Payout activation may require ordinary
            identity proof and a current, positive AML/sanctions decision. A negative, ambiguous,
            missing, or stale required result prevents activation; any recorded liability remains held
            and auditable until a permitted resolution.
          </p>
          <p>
            You may not use the Service in a manner prohibited by applicable AML or sanctions rules,
            including through a sanctioned person, entity, ownership structure, transaction, or
            jurisdiction. Screening follows the then-current applicable requirements rather than a
            fixed country list. A North Korea-related sanctions result is one example, not the only
            or hard-coded country rule.
          </p>
        </section>

        <section>
          <h2>6. Independent-contractor relationship, taxes, and local law</h2>
          <p>
            For services covered by a contractor agreement, the parties intend an independent-contractor
            relationship, not an employment, partnership, agency, or representative relationship, to
            the extent permitted by applicable law. The contractor is responsible for their own tax,
            reporting, registration, and similar obligations, except where non-waivable law provides
            otherwise.
          </p>
          <blockquote>
            <strong>Mandatory local law.</strong> Nothing in these Terms excludes or limits a
            non-waivable provision of law that applies to the Contractor in the country where the
            Contractor provides the Services, or in another jurisdiction whose law has mandatory
            application. To the extent of a conflict, that mandatory provision prevails, and the
            remainder of these Terms remains effective to the maximum extent permitted by law.
          </blockquote>
          <p>
            This provision does not create a country eligibility restriction. As the Service grows, the
            operator may review jurisdictions that become material and update its compliance operations
            or agreement where necessary.
          </p>
        </section>

        <section>
          <h2>7. Acceptable use and protective measures</h2>
          <p>
            You must not use the Service for fraud, money laundering, sanctions evasion, prompt
            injection, severe plagiarism, security testing without permission, disruption, or other
            unlawful or abusive conduct. The Service may investigate suspected misuse and restrict an
            account, evaluation, or payout when reasonably necessary to protect users, funds, or the
            Service and to meet applicable requirements.
          </p>
        </section>

        <section>
          <h2>8. Third parties, privacy, and contact</h2>
          <p>
            Connected accounts and other third-party services remain subject to their own terms. The
            Service&apos;s handling of personal data is described in the{' '}
            <a href="https://science-dao.org/privacy-policy/">Privacy Policy</a>. Questions about
            these Terms may be sent to the service operator contact below.
          </p>
          <address>
            Service operator contact: Victor Porton&apos;s Foundation<br />
            <a href="mailto:porton@vporton.name">porton@vporton.name</a>
          </address>
        </section>
      </div>
    </article>
  )
}
