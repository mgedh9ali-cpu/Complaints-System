(async () => {
  const a = await fetch('/app-part1.js').then(r => r.text());
  const b = await fetch('/app-part2.js').then(r => r.text());
  (0, eval)(a + b);
})();
