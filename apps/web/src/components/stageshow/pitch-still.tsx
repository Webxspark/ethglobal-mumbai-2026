"use client";

/**
 * Desk still for the landing — cropped metrics + rows, not a phone mock.
 * Div grid (no native <table>) so the illustration matches HeroUI desk density.
 */
export function PitchStill() {
  return (
    <div className="pw-desk-still" aria-label="Product still">
      <div className="pw-desk-still__chrome">
        <span className="pw-desk-still__brand">Proofwork</span>
        <span className="pw-desk-still__meta">Overview</span>
      </div>

      <div className="pw-desk-still__metrics">
        <div>
          <p className="pw-desk-still__label">Pot balance</p>
          <p className="pw-desk-still__num">10.00</p>
        </div>
        <div>
          <p className="pw-desk-still__label">Locked</p>
          <p className="pw-desk-still__num">2.50</p>
        </div>
        <div>
          <p className="pw-desk-still__label">Paid out</p>
          <p className="pw-desk-still__num">1.25</p>
        </div>
        <div>
          <p className="pw-desk-still__label">Open gigs</p>
          <p className="pw-desk-still__num">4</p>
        </div>
      </div>

      <div className="pw-desk-still__table" role="table">
        <div className="pw-desk-still__tr pw-desk-still__tr--head" role="row">
          <span role="columnheader">Gig</span>
          <span role="columnheader">Status</span>
          <span className="pw-desk-still__r" role="columnheader">
            HBAR
          </span>
        </div>
        <div className="pw-desk-still__tr" role="row" data-focus>
          <span role="cell">Shelf check · Bandra</span>
          <span role="cell">In review</span>
          <span className="pw-desk-still__r" role="cell">
            0.50
          </span>
        </div>
        <div className="pw-desk-still__tr" role="row">
          <span role="cell">Bulk retail sweep</span>
          <span role="cell">Open</span>
          <span className="pw-desk-still__r" role="cell">
            4.00
          </span>
        </div>
        <div
          className="pw-desk-still__tr pw-desk-still__mute"
          role="row"
          aria-hidden
        >
          <span role="cell">
            <span className="pw-desk-still__bar" style={{ width: 88 }} />
          </span>
          <span role="cell">
            <span className="pw-desk-still__bar" style={{ width: 40 }} />
          </span>
          <span className="pw-desk-still__r" role="cell">
            <span className="pw-desk-still__bar" style={{ width: 28 }} />
          </span>
        </div>
      </div>
    </div>
  );
}
