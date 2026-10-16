// Applies the saved theme before first paint so there is never a flash of the wrong theme.
// Loaded as a blocking same-origin script (compatible with a strict Content Security Policy).
(function () {
  try {
    var stored = localStorage.getItem("dockwell-theme") || "system"
    var dark =
      stored === "dark" ||
      (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    var root = document.documentElement
    root.classList.toggle("dark", dark)
    root.style.colorScheme = dark ? "dark" : "light"
    // Paint the right background even before the stylesheet has loaded.
    root.style.backgroundColor = dark ? "#0f0f12" : "#fdfdfd"
  } catch (e) {
    // Ignore: falls back to the light theme.
  }
})()
