# 002: Required Approval for Large Orders

- **Status:** active
- **Priority:** high
- **Tags:** workflow, approval
- **Created:** 2026-08-25
- **Updated:** 2026-08-25

## Summary

Orders above $10,000 require manager approval before processing.

## Description

Any order with a total value exceeding $10,000 must be routed to a manager for approval before it can be processed or fulfilled. This applies regardless of customer tier or discount applied.

## Conditions

- Order total exceeds $10,000

## Actions

- Pause the order in pending-approval state
- Route to manager approval queue
- Notify the submitter that approval is pending
- Set a 48-hour SLA timer for the approval decision

## References

- [Approval Workflow](../references/approval-workflow.md)
