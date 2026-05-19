# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Rowboat (Oppulence Engineering fork) or in the desktop application shipped from this repository, please report it privately.

**Preferred channel:** email **admin@solomon-ai.co** with the subject line `SECURITY` and a clear description of the issue. If the issue is sensitive, you may also send a separate follow-up with reproduction steps.

**Alternative channel:** use GitHub's private vulnerability reporting via the [Security tab](https://github.com/Oppulence-Engineering/rowboat/security/advisories/new) of this repository.

Please do **not** open a public issue, discussion, or pull request for security vulnerabilities.

## What to include

A good report contains:

- A description of the vulnerability and the impact you believe it has.
- - Step-by-step reproduction instructions, including the affected version (look in the app's About dialog or `apps/x/apps/main/package.json`).
  - - Any proof-of-concept code, logs, screenshots, or network captures that help us verify the issue.
    - - Whether the vulnerability is, to your knowledge, already public.
     
      - ## Our commitments
     
      - - We will acknowledge receipt of your report within **3 business days**.
        - - We will provide an initial assessment (confirmed, needs more info, or not a vulnerability) within **10 business days**.
          - - We will keep you informed as we work on a fix and coordinate a disclosure timeline with you.
            - - We will credit you in the release notes for the fix, unless you prefer to remain anonymous.
             
              - ## Scope
             
              - In scope:
             
              - - The Electron desktop application under `apps/x/`.
                - - The release and CI pipeline under `.github/workflows/` (e.g., supply-chain issues, signing key handling).
                  - - Build, packaging, and distribution configuration that ships in user-facing artifacts.
                   
                    - Out of scope:
                   
                    - - Vulnerabilities in third-party dependencies that have not yet been patched upstream and have no published advisory (please report those to the dependency's maintainers first).
                      - - Issues that require a compromised local machine, physical access, or social engineering of the user.
                        - - Findings from automated scanners without a demonstrated impact.
                         
                          - ## Supported versions
                         
                          - We provide security fixes for the latest released version on the `main` branch. Older releases are not supported.
                         
                          - ## Upstream
                         
                          - This project is a fork of [rowboatlabs/rowboat](https://github.com/rowboatlabs/rowboat). Vulnerabilities that originate in upstream code and also affect upstream should be reported to the upstream maintainers as well; we will coordinate where appropriate.
                          - 
