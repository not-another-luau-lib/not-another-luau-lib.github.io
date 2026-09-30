# not-another-luau-lib.github.io

Documentation site for every library of the org, built with [Fumadocs](https://fumadocs.dev) and
[fumablox](https://github.com/metricrb/fumablox) from each library's Moonwave comments.

The `pages` workflow clones every repo of the org that has a `fumablox.toml`, generates the docs of
those published to ember, pesde or wally, and deploys to GitHub Pages. It runs on push, by hand,
every six hours, and whenever a library's CI sends a `library-updated` dispatch.

```bash
npm install
npm run generate -- ../libraries         # any folder holding one directory per library
npm run generate -- ../libraries --all   # also list libraries that are not published yet
npm run dev
```
