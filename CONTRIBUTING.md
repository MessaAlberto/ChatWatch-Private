# Contributing

Thanks for helping improve ChatWatch Private.

## Before opening an issue

- Check whether a similar issue already exists.
- Report your Chrome version, operating system, ChatWatch version, expected behavior, and actual behavior.
- Include the **Diagnostica rilevamento** counters when useful.
- Do **not** share real ChatGPT conversation content, personal tab titles, session cookies, authentication tokens, or browser-profile data.

## Development workflow

1. Fork the repository and create a descriptive feature branch.
2. Load the repository folder using `chrome://extensions` → Developer mode → Load unpacked.
3. Make focused changes. Avoid unnecessary permissions and external dependencies.
4. Run `npm test`.
5. Verify the behavior manually on Chrome before proposing completion-detector changes.
6. Open a pull request explaining what changed and how it was tested.

## Project conventions

- Use concise, readable vanilla JavaScript and minimal comments.
- Write source-code identifiers and code comments in English.
- Keep browser and operating-system specifics inside their respective modules.
- Do not introduce telemetry or send conversation contents to remote services.
- Update the README, relevant tests, and CHANGELOG for user-visible changes.

## Testing notification delivery

A successful Chrome notification API response is **not** proof that the OS rendered a banner. Test notification permissions and Do Not Disturb settings on the operating system where the bug occurs.
