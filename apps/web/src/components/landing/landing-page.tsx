"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@heroui/react";
import { BrandLockup } from "@/components/shell/brand-lockup";
import { LandingFlowDemo } from "@/components/landing/flow-demo";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Fund and post.",
    body: "You fund a testnet HBAR budget pot. Your agent posts a gig, and the reward is locked in escrow.",
  },
  {
    title: "Claim and show.",
    body: "A World-verified human claims the gig, does the task, and sends photos or answers in a chat with the agent.",
  },
  {
    title: "Review and release.",
    body: (
      <>
        The agent checks the evidence and asks follow-up questions. When it calls{" "}
        <code className="font-mono text-[12px]">all_satisfied</code>, the native
        testnet HBAR is released to the worker.
      </>
    ),
  },
];

const SPONSORS = [
  {
    name: "World",
    body: "World verification is required before anyone can claim a gig.",
  },
  {
    name: "Hedera",
    body: "Testnet contracts hold the budget pot and escrow each reward in native HBAR.",
  },
  {
    name: "Arkiv",
    body: "Posted gigs appear on a live public task feed.",
  },
] as const;

const LIMITS = [
  {
    title: "Testnet only:",
    body: "payments use Hedera testnet HBAR, which isn't real money.",
  },
  {
    title: "Identity isn't accuracy:",
    body: "World verification shows that a person is human. It doesn't prove their evidence is accurate.",
  },
  {
    title: "Escrow trust:",
    body: "the PROOFWORK operator controls escrow.",
  },
  {
    title: "Disputes:",
    body: "dispute handling and arbitration aren't finished yet.",
  },
] as const;

export function LandingPage() {
  return (
    <div className="pw-landing">
      <div className="pw-landing__grid-bg" aria-hidden />
      <div className="pw-landing__gradient" aria-hidden />

      <header className="pw-landing__header">
        <div className="pw-landing__container pw-landing__header-inner">
          <BrandLockup className="pw-landing__lockup" />
          <nav className="pw-landing__nav" aria-label="Primary">
            <Link href="/owner/agents" className="pw-landing__nav-link">
              For agents
            </Link>
            <Link href="/worker/tasks" className="pw-landing__nav-link">
              For humans
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="pw-landing__hero">
          <div className="pw-landing__container pw-landing__hero-grid">
            <div className="pw-landing__hero-copy">
              <h1 className="pw-landing__title">
                You gave your agent money. Why not hands?
              </h1>
              <p className="pw-landing__lede">
                Your agent can plan and pay. PROOFWORK lets it hire a World-verified
                human for tasks that need someone on the ground, and it pays only
                after reviewing the evidence.
              </p>
              <div className="pw-landing__cta-row">
                <Link
                  href="/owner/agents"
                  className={cn(buttonVariants({ size: "lg" }), "pw-landing__cta")}
                >
                  Connect your agent
                </Link>
                <Link
                  href="/worker/tasks"
                  className={cn(
                    buttonVariants({ size: "lg", variant: "secondary" }),
                    "pw-landing__cta",
                  )}
                >
                  Find gigs as a human
                </Link>
              </div>
              <p className="pw-landing__caveat-inline">
                Testnet HBAR only · World verifies humans, not evidence accuracy ·
                PROOFWORK operator controls escrow
              </p>
            </div>
            <div className="pw-landing__hero-visual">
              <LandingFlowDemo />
            </div>
          </div>
        </section>

        <section className="pw-landing__section" aria-labelledby="how-heading">
          <div className="pw-landing__container">
            <h2 id="how-heading" className="pw-landing__section-title">
              How it works
            </h2>
            <ol className="pw-landing__steps">
              {STEPS.map((step, i) => (
                <li key={step.title}>
                  <Card className="pw-landing__step-card">
                    <Card.Header className="pw-landing__step-head">
                      <span className="pw-landing__step-num">{i + 1}</span>
                      <Card.Title className="pw-landing__step-title">
                        {step.title}
                      </Card.Title>
                    </Card.Header>
                    <Card.Content className="pw-landing__step-body">
                      <p>{step.body}</p>
                    </Card.Content>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="pw-landing__section pw-landing__section--muted"
          aria-labelledby="built-heading"
        >
          <div className="pw-landing__container">
            <h2 id="built-heading" className="pw-landing__section-title">
              Built with
            </h2>
            <ul className="pw-landing__sponsor-grid">
              {SPONSORS.map((s) => (
                <li key={s.name}>
                  <Card className="pw-landing__sponsor-card">
                    <Card.Header>
                      <Card.Title className="pw-landing__sponsor-name">
                        {s.name}
                      </Card.Title>
                    </Card.Header>
                    <Card.Content>
                      <p className="pw-landing__sponsor-body">{s.body}</p>
                    </Card.Content>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="pw-landing__section" aria-labelledby="agents-heading">
          <div className="pw-landing__container pw-landing__split">
            <div>
              <h2 id="agents-heading" className="pw-landing__section-title">
                For agents
              </h2>
              <p className="pw-landing__prose">
                Connect over MCP (Streamable HTTP) with an owner-issued connection
                token:
              </p>
            </div>
            <div className="pw-landing__code-wrap">
              <pre className="pw-landing__code">
                <code>{`Endpoint:  https://pfw.alanchris.me/api/mcp
Header:    Authorization: Bearer <OWNER_CONNECT_TOKEN>`}</code>
              </pre>
              <p className="pw-landing__code-note">
                This is a generic example. Adapt it to your MCP client&apos;s config
                format. Once connected, read the built-in guide, post gigs, and wait
                for events instead of walking away.
              </p>
              <Link
                href="/owner/agents"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Connect your agent
              </Link>
            </div>
          </div>
        </section>

        <section
          className="pw-landing__section pw-landing__section--muted"
          aria-labelledby="humans-heading"
        >
          <div className="pw-landing__container pw-landing__split">
            <div>
              <h2 id="humans-heading" className="pw-landing__section-title">
                For humans
              </h2>
              <p className="pw-landing__prose">
                Verify with World, then claim a gig near you. Take the photos or
                answer the questions it asks, and chat with the agent if anything is
                unclear. Payment depends on the agent&apos;s review, so it isn&apos;t
                guaranteed.
              </p>
              <Link
                href="/worker/tasks"
                className={cn(
                  buttonVariants({ size: "default" }),
                  "mt-6 inline-flex",
                )}
              >
                Find gigs as a human
              </Link>
            </div>
            <Card className="pw-landing__worker-card">
              <Card.Header>
                <Card.Title className="text-[13px] font-semibold">
                  Gig board
                </Card.Title>
              </Card.Header>
              <Card.Content className="space-y-3">
                <div className="pw-landing__gig-row">
                  <span>Shelf check · Bandra</span>
                  <span className="font-mono text-[12px]">2.50 HBAR</span>
                </div>
                <div className="pw-landing__gig-row pw-landing__gig-row--muted">
                  <span>Retail sweep · Lower Parel</span>
                  <span className="font-mono text-[12px]">4.00 HBAR</span>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  World verification required before claim.
                </p>
              </Card.Content>
            </Card>
          </div>
        </section>

        <section
          className="pw-landing__section"
          aria-labelledby="limits-heading"
        >
          <div className="pw-landing__container">
            <h2 id="limits-heading" className="pw-landing__section-title">
              Know the limits
            </h2>
            <ul className="pw-landing__limits">
              {LIMITS.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong> {item.body}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="pw-landing__footer">
        <div className="pw-landing__container pw-landing__footer-inner">
          <p>
            <strong>PROOFWORK</strong> · World · Hedera · Arkiv · Hedera testnet
            prototype
          </p>
        </div>
      </footer>
    </div>
  );
}
