# Access Control Spec

This document defines role-based access control rules for the platform.

## Roles

| Role | Read | Write | Delete | Admin |
|------|------|-------|--------|-------|
| guest | ✓ | ✗ | ✗ | ✗ |
| user | ✓ | ✓ | own only | ✗ |
| manager | ✓ | ✓ | ✓ | ✗ |
| admin | ✓ | ✓ | ✓ | ✓ |

## Guest Access

Guest sessions are created for unauthenticated users. They expire after 24 hours of inactivity. All write attempts must return HTTP 403 with a clear message.

## Enforcement

Access control must be enforced at the API layer, not just the UI. Client-side restrictions are considered advisory only.
