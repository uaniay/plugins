# 001: Discount Cap

- **Status:** active
- **Priority:** high
- **Tags:** pricing, discount
- **Created:** 2026-08-25
- **Updated:** 2026-08-25

## Summary

Maximum discount for any single order is 30%.

## Description

No order may receive a discount exceeding 30% unless explicitly approved by a manager. This rule applies to all order types including bulk and subscription orders.

## Conditions

- Order contains a discount field
- Discount value exceeds 30%

## Actions

- Cap the discount at 30%
- Notify the user that the maximum discount has been applied
- Log the override attempt for audit purposes

## References

- [Pricing Policy](../references/pricing-policy.md)
