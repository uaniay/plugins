# 003: Guest User Read-Only Access

- **Status:** active
- **Priority:** medium
- **Tags:** permissions, access-control
- **Created:** 2026-08-25
- **Updated:** 2026-08-25

## Summary

Guest users may only read data — all write operations are rejected.

## Description

Users with the "guest" role are restricted to read-only access across all resources. Any attempt to create, modify, or delete records must be rejected with a clear message directing the user to log in.

## Conditions

- User role is "guest"
- Request is a write operation (POST, PUT, PATCH, DELETE)

## Actions

- Reject the request with a 403 response
- Return message: "Read-only access. Please log in to make changes."
- Do not log the rejection as a security event (expected behavior)

## References

- [Access Control Spec](../references/access-control-spec.md)
