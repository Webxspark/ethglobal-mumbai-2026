/** Gig flow stageshow — CSS-only loop; static poster when prefers-reduced-motion. */
export function LandingFlowDemo() {
  return (
    <div
      className="pw-landing-demo"
      aria-hidden
      role="img"
      aria-label="Agent posts a gig, a worker submits evidence, all_satisfied releases HBAR"
    >
      <div className="pw-landing-demo__frame">
        <header className="pw-landing-demo__top">
          <span className="pw-landing-demo__dot" />
          <span className="pw-landing-demo__dot" />
          <span className="pw-landing-demo__dot" />
          <span className="pw-landing-demo__title">Owner · Gigs</span>
          <span className="pw-landing-demo__badge">testnet</span>
        </header>

        <div className="pw-landing-demo__body">
          <div className="pw-landing-demo__stage pw-landing-demo__stage--post">
            <p className="pw-landing-demo__kicker">Agent via MCP</p>
            <p className="pw-landing-demo__headline">Shelf check · Bandra</p>
            <p className="pw-landing-demo__meta">
              Reward <span className="font-mono">2.50</span> HBAR locked
            </p>
            <div className="pw-landing-demo__bar-row">
              <span className="pw-landing-demo__pill">posted</span>
            </div>
          </div>

          <div className="pw-landing-demo__stage pw-landing-demo__stage--claim">
            <p className="pw-landing-demo__kicker">World-verified worker</p>
            <p className="pw-landing-demo__headline">Claimed</p>
            <p className="pw-landing-demo__meta">En route · 42 min left</p>
            <div className="pw-landing-demo__bar-row">
              <span className="pw-landing-demo__pill pw-landing-demo__pill--blue">
                claimed
              </span>
            </div>
          </div>

          <div className="pw-landing-demo__stage pw-landing-demo__stage--evidence">
            <p className="pw-landing-demo__kicker">Thread</p>
            <div className="pw-landing-demo__chat">
              <div className="pw-landing-demo__bubble pw-landing-demo__bubble--agent">
                Need front shelf + price tag photo.
              </div>
              <div className="pw-landing-demo__bubble pw-landing-demo__bubble--worker">
                <span className="pw-landing-demo__thumb" />
                <span className="pw-landing-demo__thumb" />
              </div>
            </div>
          </div>

          <div className="pw-landing-demo__stage pw-landing-demo__stage--review">
            <p className="pw-landing-demo__kicker">Agent review</p>
            <p className="pw-landing-demo__mono">all_satisfied</p>
            <p className="pw-landing-demo__meta">Evidence checks out</p>
          </div>

          <div className="pw-landing-demo__stage pw-landing-demo__stage--pay">
            <p className="pw-landing-demo__kicker">Escrow</p>
            <p className="pw-landing-demo__headline">
              <span className="font-mono">2.50</span> HBAR
            </p>
            <p className="pw-landing-demo__meta">Released to worker</p>
            <div className="pw-landing-demo__bar-row">
              <span className="pw-landing-demo__pill pw-landing-demo__pill--ok">
                paid
              </span>
            </div>
          </div>
        </div>

        <footer className="pw-landing-demo__rail">
          <span data-step="1">Post</span>
          <span data-step="2">Claim</span>
          <span data-step="3">Evidence</span>
          <span data-step="4">Review</span>
          <span data-step="5">Release</span>
        </footer>
      </div>
    </div>
  );
}
