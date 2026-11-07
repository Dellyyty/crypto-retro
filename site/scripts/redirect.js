/**
 * 404 fallback script. GitHub Pages serves 404.html for unknown paths; this
 * forwards any fragment to the app root so a mistyped link still lands on the
 * requested screen. The broadcast itself is not started here.
 */
if (location.hash) {
  location.replace(`./${location.hash}`);
}
