# Career Dismiss voice recordings

Place the future faction recordings at:

- `public/audio/career/roman/dismiss.wav`
- `public/audio/career/viking/dismiss.wav`

Successful Dismiss commands in Town and Career battlefields already request the corresponding recording through SoundManager. Missing or undecodable files stay silent, do not block commands, and are retried on the next Dismiss; adding a recording requires no code changes. Vite serves these files directly during development and copies them into web/desktop builds. Rebuild packaged releases after adding recordings.
