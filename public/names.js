// Random name word lists.
//
// A name is built as one adjective plus one noun, like TurboOtter, and is only
// used until someone sets their own. Adding words here is a good first
// contribution: this file has no logic, and nothing else needs to change.
//
// When adding a word:
//   - Keep each list alphabetical, one word per line. Parallel pull requests
//     then merge cleanly instead of fighting over the same line.
//   - Nine characters or fewer. Names are capped at 20 characters in both the
//     client and the server, and 9 + 9 always fits.
//   - Nothing offensive, or that can reasonably be read that way.
//   - Nothing named after a real person from a video of the era.
//   - Aim for the pre-2010 YouTube feel.

const NAME_ADJECTIVES = [
  "Cosmic",
  "Groovy",
  "Happy",
  "Mellow",
  "Neon",
  "Pixel",
  "Retro",
  "Sleepy",
  "Snappy",
  "Turbo"
];

const NAME_NOUNS = [
  "Badger",
  "Falcon",
  "Gecko",
  "Heron",
  "Lynx",
  "Moose",
  "Otter",
  "Panda",
  "Puffin",
  "Walrus"
];
