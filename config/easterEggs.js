// EASTER EGGS — the `key` is what the frontend reports to POST /api/easter-egg.
// `hint` is shown publicly (vague on purpose). `secret` is admin-only.
module.exports = [
  { key: 'sir-spam',      name: 'SIR OVERLOAD',          hint: 'Some words do not like being clicked too much.',       secret: 'Click the big "SIR." in the hero 7 times.' },
  { key: 'football',      name: 'BALL WHISPERER',        hint: 'The ball has feelings.',                              secret: 'Click the floating football in the scouting report.' },
  { key: 'konami',        name: 'THE CHEAT CODE',        hint: 'Old-school gamers know the combination.',             secret: 'Type the Konami code: ↑↑↓↓←→←→BA.' },
  { key: 'hidden-star',   name: 'ONE TINY STAR',         hint: 'Not every star is in the sky.',                       secret: 'Click the tiny star hidden in the timeline.' },
  { key: 'nationals-btn', name: 'NATIONAL SELECTION',    hint: 'Somewhere there is a button that should not exist.',  secret: 'Find the microscopic "select for nationals" button in the Nationals File.' },
  { key: 'cake-spam',     name: 'CAKE ABUSE',            hint: 'The cake can only take so much.',                     secret: 'Click the cake 10 times.' },
  { key: 'secret-roast',  name: 'CLASSIFIED ROAST',      hint: 'Type what everyone calls him.',                       secret: 'Type "unnational" anywhere on the page.' },
  { key: 'dev-message',   name: 'DEVELOPER MESSAGE',     hint: 'Developers leave notes in places nobody looks.',      secret: 'Open the browser console, or click the footer credit 3 times.' },
  { key: 'biryani',       name: 'BIRYANI PROTOCOL',      hint: 'Type his one true love.',                             secret: 'Type "biryani" anywhere on the page.' },
  { key: 'five-minutes',  name: '5 MINUTES',             hint: 'Patience is a virtue. He does not have it.',          secret: 'Stay on the page for 5 real minutes.' },
  { key: 'boss-flawless', name: 'FLAWLESS VICTORY',      hint: 'Defeat him without taking damage.',                   secret: 'Win the boss fight without letting the ego meter recover.' },
  { key: 'anime-9000',    name: "IT'S OVER 9000",        hint: 'The counter can go higher than it should.',           secret: 'Click the anime hours counter until it passes 9000.' },
];
