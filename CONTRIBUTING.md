# Contributing to Flutter Wireless ADB

Contributions are welcome — thank you for helping improve the project!

## Licensing of contributions

- **Code:** By submitting a contribution that includes source code, you agree
  that your contribution is provided under the **Apache License 2.0** (the same
  license as the rest of the source code).
- **Documentation:** By submitting documentation or other non-code content
  (prose, screenshots, diagrams, etc.), you agree it is provided under the
  **Creative Commons Attribution 4.0 International License (CC BY 4.0)**, unless
  you clearly state otherwise.

## What you may contribute

- Only submit code or content that **you have the right to contribute**. Do not
  submit material owned by others without authorization, and do not copy code
  whose license is incompatible with Apache-2.0.

## What not to add

To keep this a safe, local-only, privacy-respecting extension, contributions
**must not** introduce:

- **Telemetry** or analytics of any kind;
- **Cloud dependencies** or remote services;
- **Secret collection** (e.g. storing or transmitting pairing codes/passwords);
- **Unsafe command execution** — always use `child_process.execFile`/`spawn`
  with argument arrays; never build shell command strings from user/network
  input.

## Practical guidelines

- Keep the manual pairing flow working; add features as clean, separate modules.
- Run `npm run compile` and `npm test` before opening a pull request.
- Clearly describe your changes. If you modified files derived from the original
  Work, note your changes (this also satisfies Apache-2.0 §4(b)).
- Be respectful and constructive in discussions.

## Attribution

Please preserve existing copyright, license, and attribution notices (including
the [NOTICE](NOTICE) file) in any files you modify or redistribute.
