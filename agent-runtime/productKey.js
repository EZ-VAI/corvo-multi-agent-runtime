// Canonical product identity for the room. Derived from the product URL the
// controller scrapes out of the client chat. Only consumer is the room pipeline.
function productKeyFromUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  var s = raw.trim().replace(/[)\]\}.,;'"]+$/, ""); // strip trailing punctuation the greedy scrape grabs
  try {
    var u = new URL(s);
    var host = u.hostname.toLowerCase().replace(/^www\./, "");
    var path = u.pathname.replace(/\/+$/, "");
    return (host + path).toLowerCase();
  } catch (e) {
    return s.toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}
module.exports = { productKeyFromUrl: productKeyFromUrl };
