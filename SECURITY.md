# Security policy

## Reporting a vulnerability

Please avoid posting credential leaks, session cookies, private message contents, or exploitable security details in a public issue.

If the GitHub repository has **Private vulnerability reporting** enabled, use **Security → Report a vulnerability**. Otherwise, contact the repository maintainer privately using a method listed on their GitHub profile before public disclosure.

## Security boundaries

ChatWatch operates as a Chrome extension with permission to run content scripts on ChatGPT pages. Those scripts can technically access page DOM data, although the implementation is designed to inspect UI state without storing or transmitting message text.

Never install an unpacked extension from an untrusted source without reviewing its code.
