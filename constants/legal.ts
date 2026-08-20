import * as WebBrowser from "expo-web-browser";

/**
 * Legal document URLs.
 *
 * The App Store and Play Store both require a reachable privacy policy URL
 * before a submission is accepted, and reviewers do tap the in-app link — a
 * row that goes nowhere reads as a broken app, and a row that 404s reads as a
 * missing policy. So anything null here is *hidden* rather than rendered dead.
 *
 * Terms of Service is optional for this app: Apple's standard EULA applies by
 * default, and the paid tiers are non-renewing, so none of the auto-renewing
 * subscription disclosure rules that would force a custom EULA apply. Set it
 * when the page exists; until then the row simply doesn't render.
 */
export const LEGAL_URLS = {
  privacy: "https://resumax.app/privacy-policy" as string | null,
  terms: null as string | null,
};

/**
 * Open a legal page in the in-app browser rather than kicking the user out to
 * Safari/Chrome. Returning to the app afterwards is a single tap, which is
 * what reviewers and users both expect.
 */
export async function openLegalUrl(url: string | null): Promise<void> {
  if (!url) return;
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch (e) {
    // Never let a failed browser hand-off crash the screen it was opened from.
    console.error("Failed to open legal URL", url, e);
  }
}
