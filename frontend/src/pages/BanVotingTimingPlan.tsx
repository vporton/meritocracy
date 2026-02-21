import './BanVotingTimingPlan.css';

export default function BanVotingTimingPlan() {
  return (
    <div className="timing-plan-page">
      <div className="timing-plan-container">
        <header className="timing-plan-header">
          <h1>Timing Plan: Worth Assessment, Ban/Unban Voting, and Payments</h1>
          <p>Status: Proposed in docs and partially implemented in runtime scheduling.</p>
        </header>

        <section>
          <h2>Goals</h2>
          <ul>
            <li>Give voters enough time to ban scammers before payout release.</li>
            <li>Give enough time to unban wrongly banned users.</li>
            <li>Keep gas/resource usage low.</li>
            <li>Release compensation quickly after unban.</li>
          </ul>
        </section>

        <section>
          <h2>Time Structure (UTC)</h2>
          <table>
            <thead>
              <tr>
                <th>Process</th>
                <th>Cadence</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Full worth assessment</td>
                <td>Every 2 months</td>
                <td>High-quality baseline of share in GDP.</td>
              </tr>
              <tr>
                <td>Light worth refresh</td>
                <td>Weekly, Monday 01:00</td>
                <td>Catch major changes between full runs.</td>
              </tr>
              <tr>
                <td>Vote week anchor</td>
                <td>Monday 00:00</td>
                <td>Reset weekly quorum bucket.</td>
              </tr>
              <tr>
                <td>Regular payout prep (Stage 1)</td>
                <td>Weekly Sunday 20:00 or biweekly mode</td>
                <td>Low-gas regular payouts.</td>
              </tr>
              <tr>
                <td>Regular payout execution (Stage 2)</td>
                <td>Immediately after Stage 1, single batch</td>
                <td>Avoid many on-chain runs per day.</td>
              </tr>
              <tr>
                <td>Compensation payout runner</td>
                <td>Hourly</td>
                <td>Release held balances soon after unban.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>Case Lifecycle</h2>
          <ol>
            <li>`ACTIVE`: regular payouts.</li>
            <li>First BAN vote opens review and starts payment hold.</li>
            <li>Hold periods defer user payouts into backlog.</li>
            <li>If BAN quorum is met, user is banned and hold remains.</li>
            <li>If UNBAN quorum is met, hold is removed and compensation is scheduled immediately.</li>
          </ol>
        </section>

        <section>
          <h2>Payment Rules</h2>
          <ul>
            <li>Do not freeze everyone because one user is disputed.</li>
            <li>Only disputed users are held.</li>
            <li>Default regular mode is weekly; optional mode is biweekly.</li>
            <li>Compensation release is prioritized after unban.</li>
          </ul>
        </section>

        <p className="timing-plan-back">
          <a href="/ban-voting">Back to Ban Voting</a>
        </p>
      </div>
    </div>
  );
}
