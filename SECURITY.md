# Security policy

## Reporting a vulnerability

Report privately to **security@bahulam.ai**. Do not open a public issue.

Include affected package and version, reproduction steps, and impact. We
acknowledge within 3 working days and aim to give a remediation plan within 10.
Coordinated disclosure is preferred; we will credit reporters who want it.

## Supported versions

Pre-1.0: only the latest minor line receives fixes. Each release declares its
compatible document schema versions and renderer profiles.

## Scope

In scope: the command gateway, invariant validator, import/export path, renderer
sandbox boundary, binding and writable-path enforcement, artifact resolution,
and anything that could leak one tenant's data or credentials to another.

Out of scope: vulnerabilities in a host's own identity, policy, or credential
broker implementation; third-party renderer engines (report upstream); and
`experimental/` placeholders, which contain no code.

## Trust boundaries you should know before reporting

- The document is **untrusted data**. A `trust: "host-reviewed"` value inside a
  community manifest is not authority; that value is assigned by the host
  registry.
- Credentials never enter the document, agent context, exports, replay log, or
  telemetry. A report showing otherwise is a valid finding.
- Client-side hiding of a control is not authorization. Authorization is
  enforced at the authoritative service. A missing *server* check is a finding;
  a missing *browser* check is usually not.
- Local execution is not automatically safe. The local host binds to loopback by
  default and needs an origin policy and short-lived session handling.
