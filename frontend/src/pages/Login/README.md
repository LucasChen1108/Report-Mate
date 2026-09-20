# pages/Login/

Public login and account-creation pages for the replaceable authentication
service boundary.

## Behavior

- Login accepts an email and password. The authenticated account returned by
  the service determines the role; login never asks the user to select one.
- Registration defaults to Worker and conditionally accepts either a Worker
  join code or a company Admin code.
- Both pages call `useAuth()` and work with either the mock or API service
  family selected by centralized configuration.
- Successful Admin authentication routes to Templates. Successful Worker
  authentication routes to Generate Report. Login first restores a protected
  destination when it is a known internal route allowed for the returned role.
- Form validation, pending state, and display errors remain local to each page.

Stage A Commit 6 adds restoration-aware route guards, redirects authenticated
users away from these public pages, and renders role-aware application
navigation. Those frontend guards are not a security boundary; the backend must
authorize protected requests independently.
