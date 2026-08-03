import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";

/* -------------------------------------------------------------------------- */
/*  PlanCard — renders a pending plan from `submitPlanTool` and exposes      */
/*  the HITL approval flow (Approve / Reject / Edit).                        */
/* -------------------------------------------------------------------------- */

export interface PlanStep {
  tool: string;
  intent: string;
  arguments?: Record<string, unknown>;
}

export interface PendingPlan {
  /** Unique id (usually the assistant message id that produced it). */
  id: string;
  goal: string;
  steps: PlanStep[];
  assumptions?: string[];
}

export interface PlanCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onSelect"
> {
  plan: PendingPlan;
  /** Decision emitted by the UI. The host wires this to the runtime
   * (e.g. by calling `respondToPlanTool` on the agent's behalf). */
  onDecision: (
    decision: "approve" | "edit" | "reject",
    reason?: string
  ) => void | Promise<void>;
  /** Optional state to disable the buttons after the user has decided. */
  decided?: "approved" | "rejected" | "edit_requested";
}

/**
 * Renders a structured execution plan surfaced by `submitPlanTool` in
 * plan-mode. The host calls `onDecision` when the user clicks Approve /
 * Reject / Edit; that handler typically invokes `respondToPlanTool` on
 * the agent. Mirrors the HITL decision shape from
 * `agent-chat-ui/types.ts:803-809`.
 */
export const PlanCard = observer(function PlanCard(props: PlanCardProps) {
  const { plan, onDecision, decided, className, ...rest } = props;
  const [busy, setBusy] = React.useState(false);
  const [showRejectReason, setShowRejectReason] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");

  const handle = async (
    decision: "approve" | "edit" | "reject",
    reason?: string
  ) => {
    if (busy || decided) {
      return;
    }
    setBusy(true);
    try {
      await onDecision(decision, reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      role="region"
      aria-label={`Plan: ${plan.goal}`}
      className={["cline-plan-card", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <Header>
        <HeaderBadge>Plan</HeaderBadge>
        <HeaderTitle>{plan.goal}</HeaderTitle>
        {decided ? (
          <DecisionBadge $decision={decided}>
            {decided === "approved"
              ? "Approved"
              : decided === "rejected"
                ? "Rejected"
                : "Edit requested"}
          </DecisionBadge>
        ) : null}
      </Header>

      <Steps>
        {plan.steps.map((step, i) => (
          <Step key={`${step.tool}-${i}`}>
            <StepIndex>{i + 1}</StepIndex>
            <StepBody>
              <StepTool>
                <StepToolLabel>Tool:</StepToolLabel>{" "}
                <StepToolValue>{step.tool}</StepToolValue>
              </StepTool>
              <StepIntent>{step.intent}</StepIntent>
              {step.arguments && Object.keys(step.arguments).length > 0 ? (
                <Args>
                  <ArgsLabel>Args:</ArgsLabel>
                  <ArgsPre>{JSON.stringify(step.arguments, null, 2)}</ArgsPre>
                </Args>
              ) : null}
            </StepBody>
          </Step>
        ))}
      </Steps>

      {plan.assumptions && plan.assumptions.length > 0 ? (
        <Assumptions>
          <AssumptionsTitle>Assumptions</AssumptionsTitle>
          <AssumptionsList>
            {plan.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </AssumptionsList>
        </Assumptions>
      ) : null}

      {!decided ? (
        <Actions>
          {showRejectReason ? (
            <RejectBox>
              <RejectTextarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why reject? (sent to the agent)"
                rows={2}
              />
              <RejectActions>
                <ActionButton
                  type="button"
                  $variant="secondary"
                  onClick={() => {
                    setShowRejectReason(false);
                    setRejectReason("");
                  }}
                >
                  Cancel
                </ActionButton>
                <ActionButton
                  type="button"
                  $variant="reject"
                  disabled={busy || rejectReason.trim().length === 0}
                  onClick={() => handle("reject", rejectReason.trim())}
                >
                  Confirm reject
                </ActionButton>
              </RejectActions>
            </RejectBox>
          ) : (
            <>
              <ActionButton
                type="button"
                $variant="reject"
                disabled={busy}
                onClick={() => setShowRejectReason(true)}
              >
                Reject
              </ActionButton>
              <ActionButton
                type="button"
                $variant="secondary"
                disabled={busy}
                onClick={() => handle("edit", "User requested edits.")}
              >
                Edit
              </ActionButton>
              <ActionButton
                type="button"
                $variant="approve"
                disabled={busy}
                onClick={() => handle("approve")}
              >
                {busy ? "…" : "Approve"}
              </ActionButton>
            </>
          )}
        </Actions>
      ) : null}
    </Card>
  );
});

/* -------------------------------------------------------------------------- */
/*  Styled primitives                                                         */
/* -------------------------------------------------------------------------- */

const Card = styled.div`
  border: 1px solid ${(p) => p.theme.accent}50;
  border-radius: 8px;
  background: ${(p) => `${p.theme.accent}05`};
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0;
`;

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
`;

const HeaderBadge = styled.span`
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 3px;
  background: ${(p) => p.theme.accent};
  color: ${(p) => p.theme.background};
  flex-shrink: 0;
`;

const HeaderTitle = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${s("text")};
  flex: 1;
  min-width: 0;
  word-break: break-word;
`;

const DecisionBadge = styled.span<{
  $decision: "approved" | "rejected" | "edit_requested";
}>`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 8px;
  border-radius: 3px;
  background: ${(p) =>
    p.$decision === "approved"
      ? `${p.theme.success}20`
      : p.$decision === "rejected"
        ? `${p.theme.danger}20`
        : `${p.theme.accent}20`};
  color: ${(p) =>
    p.$decision === "approved"
      ? p.theme.success
      : p.$decision === "rejected"
        ? p.theme.danger
        : p.theme.accent};
  flex-shrink: 0;
`;

const Steps = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Step = styled.li`
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 6px;
`;

const StepIndex = styled.div`
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${(p) => p.theme.accent}20;
  color: ${(p) => p.theme.accent};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
`;

const StepBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const StepTool = styled.div`
  font-size: 12px;
  display: flex;
  gap: 4px;
  align-items: baseline;
`;

const StepToolLabel = styled.span`
  color: ${s("textTertiary")};
  font-weight: 500;
`;

const StepToolValue = styled.span`
  color: ${s("text")};
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11px;
`;

const StepIntent = styled.div`
  font-size: 12px;
  color: ${s("textSecondary")};
  line-height: 1.4;
`;

const Args = styled.div`
  margin-top: 4px;
`;

const ArgsLabel = styled.div`
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${s("textTertiary")};
  margin-bottom: 2px;
`;

const ArgsPre = styled.pre`
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11px;
  line-height: 1.4;
  background: ${s("codeBackground")};
  padding: 6px 8px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  max-height: 120px;
`;

const Assumptions = styled.div`
  border-top: 1px solid ${s("divider")};
  padding-top: 8px;
`;

const AssumptionsTitle = styled.div`
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${s("textTertiary")};
  margin-bottom: 4px;
`;

const AssumptionsList = styled.ul`
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  color: ${s("textSecondary")};
  line-height: 1.5;
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  border-top: 1px solid ${s("divider")};
  padding-top: 10px;
`;

const ActionButton = styled.button<{
  $variant: "approve" | "reject" | "secondary";
}>`
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid;
  background: transparent;
  cursor: pointer;
  ${(p) => {
    switch (p.$variant) {
      case "approve":
        return `border-color: ${p.theme.success}40; color: ${p.theme.success}; &:hover:not(:disabled) { background: ${p.theme.success}10; }`;
      case "reject":
        return `border-color: ${p.theme.danger}40; color: ${p.theme.danger}; &:hover:not(:disabled) { background: ${p.theme.danger}10; }`;
      default:
        return `border-color: ${p.theme.inputBorder}; color: ${p.theme.textSecondary}; &:hover:not(:disabled) { background: ${p.theme.sidebarControlHoverBackground}; }`;
    }
  }}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const RejectBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
`;

const RejectTextarea = styled.textarea`
  font-family: inherit;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.inputBorder};
  background: ${(p) => p.theme.background};
  color: ${(p) => p.theme.text};
  resize: vertical;
`;

const RejectActions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`;
export default PlanCard;
